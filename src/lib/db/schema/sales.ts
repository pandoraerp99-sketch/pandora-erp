/**
 * Sales = ventas + lineas. State machine canonica per CLAUDE.md §12.2.
 * Snapshot inmutable de datos de cliente al momento de emision.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
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
import {
  COMMERCIAL_STATUSES,
  CUSTOMER_DOC_TYPES,
  FISCAL_STATUSES,
  PAYMENT_METHODS,
  createdAt,
  id,
  tenantId,
  updatedAt,
} from './_common.js';
import { cash_sessions } from './cash_sessions.js';
import { products } from './products.js';
import { users } from './users.js';

export const sales = pgTable(
  'sales',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    correlation_id: uuid('correlation_id').notNull(),

    cashier_user_id: uuid('cashier_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /**
     * Sale point (caja) — número de caja física donde se hizo la venta.
     * F0 default 1 para retail TDF (1 caja por comercio típicamente).
     * Sprint 5 Bloque 3 (Sales↔Cash linkage): finalizeSale lookup
     * cash_session activa por (tenant_id, sale_point) usando este campo.
     * Migration 0009.
     */
    sale_point: integer('sale_point').notNull().default(1),

    commercial_status: text('commercial_status').notNull().default('draft'),
    fiscal_status: text('fiscal_status').notNull().default('not_required'),

    subtotal: numeric('subtotal', { precision: 19, scale: 4 }).notNull().default('0'),
    tax_amount: numeric('tax_amount', { precision: 19, scale: 4 })
      .notNull()
      .default('0'),
    exempt_amount: numeric('exempt_amount', { precision: 19, scale: 4 })
      .notNull()
      .default('0'),
    total: numeric('total', { precision: 19, scale: 4 }).notNull().default('0'),

    payment_method: text('payment_method'),
    payment_breakdown: text('payment_breakdown'),

    /**
     * Cash session activa al momento del finalize (solo si la venta tuvo
     * payments en efectivo y había session abierta en el sale_point).
     * Nullable. ON DELETE SET NULL para no romper sales si se borrara una
     * session por error operativo (NO se debería borrar — ver trigger
     * cash_sessions_immutable_after_close). Sprint 5 integración Cash.
     */
    cash_session_id: uuid('cash_session_id').references(() => cash_sessions.id, {
      onDelete: 'set null',
    }),

    customer_doc_type: text('customer_doc_type').default('none'),
    customer_doc_number: text('customer_doc_number'),
    customer_name_snapshot: text('customer_name_snapshot'),
    customer_tax_condition_snapshot: text('customer_tax_condition_snapshot'),

    cancellation_reason: text('cancellation_reason'),

    created_at: createdAt(),
    updated_at: updatedAt(),
    finalized_at: timestamp('finalized_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => ({
    tenantIdx: index('sales_tenant_idx').on(table.tenant_id, table.created_at),
    correlationIdx: index('sales_correlation_idx').on(table.correlation_id),
    cashierIdx: index('sales_cashier_idx').on(table.tenant_id, table.cashier_user_id),
    fiscalStatusIdx: index('sales_fiscal_status_idx').on(
      table.tenant_id,
      table.fiscal_status
    ),
    /**
     * Index partial: solo sales con cash_session_id NOT NULL. Usado por el
     * cash session close para computar expected_amount.
     */
    cashSessionIdx: index('sales_cash_session_idx')
      .on(table.cash_session_id)
      .where(sql`${table.cash_session_id} IS NOT NULL`),
    /**
     * Index (tenant_id, sale_point, created_at) — queries típicas filtran
     * por caja. Mismo patrón que tenantIdx pero con sale_point intermedio.
     * Sprint 5 Bloque 3 (migration 0009).
     */
    saleTenantPointIdx: index('sales_tenant_sale_point_idx').on(
      table.tenant_id,
      table.sale_point,
      table.created_at
    ),
    commercialStatusCheck: check(
      'sales_commercial_status_check',
      sql`${table.commercial_status} IN (${sql.raw(COMMERCIAL_STATUSES.map((s) => `'${s}'`).join(','))})`
    ),
    fiscalStatusCheck: check(
      'sales_fiscal_status_check',
      sql`${table.fiscal_status} IN (${sql.raw(FISCAL_STATUSES.map((s) => `'${s}'`).join(','))})`
    ),
    paymentMethodCheck: check(
      'sales_payment_method_check',
      sql`${table.payment_method} IS NULL OR ${table.payment_method} IN (${sql.raw(PAYMENT_METHODS.map((p) => `'${p}'`).join(','))})`
    ),
    customerDocCheck: check(
      'sales_customer_doc_type_check',
      sql`${table.customer_doc_type} IN (${sql.raw(CUSTOMER_DOC_TYPES.map((d) => `'${d}'`).join(','))})`
    ),
    /**
     * sale_point > 0 — mismo guard que cash_sessions_sale_point_positive
     * (Sprint 4). Defense-in-depth contra updates erróneos a 0/negativo.
     */
    salePointPositiveCheck: check(
      'sales_sale_point_positive',
      sql`${table.sale_point} > 0`
    ),
  })
);

export const sale_items = pgTable(
  'sale_items',
  {
    id: id(),
    sale_id: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),

    product_name_snapshot: text('product_name_snapshot').notNull(),
    product_sku_snapshot: text('product_sku_snapshot'),
    /**
     * Snapshot del unit_type del producto al momento del addItem.
     * Necesario para validar cantidad entera vs decimal en recalculos
     * (updateItemQuantity, finalizeSale) sin hacer N+1 query al product.
     * Default 'unidad' para preservar comportamiento si llega un valor invalido.
     */
    product_unit_type_snapshot: text('product_unit_type_snapshot')
      .notNull()
      .default('unidad'),

    unit_price: numeric('unit_price', { precision: 19, scale: 4 }).notNull(),
    quantity: numeric('quantity', { precision: 19, scale: 4 }).notNull(),

    tax_rate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull(),
    tdf_exempt: boolean('tdf_exempt').notNull().default(false),

    line_subtotal: numeric('line_subtotal', { precision: 19, scale: 4 }).notNull(),
    line_tax: numeric('line_tax', { precision: 19, scale: 4 }).notNull(),
    line_total: numeric('line_total', { precision: 19, scale: 4 }).notNull(),

    created_at: createdAt(),
  },
  (table) => ({
    saleIdx: index('sale_items_sale_idx').on(table.sale_id),
    productIdx: index('sale_items_product_idx').on(table.tenant_id, table.product_id),
    quantityPositiveCheck: check(
      'sale_items_quantity_positive',
      sql`${table.quantity} > 0`
    ),
  })
);

export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;
export type SaleItem = typeof sale_items.$inferSelect;
export type NewSaleItem = typeof sale_items.$inferInsert;
