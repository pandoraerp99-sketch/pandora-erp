/**
 * Jobs queue service — enqueue + fetchNextWithLock + markDone/Failed/Poisoned.
 * EVENT-TAXONOMY §6 + ROADMAP Sprint 1 + RECONCILIATION-ENGINE §3 + CLAUDE.md §15.4.
 *
 * REGLA J3: fetchNextWithLock usa SKIP LOCKED. Cero double-processing entre
 * workers concurrentes.
 *
 * REGLA J2: este service NO conoce job_type-specific logic. Cada worker
 * importa fetchNextWithLock(jobType) y procesa SOLO su tipo.
 *
 * DIVERGENCE NOTA — override_tenant_id permitido aqui es ('system'|'cron'),
 * NO ('system'|'support') como en audit-writer.ts. Razon: support NO debe
 * enqueue jobs que emiten facturas/cobran/notifican; eso violaria CLAUDE.md
 * §7.8 (support read-only por default; mutations requieren consentimiento
 * explicito del comerciante). Cron SI puede enqueue jobs system-wide
 * (cron.partition_audit_log, cron.cleanup_old_jobs). audit-writer permite
 * support porque support PUEDE auditar lo que hace (read access genera audit).
 * Esta divergence es intencional — futuro-yo no la "harmonice".
 */
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { env } from '../env.js';
import { db, type Db } from '../db/client.js';
import { jobs_queue, JOB_TYPES, type Job, type JobType } from '../db/schema/jobs_queue.js';
import { requireTracingContext } from '../tracing/context.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';
import {
  defaultMaxAttempts,
  enqueueJobInputSchema,
  type EnqueueJobInput,
  JobInvalidStateTransitionError,
  JobNotFoundError,
  JobPoisonDetectedError,
  nextAttemptBackoffSeconds,
} from './types.js';

type DbOrTransaction = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Enqueue un nuevo job. Heredera correlation_id + tenant_id del tracing context.
 * override_tenant_id solo permitido para crons system-wide.
 *
 * Retorna el job creado (incluyendo el id bigserial asignado).
 */
export async function enqueueJob(
  input: EnqueueJobInput,
  txOrDb: DbOrTransaction = db
): Promise<Job> {
  const parsed = enqueueJobInputSchema.parse(input);
  const ctx = requireTracingContext();

  // override_tenant_id solo para cron|system. Defensa en profundidad.
  if (parsed.override_tenant_id !== undefined) {
    if (ctx.actor_type !== 'system' && ctx.actor_type !== 'cron') {
      throw new CrossTenantAccessError(
        parsed.override_tenant_id,
        ctx.tenant_id,
        'jobs_queue.override_tenant_id'
      );
    }
  }

  const tenantId =
    parsed.override_tenant_id ?? ctx.tenant_id ?? env.SYSTEM_TENANT_ID;

  const maxAttempts = parsed.max_attempts ?? defaultMaxAttempts(parsed.job_type);
  const nextAttemptAt = parsed.next_attempt_at ?? new Date();

  const inserted = await txOrDb
    .insert(jobs_queue)
    .values({
      job_type: parsed.job_type,
      tenant_id: tenantId,
      correlation_id: ctx.correlation_id,
      payload: parsed.payload,
      status: 'pending',
      attempts: 0,
      max_attempts: maxAttempts,
      next_attempt_at: nextAttemptAt,
    })
    .returning();

  const job = inserted[0];
  if (!job) {
    throw new Error('enqueueJob: INSERT no devolvio fila');
  }
  return job;
}

/**
 * Fetch the next pending job of a given type and mark it as 'running'.
 * SKIP LOCKED previene double-processing entre workers concurrentes (REGLA J3).
 *
 * El worker debe generar un NUEVO request_id por cada attempt (life span attempt).
 * El service lo persiste en jobs_queue.last_request_id.
 *
 * Retorna null si no hay jobs disponibles (worker debe dormir y reintentar).
 */
export async function fetchNextJobWithLock(
  jobType: JobType,
  workerRequestId: string,
  txOrDb: DbOrTransaction = db
): Promise<Job | null> {
  // **Atomicidad SKIP LOCKED via transacción Drizzle ORM nativo:**
  // - SELECT ... FOR UPDATE SKIP LOCKED bloquea el row si está pending+disponible
  // - UPDATE en la MISMA tx convierte a 'running' antes del COMMIT
  // - Si dos workers compiten: el primero obtiene el lock, el segundo skip-locked
  //   (retorna null porque su SELECT no ve filas elegibles bloqueadas)
  // - El lock se libera al COMMIT/ROLLBACK
  //
  // **Por qué Drizzle ORM y NO execute raw (bug fix 2026-06-03 PM, detectado
  // por T-JOBS-01):** `db.execute(sql\`...RETURNING...\`)` devuelve raw rows
  // del driver postgres-js, sin mapeo al schema. Los tipos quedan crudos:
  // `bigserial.id → string`, `integer.attempts → string`. El cast `as Job`
  // mentía. Con `.select()/.update()` Drizzle aplica el mapping del schema
  // (bigint mode → BigInt, integer → number).
  //
  // **Si txOrDb ya es una tx, reusamos. Si es db plain, abrimos una tx propia**
  // (mismo patrón Sprint 3 recordStockMovement + createProduct).
  const runInTx = async (tx: DbOrTransaction): Promise<Job | null> => {
    const candidates = await tx
      .select()
      .from(jobs_queue)
      .where(
        and(
          eq(jobs_queue.status, 'pending'),
          eq(jobs_queue.job_type, jobType),
          lte(jobs_queue.next_attempt_at, sql`now()`)
        )
      )
      .orderBy(asc(jobs_queue.created_at))
      .limit(1)
      .for('update', { skipLocked: true });

    if (candidates.length === 0) return null;
    const candidate = candidates[0]!;

    const updated = await tx
      .update(jobs_queue)
      .set({
        status: 'running',
        started_at: new Date(),
        last_request_id: workerRequestId,
        attempts: candidate.attempts + 1,
      })
      .where(eq(jobs_queue.id, candidate.id))
      .returning();
    return updated[0] ?? null;
  };

  if (txOrDb === db) {
    return await db.transaction(runInTx);
  }
  return await runInTx(txOrDb);
}

