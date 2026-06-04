/**
 * cash_movements = movimientos MANUALES de caja dentro de una session.
 * Sprint 4 ROADMAP Cash context (C-OPS-01) + BOUNDED-CONTEXTS Cash.
 *
 * **No incluye ventas.** Las ventas afectan caja vía `sales` + `sale_payments`
 * (Sprint 5). Esta tabla es para movimientos manuales:
 * - `withdraw`: comerciante retira efectivo (gastos del día, llevar al banco)
 * - `deposit`: comerciante aporta efectivo (caja chica, dinero suelto)
 * - `provider_payment`: pago en efectivo a proveedor desde caja
 *
 * **Append-only (igual patrón stock_movements):**
 * Trigger SQL (`cash_movements_immutable`, migration 0007) bloquea UPDATE/DELETE.
 * Cancelación de un movimiento = INSERT movimiento inverso (withdraw → deposit,
 * y viceversa) con reason que cite el movimiento original.
 *
 * **Multi-tenant guard:** `cash_session_id` FK garantiza que el movimiento
 * pertenece a una session existente (RLS + service validation aplican via
 * la session, no directo acá).
 *
 * **Reason siempre obligatorio:** evita movimientos sin trazabilidad
 * (anti-pattern §20.5 mutable audit). CHECK constraint enforce.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  numeric,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { cash_sessions } from './cash_sessions.js';
import { users } from './users.js';
import { createdAt, CASH_MOVEMENT_TYPES } from './_common.js';

export const cash_movements = pgTable(
  'cash_movements',
  {
    // bigserial alineado con patrón append-only (audit_log, stock_movements).
    // Cash movements: pocos por día por session (~5-20 típico), bigserial sobra.
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),

    // FK a session — ON DELETE RESTRICT preserva histórico (movimientos NO
    // se borran si se borra session; debería ser imposible vía service).
    cash_session_id: uuid('cash_session_id')
      .notNull()
      .references(() => cash_sessions.id, { onDelete: 'restrict' }),

    // Tipo del catálogo cerrado.
    type: text('type').notNull(),

    // amount SIEMPRE positivo — el signo deriva del type en application service.
    // withdraw/provider_payment restan al saldo caja, deposit suma.
    // Scale 4 alineado con el resto del schema money.
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),

    // reason OBLIGATORIO siempre (CHECK constraint + service validation).
    reason: text('reason').notNull(),

    // Quién registró el movimiento — para audit + permisos.
    created_by: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    // Tracing — heredado del context cuando aplica.
    correlation_id: uuid('correlation_id'),

    created_at: createdAt(),
  },
  (table) => ({
    // Index para query "movimientos de esta session ordenados" (RUNBOOK cash-discrepancy
    // paso 2: revisar movimientos del día).
    sessionIdx: index('cash_movements_session_idx').on(
      table.cash_session_id,
      table.created_at
    ),

    // Index para correlation_id (investigación cross-domain).
    correlationIdx: index('cash_movements_correlation_idx')
      .on(table.correlation_id)
      .where(sql`${table.correlation_id} IS NOT NULL`),

    // Type del catálogo cerrado.
    typeCheck: check(
      'cash_movements_type_check',
      sql`${table.type} IN (${sql.raw(CASH_MOVEMENT_TYPES.map((t) => `'${t}'`).join(','))})`
    ),

    // amount > 0 siempre (signo deriva del type).
    amountPositiveCheck: check('cash_movements_amount_positive', sql`${table.amount} > 0`),

    // reason siempre no vacío (defense en service + DB).
    reasonNotEmptyCheck: check(
      'cash_movements_reason_not_empty',
      sql`length(${table.reason}) > 0`
    ),
  })
);

export type CashMovement = typeof cash_movements.$inferSelect;
export type NewCashMovement = typeof cash_movements.$inferInsert;
