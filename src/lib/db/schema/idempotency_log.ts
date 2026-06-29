/**
 * idempotency_log = dedup de mutaciones críticas (ADR-0010 + CLAUDE.md §13.2).
 *
 * El cliente genera una `idempotency_key` (UUID) por operación. Si reintenta
 * con la MISMA key (timeout de red, doble click, retry), el server NO
 * re-ejecuta — devuelve el resultado cacheado vía `withIdempotency()`.
 *
 * ── PATRÓN: reserve-first ──
 * Se clama la key PRIMERO (INSERT status='pending', auto-commit), recién
 * después se ejecuta la operación, y al terminar se llena `result` + se pasa
 * a 'completed'. Un duplicado concurrente que ve 'pending' NO ejecuta el
 * side effect (crítico para emisión CAE no-rollbackeable en Sprint 6).
 * Contraste con processed_webhook_events (do-work-then-INSERT, best-effort).
 *
 * ── DESVIACIÓN de ADR-0010 (surfaceada, no silenciosa — CLAUDE.md §22.8) ──
 * El ADR pide `result jsonb NOT NULL` + "INSERT then process", lo cual es
 * incompatible (al clamar la key todavía no hay result). Acá: `status`
 * ('pending'|'completed') + `result` NULLABLE. Nota de actualización a
 * ADR-0010 en el DECISION-LEDGER.
 *
 * ── Scope angosto ──
 * Dedupea requests duplicados, NO hace recovery de crash-mid-operación (eso
 * es la Reconciliation Engine, Sprint 7). Row 'pending' huérfano = aceptable
 * F0 (cliente reintenta con key nueva). Sin lease/expiry F0.
 *
 * Cleanup: cron elimina rows completados > retención (service_role bypass RLS).
 */
import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId } from './_common.js';
import { companies } from './companies.js';

/**
 * Estados de un registro de idempotencia.
 * - `pending`: key clamada, operación en curso (o huérfana si falló/crasheó).
 * - `completed`: operación terminó OK, `result` + `completed_at` poblados.
 */
export const IDEMPOTENCY_STATUSES = ['pending', 'completed'] as const;
export type IdempotencyStatus = (typeof IDEMPOTENCY_STATUSES)[number];

export const idempotency_log = pgTable(
  'idempotency_log',
  {
    id: id(),

    /** Comercio dueño de la operación. FK restrict (no orphan auto-delete). */
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    /** UUID generado por el cliente, único por operación lógica. */
    idempotency_key: uuid('idempotency_key').notNull(),

    /**
     * Nombre lógico de la operación (ej: 'sale.finalize', 'invoice.emit').
     * Sirve para forenses + métricas; NO participa del UNIQUE.
     */
    operation: text('operation').notNull(),

    /**
     * Hash del request (params canónicos). Si llega la MISMA key con distinto
     * request_hash → bug del cliente (key reusada) → IdempotencyKeyReuseError.
     */
    request_hash: text('request_hash').notNull(),

    /** 'pending' | 'completed'. CHECK constraint enforce el catálogo. */
    status: text('status').notNull().default('pending'),

    /**
     * Resultado serializado de la operación. NULL mientras 'pending'; poblado
     * al pasar a 'completed'. Nullable a propósito (desviación ADR-0010 — ver
     * header). Para operaciones void queda NULL aun en 'completed'.
     */
    result: jsonb('result'),

    created_at: createdAt(),

    /**
     * Momento en que se completó. NULL mientras 'pending'. El CHECK
     * chk_idempotency_log_completed ata completed_at ⟺ status='completed'.
     */
    completed_at: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    // El UNIQUE crea el índice que usa el lookup por (tenant, key).
    unique('uq_idempotency_log_tenant_key').on(t.tenant_id, t.idempotency_key),
    check('chk_idempotency_log_status', sql`${t.status} IN ('pending', 'completed')`),
    check(
      'chk_idempotency_log_completed',
      sql`(${t.status} = 'pending' AND ${t.completed_at} IS NULL) OR (${t.status} = 'completed' AND ${t.completed_at} IS NOT NULL)`
    ),
  ]
);

export type IdempotencyLogRow = typeof idempotency_log.$inferSelect;
