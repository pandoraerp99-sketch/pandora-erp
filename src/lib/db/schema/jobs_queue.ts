/**
 * jobs_queue = cola asincrona de jobs F0.
 * EVENT-TAXONOMY.md §6 + ROADMAP Sprint 1 + CLAUDE.md §10.3.
 *
 * REGLAS OPERATIVAS (J1-J6):
 * - J1 Catalogo CERRADO. Agregar job_type = PR + worker dedicado + ADR/decision-ledger.
 * - J2 Worker dedicado por job_type. NO handler generico que despache por tipo
 *   (prevencion drift a event bus encubierto).
 * - J3 SKIP LOCKED obligatorio en fetchNextWithLock (cero double-processing).
 * - J4 Prohibido fan-out implicito. Job NO emite jobs automaticamente; encadenar
 *   explicitamente en codigo + documentar.
 * - J5 correlation_id para trazabilidad operativa, NO para state ownership. El estado
 *   vive en tablas de negocio (sales, invoices), no derivado de secuencia de jobs.
 * - J6 Eliminacion de job_type = remover del enum + entry en DECISION-LEDGER. NO
 *   marcar "deprecated" silencioso.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Catalogo canonico F0 (10 job_types). Cualquier otro string es rechazado
 * por CHECK constraint a nivel DB y por validacion runtime en queue.service.
 */
export const JOB_TYPES = [
  'afip.emit_invoice',
  'afip.reconcile_pending',
  'afip.refresh_wsaa_token',
  'afip.refresh_padron',
  'email.send_invoice',
  'email.send_breach_notification',
  'mp.reconcile_webhook',
  'cron.archive_expired_demos',
  'cron.partition_audit_log',
  'cron.cleanup_old_jobs',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/**
 * Estados canonicos.
 * - pending: enqueado, esperando que algun worker lo agarre con SKIP LOCKED.
 * - running: worker tomo el job (started_at set, completed_at null).
 * - done: completado OK (completed_at set).
 * - failed: ultimo attempt fallo pero attempts < max_attempts; se reintenta.
 * - dead: agoto max_attempts O detectado poison; requiere resolucion humana.
 *   "dead" = manual_resolution_required en lenguaje fiscal (CLAUDE.md §13.4).
 */
export const JOB_STATUSES = ['pending', 'running', 'done', 'failed', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobs_queue = pgTable(
  'jobs_queue',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),

    job_type: text('job_type').notNull(),

    /**
     * tenant_id NOT NULL. Para jobs system-wide (crons de mantenimiento)
     * se usa env.SYSTEM_TENANT_ID (00000000-0000-0000-0000-000000000000).
     * Worker debe filtrar SIEMPRE por (job_type, tenant_id) si aplica multi-tenant.
     */
    tenant_id: uuid('tenant_id').notNull(),

    /**
     * correlation_id heredado de la operacion que enqueo el job.
     * EVENT-TAXONOMY §6 + CORRELATION-PROPAGATION §4.
     * Worker propaga este correlation_id al ejecutar (continuidad operacion logica).
     */
    correlation_id: uuid('correlation_id').notNull(),

    /**
     * last_request_id: nullable hasta primer attempt. Worker setea uno nuevo
     * por cada attempt (life span = un job attempt, segun
     * CORRELATION-PROPAGATION §2).
     */
    last_request_id: uuid('last_request_id'),

    payload: jsonb('payload').notNull(),

    status: text('status').notNull().default('pending'),

    /** Cantidad de attempts completados (incluye failures, no pending inicial). */
    attempts: integer('attempts').notNull().default(0),

    /**
     * Max attempts antes de marcar 'dead'. Default 24 (cubre afip.reconcile_pending
     * con 5min × 24 = 2h ventana segun RECONCILIATION-ENGINE §3).
     * Otros job_types pueden setear menos al enqueue.
     */
    max_attempts: integer('max_attempts').notNull().default(24),

    /**
     * Cuando el job es elegible para fetchNextWithLock. Default now() (inmediato).
     * Worker setea backoff a este campo al markFailedWithRetry (lineal o exp segun job_type).
     */
    next_attempt_at: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),

    /** Ultimo error capturado del job. Texto plano (NO secretos — lista §10.5 CLAUDE.md). */
    last_error: text('last_error'),

    started_at: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completed_at: timestamp('completed_at', { withTimezone: true, mode: 'date' }),

    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /**
     * Index principal para fetchNextWithLock. Cubre el filtro
     * (status='pending' AND next_attempt_at <= now()) ordenado por created_at.
     */
    statusNextAttemptIdx: index('jobs_queue_status_next_attempt_idx').on(
      table.status,
      table.next_attempt_at,
      table.created_at
    ),
    /** Cleanup de jobs done > 30d (cron.cleanup_old_jobs) + filtro tenant. */
    tenantStatusIdx: index('jobs_queue_tenant_status_idx').on(
      table.tenant_id,
      table.status
    ),
    /** Trazabilidad cross-jobs por correlation_id. */
    correlationIdx: index('jobs_queue_correlation_idx').on(table.correlation_id),

    /** Catalogo cerrado de job_types. J1 EVENT-TAXONOMY §6. */
    jobTypeCheck: check(
      'jobs_queue_job_type_check',
      sql`${table.job_type} IN (${sql.raw(JOB_TYPES.map((t) => `'${t}'`).join(','))})`
    ),
    /** Estados canonicos. */
    statusCheck: check(
      'jobs_queue_status_check',
      sql`${table.status} IN (${sql.raw(JOB_STATUSES.map((s) => `'${s}'`).join(','))})`
    ),
    /** attempts >= 0 y attempts <= max_attempts. */
    attemptsCheck: check(
      'jobs_queue_attempts_check',
      sql`${table.attempts} >= 0 AND ${table.attempts} <= ${table.max_attempts}`
    ),
    /** max_attempts > 0. */
    maxAttemptsCheck: check(
      'jobs_queue_max_attempts_check',
      sql`${table.max_attempts} > 0`
    ),
  })
);

export type Job = typeof jobs_queue.$inferSelect;
export type NewJob = typeof jobs_queue.$inferInsert;
