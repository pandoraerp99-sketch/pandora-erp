/**
 * sale_payments — registros granulares de pagos por venta.
 * Sprint 5 ROADMAP Sales+MP context.
 *
 * **Por qué tabla separada (no JSON inline en sales.payment_breakdown):**
 * - MP webhook necesita un FK concreto (`mp_payments.sale_payment_id`) para
 *   conciliar webhook ↔ payment específico de una venta.
 * - Reporting al contador (mensual: total efectivo / tarjeta / MP) es 1 SQL
 *   simple en lugar de JSON parsing en text.
 * - Multi-pago real (efectivo + tarjeta en una sola venta) es trivial — 1 row
 *   por método. `sales.payment_method='mixto'` queda como denormalizado.
 *
 * **Append-only post-INSERT** (mismo patrón stock_movements + cash_movements):
 * Cancelación de payment = INSERT inverso con amount negativo NO — el patrón
 * es void/refund vía mp_payments.status='refunded' + sale.commercial_status
 * = 'cancelada'. sale_payments NUNCA UPDATE/DELETE.
 *
 * **Método ∈ {efectivo, tarjeta, mp_qr}** (NO incluye 'mixto' — ese valor
 * solo aplica al campo denormalizado `sales.payment_method` cuando hay 2+
 * sale_payments con methods distintos para la misma sale).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import {
  SALE_PAYMENT_METHODS,
  createdAt,
  id,
  tenantId,
} from './_common.js';
import { sales } from './sales.js';
import { cash_sessions } from './cash_sessions.js';

export const sale_payments = pgTable(
  'sale_payments',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, {
      onDelete: 'restrict',
    }),
    sale_id: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),

    method: text('method').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),

    /**
     * cash_session activa al momento del payment (solo si method='efectivo'
     * y hay session abierta en el sale_point). Nullable: si la venta no es
     * cash o no hay session activa, queda en NULL. ON DELETE SET NULL —
     * si la session se borrara por error operativo, el payment queda
     * histórico sin link (NO se borra).
     */
    cash_session_id: uuid('cash_session_id').references(() => cash_sessions.id, {
      onDelete: 'set null',
    }),

    /**
     * ID externo MercadoPago (lo que MP nos devuelve en createPayment + webhook).
     * Solo se setea si method='mp_qr'. Permite conciliar webhook → sale_payment
     * vía LOOKUP por mp_payment_external_id ANTES de tener mp_payments.id
     * insertado.
     */
    mp_payment_external_id: text('mp_payment_external_id'),

    created_at: createdAt(),
  },
  (table) => ({
    saleIdx: index('sale_payments_sale_idx').on(table.sale_id),
    tenantMethodIdx: index('sale_payments_tenant_method_idx').on(
      table.tenant_id,
      table.method,
      table.created_at
    ),
    /**
     * Index partial: solo rows con cash_session_id NOT NULL.
     * Usado por el cash session close para computar expected_amount =
     * initial + sum(sale_payments WHERE cash_session_id = X).
     */
    cashSessionIdx: index('sale_payments_cash_session_idx')
      .on(table.cash_session_id)
      .where(sql`${table.cash_session_id} IS NOT NULL`),
    /**
     * Index partial para lookup MP webhook → sale_payment.
     * Solo rows con mp_payment_external_id NOT NULL.
     */
    mpExternalIdx: index('sale_payments_mp_external_idx')
      .on(table.tenant_id, table.mp_payment_external_id)
      .where(sql`${table.mp_payment_external_id} IS NOT NULL`),
    methodCheck: check(
      'sale_payments_method_check',
      sql`${table.method} IN (${sql.raw(SALE_PAYMENT_METHODS.map((m) => `'${m}'`).join(','))})`
    ),
    amountPositiveCheck: check(
      'sale_payments_amount_positive',
      sql`${table.amount} > 0`
    ),
  })
);

export type SalePayment = typeof sale_payments.$inferSelect;
export type NewSalePayment = typeof sale_payments.$inferInsert;
