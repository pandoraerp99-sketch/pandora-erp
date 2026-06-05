/**
 * mp_payments — tracking de transacciones MercadoPago (webhook events processed).
 * Sprint 5 ROADMAP Sales+MP context.
 *
 * **Flujo:**
 * 1. POS llama createPayment(MP API) → recibe `mp_payment_id` external.
 * 2. INSERT mp_payments con status='pending' + sale_id + sale_payment_id.
 * 3. MP envía webhook(s) → handler valida HMAC + dedup vía
 *    `processed_webhook_events` (Sprint 1 #2).
 * 4. UPDATE mp_payments.status + reconciled_at.
 * 5. Si status='approved' → sale.commercial_status='cobrada' (si no estaba).
 *    Si status='rejected'/'cancelled' → sale.commercial_status='cancelada'.
 *
 * **Multi-tenant:** UNIQUE per (tenant_id, mp_payment_id) — MP no garantiza
 * unicidad global de payment IDs entre distintas integraciones MP, así que
 * cubrimos cross-tenant explícito.
 *
 * **UPDATEs permitidos** (NO append-only como sale_payments): el estado
 * cambia con cada webhook (pending → approved/rejected → refunded).
 * Audit del cambio queda en `audit_log` event 'mp.payment_status_changed'.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import {
  MP_PAYMENT_STATUSES,
  createdAt,
  id,
  tenantId,
  updatedAt,
} from './_common.js';
import { sales } from './sales.js';
import { sale_payments } from './sale_payments.js';

export const mp_payments = pgTable(
  'mp_payments',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, {
      onDelete: 'restrict',
    }),
    /**
     * sale + sale_payment FK opcionales: si el webhook llega ANTES que
     * el INSERT inicial desde el POS (race condition raro), mp_payments
     * queda sin sale link hasta que el handler concilie.
     */
    sale_id: uuid('sale_id').references(() => sales.id, {
      onDelete: 'restrict',
    }),
    sale_payment_id: uuid('sale_payment_id').references(
      () => sale_payments.id,
      { onDelete: 'restrict' }
    ),

    /**
     * ID externo MercadoPago (lo que MP nos devuelve). UNIQUE por tenant.
     */
    mp_payment_id: text('mp_payment_id').notNull(),

    status: text('status').notNull(),

    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),

    /**
     * Timestamp del último webhook recibido para este mp_payment.
     * Nullable hasta primer webhook.
     */
    webhook_received_at: timestamp('webhook_received_at', {
      withTimezone: true,
      mode: 'date',
    }),

    /**
     * Timestamp de la primera conciliación exitosa (sale.cobrada o equivalente).
     * Nullable hasta conciliar.
     */
    reconciled_at: timestamp('reconciled_at', {
      withTimezone: true,
      mode: 'date',
    }),

    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => ({
    /**
     * UNIQUE (tenant_id, mp_payment_id) — clave de negocio. Permite dos
     * tenants distintos con mp_payment_id colisionando (improbable pero
     * defensa explícita).
     */
    tenantExternalUnique: uniqueIndex('mp_payments_tenant_external_unique').on(
      table.tenant_id,
      table.mp_payment_id
    ),
    /**
     * Index para queries por status (dashboard pendientes, reconciliación
     * pendiente, etc.).
     */
    statusIdx: index('mp_payments_status_idx').on(
      table.tenant_id,
      table.status,
      table.created_at
    ),
    saleIdx: index('mp_payments_sale_idx').on(table.sale_id),
    statusCheck: check(
      'mp_payments_status_check',
      sql`${table.status} IN (${sql.raw(MP_PAYMENT_STATUSES.map((s) => `'${s}'`).join(','))})`
    ),
    amountPositiveCheck: check(
      'mp_payments_amount_positive',
      sql`${table.amount} > 0`
    ),
  })
);

export type MpPayment = typeof mp_payments.$inferSelect;
export type NewMpPayment = typeof mp_payments.$inferInsert;
