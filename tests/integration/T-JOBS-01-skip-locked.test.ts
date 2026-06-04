/**
 * T-JOBS-01 — SKIP LOCKED concurrencia jobs_queue.
 * Sprint 1 ROADMAP Platform + EVENT-TAXONOMY.md regla J3 + RECONCILIATION-ENGINE.md §3.
 *
 * **Por qué CRÍTICO:** la regla J3 EVENT-TAXONOMY exige "SKIP LOCKED obligatorio
 * — cero double-processing entre workers concurrentes". Es el motivo de existir
 * de la queue propia (vs Postgres NOTIFY/LISTEN o cron simple).
 *
 * **Escenario real:**
 * 2 workers de mismo job_type corren en paralelo (Vercel cron disparado 2 veces
 * por mistake, o Railway con 2 réplicas). Ambos compiten por el siguiente job
 * pending. Sin SKIP LOCKED: ambos lo procesan, double-execution (fatal para
 * `afip.emit_invoice` que tendría doble CAE). Con SKIP LOCKED: el primero
 * obtiene el lock, el segundo skip y retorna null.
 *
 * **Lo que validamos:**
 * - Exactamente 1 worker obtiene el job (el otro retorna null)
 * - El job lockeado pasa a status='running' con attempts=1
 * - El `last_request_id` corresponde al worker ganador
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { jobs_queue } from '@/lib/db/schema/jobs_queue';
import { audit_log } from '@/lib/db/schema/audit';
import { enqueueJob, fetchNextJobWithLock } from '@/lib/jobs_queue/queue.service';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';

describe('T-JOBS-01 — SKIP LOCKED concurrencia (cero double-processing)', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-JOBS-01 Test Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userId,
      email: `t-jobs-01-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Test',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(jobs_queue).where(eq(jobs_queue.tenant_id, tenantId));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('2 workers paralelos sobre el mismo job_type → exactamente 1 obtiene el job + 1 obtiene null', async () => {
    // ── Setup: enqueue 1 job ──
    const enqueuedJob = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        enqueueJob({
          job_type: 'afip.emit_invoice',
          payload: { test: 'T-JOBS-01', sale_id: crypto.randomUUID() },
        })
    );
    expect(enqueuedJob.status).toBe('pending');
    expect(enqueuedJob.attempts).toBe(0);

    // ── 2 workers compiten en paralelo por el mismo job_type ──
    const workerARequestId = generateRequestId();
    const workerBRequestId = generateRequestId();

    const fetchAsWorker = (requestId: string) =>
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: requestId,
          tenant_id: tenantId,
          actor_user_id: null,
          actor_type: 'worker',
        },
        () => fetchNextJobWithLock('afip.emit_invoice', requestId)
      );

    const [resultA, resultB] = await Promise.all([
      fetchAsWorker(workerARequestId),
      fetchAsWorker(workerBRequestId),
    ]);

    // ── Assert: exactamente 1 obtiene + 1 null ──
    const fetched = [resultA, resultB].filter((r) => r !== null);
    const nulls = [resultA, resultB].filter((r) => r === null);
    expect(fetched).toHaveLength(1);
    expect(nulls).toHaveLength(1);

    const winnerJob = fetched[0]!;
    expect(winnerJob.id).toBe(enqueuedJob.id);
    expect(winnerJob.status).toBe('running');
    expect(winnerJob.attempts).toBe(1);
    // El last_request_id es el del worker ganador (alguno de los dos)
    expect([workerARequestId, workerBRequestId]).toContain(winnerJob.last_request_id);

    // ── Verify DB state: job ahora está 'running', no se puede re-fetch ──
    const dbRow = await db
      .select()
      .from(jobs_queue)
      .where(eq(jobs_queue.id, enqueuedJob.id))
      .limit(1);
    expect(dbRow[0]?.status).toBe('running');
    expect(dbRow[0]?.attempts).toBe(1);

    // ── 3er worker intenta fetch → null (job ya no es 'pending') ──
    const requestIdC = generateRequestId();
    const resultC = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: requestIdC,
        tenant_id: tenantId,
        actor_user_id: null,
        actor_type: 'worker',
      },
      () => fetchNextJobWithLock('afip.emit_invoice', requestIdC)
    );
    expect(resultC).toBeNull();
  });

  it('Worker fetch sobre job_type sin pending jobs → null sin error', async () => {
    // Aún hay un job de 'afip.emit_invoice' running (del test anterior), pero
    // 'mp.reconcile_webhook' no tiene ningún job. Fetch debería devolver null.
    const requestId = generateRequestId();
    const result = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: requestId,
        tenant_id: tenantId,
        actor_user_id: null,
        actor_type: 'worker',
      },
      () => fetchNextJobWithLock('mp.reconcile_webhook', requestId)
    );
    expect(result).toBeNull();
  });

  it('Jobs con next_attempt_at en futuro no son retornados', async () => {
    // Enqueue job con schedule diferido +1h
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        enqueueJob({
          job_type: 'email.send_invoice',
          payload: { test: 'future-scheduled' },
          next_attempt_at: futureDate,
        })
    );

    const requestId = generateRequestId();
    const result = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: requestId,
        tenant_id: tenantId,
        actor_user_id: null,
        actor_type: 'worker',
      },
      () => fetchNextJobWithLock('email.send_invoice', requestId)
    );
    expect(result).toBeNull();
  });
});
