/**
 * cash_sessions = turno de caja por (tenant, sale_point) con apertura + cierre.
 * Sprint 4 ROADMAP Cash context (C-OPS-01) + BOUNDED-CONTEXTS Cash.
 *
 * **UNIQUE partial constraint**: solo 1 session abierta por (tenant, sale_point).
 *   `UNIQUE (tenant_id, sale_point) WHERE closed_at IS NULL`
 *   Aplicado vía migration custom post_initial/0007 (Drizzle no soporta partial
 *   unique nativo). Concurrencia validada via T-CONC-02.
 *
 * **Lifecycle:**
 *   draft → opened (initial_amount + opened_by + opened_at) → closed
 *     (final_amount + expected_amount + descuadre + discrepancy_reason + closed_by + closed_at)
 *
 * **Cierre con descuadre (RUNBOOKS/cash-discrepancy.md):**
 * - NO bloquea cierre — comerciante debe poder cerrar siempre
 * - Si `descuadre != 0` → discrepancy_reason OBLIGATORIO (CHECK constraint)
 * - Audit emite `cash_session.closed_with_difference` (warning) si descuadre != 0
 * - Métrica `cash_session.diff.amount` con tag sign incrementada
 * - Severidad para alerting Pandora team: > $5000 ARS = S2, ≤ $5000 = S3
 *
 * **NO mutable post-cierre:** una vez `closed_at IS NOT NULL`, todos los
 * campos del cierre son inmutables. Modificación post-hoc = nueva session
 * de ajuste (F1+ con trigger objetivo).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { users } from './users.js';
import { createdAt, id, tenantId, updatedAt } from './_common.js';

export const cash_sessions = pgTable(
  'cash_sessions',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    sale_point: integer('sale_point').notNull(),

    // ──── Apertura ────────────────────────────────────────
    opened_by: uuid('opened_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    opened_at: timestamp('opened_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    initial_amount: numeric('initial_amount', { precision: 19, scale: 4 }).notNull(),

    // ──── Cierre (NULL hasta cerrar) ─────────────────────
    closed_by: uuid('closed_by').references(() => users.id, { onDelete: 'restrict' }),
    closed_at: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    final_amount: numeric('final_amount', { precision: 19, scale: 4 }),
    expected_amount: numeric('expected_amount', { precision: 19, scale: 4 }),
    descuadre: numeric('descuadre', { precision: 19, scale: 4 }),
    discrepancy_reason: text('discrepancy_reason'),

    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => ({
    // Index para query "session activa del tenant + sale_point" (POS UI hot path)
    tenantSalePointIdx: index('cash_sessions_tenant_sale_point_idx').on(
      table.tenant_id,
      table.sale_point,
      table.closed_at
    ),
    // Index para reportes "todas las sessions del tenant ordenadas"
    tenantOpenedIdx: index('cash_sessions_tenant_opened_idx').on(
      table.tenant_id,
      table.opened_at
    ),

    // sale_point siempre > 0
    salePointPositiveCheck: check(
      'cash_sessions_sale_point_positive',
      sql`${table.sale_point} > 0`
    ),

    // initial_amount >= 0 (caja puede arrancar con saldo cero)
    initialAmountNonNegativeCheck: check(
      'cash_sessions_initial_amount_non_negative',
      sql`${table.initial_amount} >= 0`
    ),

    // Si closed_at NULL → resto de campos de cierre TAMBIÉN deben ser NULL
    // (no permitir estado parcialmente cerrado).
    // Si closed_at NOT NULL → final_amount + expected_amount + descuadre + closed_by
    // deben estar TODOS llenos.
    closedConsistencyCheck: check(
      'cash_sessions_closed_consistency',
      sql`(${table.closed_at} IS NULL
            AND ${table.final_amount} IS NULL
            AND ${table.expected_amount} IS NULL
            AND ${table.descuadre} IS NULL
            AND ${table.closed_by} IS NULL)
           OR
           (${table.closed_at} IS NOT NULL
            AND ${table.final_amount} IS NOT NULL
            AND ${table.expected_amount} IS NOT NULL
            AND ${table.descuadre} IS NOT NULL
            AND ${table.closed_by} IS NOT NULL)`
    ),

    // Si descuadre != 0 → discrepancy_reason debe estar (no vacío).
    // Si descuadre = 0 → discrepancy_reason puede ser NULL.
    // RUNBOOKS/cash-discrepancy: motivo obligatorio.
    discrepancyReasonCheck: check(
      'cash_sessions_discrepancy_reason_required',
      sql`${table.descuadre} IS NULL
           OR ${table.descuadre} = 0
           OR (${table.discrepancy_reason} IS NOT NULL AND length(${table.discrepancy_reason}) > 0)`
    ),

    // final_amount + expected_amount no negativos cuando están seteados.
    finalAmountNonNegativeCheck: check(
      'cash_sessions_final_amount_non_negative',
      sql`${table.final_amount} IS NULL OR ${table.final_amount} >= 0`
    ),
    expectedAmountNonNegativeCheck: check(
      'cash_sessions_expected_amount_non_negative',
      sql`${table.expected_amount} IS NULL OR ${table.expected_amount} >= 0`
    ),

    // NOTA: UNIQUE partial index `(tenant_id, sale_point) WHERE closed_at IS NULL`
    // se aplica en migration custom post_initial/0007 (Drizzle no soporta partial
    // unique nativo). Garantiza: solo 1 session abierta por (tenant, sale_point).
  })
);

export type CashSession = typeof cash_sessions.$inferSelect;
export type NewCashSession = typeof cash_sessions.$inferInsert;
