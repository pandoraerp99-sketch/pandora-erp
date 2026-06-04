/**
 * Types + Zod schemas para jobs_queue.
 * Separado de queue.service.ts para permitir import desde codigo cliente/edge
 * sin cargar Drizzle (los workers son Node-only, pero enqueue tambien se llama
 * desde Server Actions).
 */
import { z } from 'zod';
import { JOB_TYPES, type JobType } from '../db/schema/jobs_queue.js';

/**
 * Input para enqueue(). El service inyecta tenant_id + correlation_id desde
 * el tracing context, asi que no van aca.
 */
export interface EnqueueJobInput {
  job_type: JobType;
  payload: Record<string, unknown>;
  /**
   * Max attempts antes de marcar 'dead'. Default segun job_type:
   * - afip.reconcile_pending: 24 (2h ventana con backoff 5min)
   * - cron.*: 3 (cron debe ser idempotente; si falla mucho, es bug)
   * - resto: 5 (margen razonable para transient errors)
   */
  max_attempts?: number;
  /**
   * Cuando es elegible para fetchNextWithLock. Default now() (inmediato).
   * Usado para schedule diferido (ej: cron crea jobs para mañana 02:00).
   */
  next_attempt_at?: Date;
  /**
   * Override tenant_id. SOLO permitido para crons system-wide
   * (cron.partition_audit_log, cron.cleanup_old_jobs). El service valida
   * que el tracing context tenga actor_type='cron'|'system'.
   */
  override_tenant_id?: string;
}

export const enqueueJobInputSchema = z.object({
  job_type: z.enum(JOB_TYPES),
  payload: z.record(z.string(), z.unknown()),
  max_attempts: z.number().int().positive().max(100).optional(),
  next_attempt_at: z.date().optional(),
  override_tenant_id: z.string().uuid().optional(),
});

/**
 * Default max_attempts por job_type. ROADMAP Sprint 1 + RECONCILIATION-ENGINE §3.
 */
export function defaultMaxAttempts(jobType: JobType): number {
  if (jobType === 'afip.reconcile_pending') return 24;
  if (jobType.startsWith('cron.')) return 3;
  return 5;
}

/**
 * Backoff lineal en segundos para markFailedWithRetry.
 * RECONCILIATION-ENGINE: AFIP NO rate-limita; backoff lineal 5min × 24.
 * Otros jobs: backoff lineal mas corto (60s) que doblea con attempts.
 */
export function nextAttemptBackoffSeconds(
  jobType: JobType,
  attemptsSoFar: number
): number {
  if (jobType === 'afip.reconcile_pending') {
    // Lineal fijo 5min — RECONCILIATION-ENGINE §3.
    return 5 * 60;
  }
  // Resto: 60s × attempts (lineal creciente, no exponencial).
  // attempt 1 fallido -> 60s. attempt 2 fallido -> 120s. attempt 5 -> 300s.
  return Math.min(60 * Math.max(1, attemptsSoFar), 30 * 60);
}

/**
 * Errores tipados.
 */
export class JobNotFoundError extends Error {
  constructor(public readonly jobId: bigint) {
    super(`Job ${jobId} no encontrado.`);
    this.name = 'JobNotFoundError';
  }
}

export class JobInvalidStateTransitionError extends Error {
  constructor(
    public readonly jobId: bigint,
    public readonly fromStatus: string,
    public readonly toStatus: string
  ) {
    super(
      `Transicion invalida en job ${jobId}: ${fromStatus} -> ${toStatus}.`
    );
    this.name = 'JobInvalidStateTransitionError';
  }
}

export class JobPoisonDetectedError extends Error {
  constructor(
    public readonly jobType: string,
    public readonly reason: string
  ) {
    super(`Job poison detectado en ${jobType}: ${reason}.`);
    this.name = 'JobPoisonDetectedError';
  }
}
