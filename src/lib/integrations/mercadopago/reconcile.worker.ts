/**
 * Worker de reconciliación MercadoPago — batch drainer del job `mp.reconcile_webhook`.
 * Sprint 5 Sales+MP (Fase B) — el PRIMER worker del sistema.
 *
 * El loop NO es un setInterval (CLAUDE.md §20.12 anti-pattern) — es un cron Vercel
 * que invoca este drainer, que consume la cola en batch ACOTADO (SKIP LOCKED) y corta
 * al vaciarse o al tope. Vercel function timeout 30s Hobby / 300s Pro → batch acotado.
 * https://vercel.com/docs/cron-jobs
 *
 * Cada job corre en su propio worker tracing context: hereda el `correlation_id` del
 * job (worker continuity, CORRELATION-PROPAGATION) + `request_id` nuevo por attempt +
 * el tenant del job → `reconcileMpPayment.requireTenantId()` + RLS + audit quedan
 * tenant-correctos, y un pago MP es trazable webhook→job→reconcile→audit.
 *
 * Idempotente: `reconcileMpPayment` es idempotente; un job re-procesado no duplica efectos.
 */
import {
  detectGenericPoison,
  fetchNextJobWithLock,
  markJobDead,
  markJobDone,
  markJobFailedWithRetry,
} from '../../jobs_queue/queue.service.js';
import { type Job } from '../../db/schema/jobs_queue.js';
import { withWorkerTracing } from '../../tracing/server-action-tracing.js';
import { generateRequestId } from '../../tracing/ids.js';
import { reconcileMpPayment } from './reconcile.service.js';
import { getMpPayment, type GetMpPaymentResult } from './mp-api-client.js';

export interface MpWorkerDeps {
  /** Resuelve el access token de MP del tenant (per-tenant via vault en F1). */
  resolveAccessToken: (companyId: string) => Promise<string | null>;
  /** test hook: override del fetch del pago (default: getMpPayment con el token). */
  fetchPaymentFor?: (
    accessToken: string
  ) => (mpPaymentId: string) => Promise<GetMpPaymentResult>;
}

export interface MpBatchResult {
  processed: number;
  done: number;
  retried: number;
  dead: number;
}

const DEFAULT_MAX_JOBS = 20;

/**
 * Drena hasta `maxJobs` jobs `mp.reconcile_webhook` de la cola. Retorna el resumen.
 * Idempotente y seguro para correr concurrente (SKIP LOCKED evita double-processing).
 */
export async function runMpReconcileBatch(
  deps: MpWorkerDeps,
  maxJobs: number = DEFAULT_MAX_JOBS
): Promise<MpBatchResult> {
  const workerRequestId = generateRequestId();
  const result: MpBatchResult = { processed: 0, done: 0, retried: 0, dead: 0 };

  for (let i = 0; i < maxJobs; i++) {
    const job = await fetchNextJobWithLock('mp.reconcile_webhook', workerRequestId);
    if (job === null) break; // cola vacía
    result.processed++;

    const outcome = await withWorkerTracing(
      { tenant_id: job.tenant_id, correlation_id: job.correlation_id },
      () => processMpReconcileJob(job, deps)
    );
    result[outcome]++;
  }

  return result;
}

async function processMpReconcileJob(
  job: Job,
  deps: MpWorkerDeps
): Promise<'done' | 'retried' | 'dead'> {
  // Poison genérico (job_type / tenant / payload) — detección inmediata (RECONCILIATION-ENGINE).
  const poison = detectGenericPoison(job);
  if (poison !== null) {
    await markJobDead(job.id, poison);
    return 'dead';
  }

  // Poison específico: el payload DEBE traer mp_payment_id string.
  const mpPaymentId = (job.payload as { mp_payment_id?: unknown }).mp_payment_id;
  if (typeof mpPaymentId !== 'string' || mpPaymentId.length === 0) {
    await markJobDead(job.id, 'payload_missing_mp_payment_id');
    return 'dead';
  }

  const accessToken = await deps.resolveAccessToken(job.tenant_id);
  if (accessToken === null || accessToken.length === 0) {
    // sin token no podemos re-consultar la API autoritativa → reintentar (config puede aparecer).
    await markJobFailedWithRetry(job.id, 'mp_access_token_not_configured');
    return 'retried';
  }

  const fetchPayment = deps.fetchPaymentFor
    ? deps.fetchPaymentFor(accessToken)
    : (id: string) => getMpPayment(id, { accessToken });

  const outcome = await reconcileMpPayment(mpPaymentId, { fetchPayment });

  if (outcome.outcome === 'updated' || outcome.outcome === 'noop_same_status') {
    await markJobDone(job.id);
    return 'done';
  }

  // mp_payment_not_found (race: el POS aún no insertó mp_payments) o
  // fetch_failed (network/http transient) → reintentar con backoff.
  await markJobFailedWithRetry(job.id, `reconcile_${outcome.outcome}`);
  return 'retried';
}