/**
 * Marca un job como completado exitosamente.
 */
export async function markJobDone(
  jobId: bigint,
  txOrDb: DbOrTransaction = db
): Promise<void> {
  const updated = await txOrDb
    .update(jobs_queue)
    .set({
      status: 'done',
      completed_at: new Date(),
      last_error: null,
    })
    .where(and(eq(jobs_queue.id, jobId), eq(jobs_queue.status, 'running')))
    .returning({ id: jobs_queue.id });

  if (updated.length === 0) {
    throw new JobInvalidStateTransitionError(jobId, 'unknown', 'done');
  }
}

/**
 * Marca un job como fallido. Si attempts < max_attempts, lo deja en estado
 * 'failed' y schedule retry (status -> 'pending' + next_attempt_at en futuro).
 * Si attempts >= max_attempts, lo deja en 'dead' (requires_resolution).
 *
 * Backoff:
 * - afip.reconcile_pending: lineal 5min (RECONCILIATION-ENGINE §3).
 * - resto: lineal 60s × attempts hasta cap 30min.
 */
export async function markJobFailedWithRetry(
  jobId: bigint,
  error: string,
  txOrDb: DbOrTransaction = db
): Promise<{ status: 'pending' | 'dead'; next_attempt_at: Date | null }> {
  const rows = await txOrDb
    .select({
      id: jobs_queue.id,
      job_type: jobs_queue.job_type,
      attempts: jobs_queue.attempts,
      max_attempts: jobs_queue.max_attempts,
    })
    .from(jobs_queue)
    .where(eq(jobs_queue.id, jobId))
    .limit(1);

  const job = rows[0];
  if (!job) {
    throw new JobNotFoundError(jobId);
  }

  // Sanitizar last_error: nunca mas de 2000 chars (evita inflar la tabla
  // si AFIP devuelve un XML gigante). El XML completo va a Pino log.
  const sanitizedError = error.slice(0, 2000);

  if (job.attempts >= job.max_attempts) {
    await txOrDb
      .update(jobs_queue)
      .set({
        status: 'dead',
        completed_at: new Date(),
        last_error: sanitizedError,
      })
      .where(eq(jobs_queue.id, jobId));
    return { status: 'dead', next_attempt_at: null };
  }

  // attempts < max_attempts -> schedule retry.
  const backoffSec = nextAttemptBackoffSeconds(
    job.job_type as JobType,
    job.attempts
  );
  const nextAttemptAt = new Date(Date.now() + backoffSec * 1000);

  await txOrDb
    .update(jobs_queue)
    .set({
      status: 'pending',
      next_attempt_at: nextAttemptAt,
      last_error: sanitizedError,
    })
    .where(eq(jobs_queue.id, jobId));

  return { status: 'pending', next_attempt_at: nextAttemptAt };
}

/**
 * Marca un job como 'dead' inmediatamente, sin reintentos. Usado para:
 * - Poison detectado al primer attempt (RECONCILIATION-ENGINE §5).
 * - AFIP `failed` (rechazo explicito, NUNCA reintentar — CLAUDE.md §8.8).
 *
 * Worker DEBE haber detectado el poison/rejection ANTES de llamar esto.
 * El service NO valida la razon (es responsabilidad del worker).
 */
export async function markJobDead(
  jobId: bigint,
  reason: string,
  txOrDb: DbOrTransaction = db
): Promise<void> {
  const sanitizedReason = reason.slice(0, 2000);

  const updated = await txOrDb
    .update(jobs_queue)
    .set({
      status: 'dead',
      completed_at: new Date(),
      last_error: sanitizedReason,
    })
    .where(eq(jobs_queue.id, jobId))
    .returning({ id: jobs_queue.id });

  if (updated.length === 0) {
    throw new JobNotFoundError(jobId);
  }
}

/**
 * Detecta poison en un payload sin haber empezado a procesarlo.
 * Worker llama esto ANTES de hacer trabajo real. Si retorna null, sigue.
 * Si retorna un string, es la razon del poison y debe llamar markJobDead.
 *
 * Criterios genericos F0:
 * - job_type fuera del catalogo (no deberia pasar por CHECK constraint pero defensa).
 * - tenant_id null/empty.
 * - payload null/empty (cada worker valida su shape propio adicionalmente).
 *
 * Workers especificos pueden agregar checks Zod sobre el payload y llamar
 * markJobDead directamente con su propia razon.
 */
export function detectGenericPoison(job: Job): string | null {
  if (!JOB_TYPES.includes(job.job_type as JobType)) {
    return `unknown_job_type: ${job.job_type}`;
  }
  if (!job.tenant_id) {
    return 'missing_tenant_id';
  }
  if (!job.payload || typeof job.payload !== 'object') {
    return 'invalid_payload_shape';
  }
  return null;
}

// Re-export error types for convenience.
export {
  JobInvalidStateTransitionError,
  JobNotFoundError,
  JobPoisonDetectedError,
} from './types.js';
