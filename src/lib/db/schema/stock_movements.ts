/**
 * stock_movements = bitácora append-only de movimientos de stock por tenant.
 * Sprint 3 ROADMAP Inventory context.
 *
 * **Append-only INMUTABLE** vía trigger plpgsql (RAISE EXCEPTION en UPDATE/DELETE).
 * Mismo patrón que audit_log (Sprint 2 #4) — la "cancelación" de un movimiento
 * NO es UPDATE sino INSERT de movimiento inverso (type='return' o 'adjustment').
 *
 * **Multi-tenant guard:** RLS Postgres + service-side validation (CLAUDE.md §7).
 *
 * **Reason obligatorio para `type='adjustment'`:** enforce vía CHECK constraint
 * (caller pasa reason siempre o throw). Evita "ajuste sin motivo" que confunde
 * auditoría posterior.
 *
 * **Correlation_id** opcional — heredado del tracing context (Sprint 2 #1)
 * cuando el movimiento se origina en una operación con context activo
 * (ej: venta cobrada → movement.sale).
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
import { companies } from './companies.js';
import { products } from './products.js';
import { sales } from './sales.js';
import { users } from './users.js';
import { createdAt, STOCK_MOVEMENT_TYPES } from './_common.js';

export const stock_movements = pgTable(
  'stock_movements',
  {
    // bigserial alineado con patrón append-only (audit_log, jobs_queue).
    // Stock movements pueden ser miles por tenant/día, bigserial es eficiente.
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),

    // Multi-tenant — FK con ON DELETE RESTRICT (CLAUDE.md §16.3).
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    // Producto al que aplica el movimiento.
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),

    // Tipo de movimiento (catálogo cerrado en STOCK_MOVEMENT_TYPES).
    type: text('type').notNull(),

    // Cantidad — siempre POSITIVA. El signo (suma/resta sobre stock_current)
    // se deriva del type en application service (sale/loss restan,
    // purchase/return suman, adjustment puede ser + o - según reason).
    // Decimal para soportar venta por metro/kg/litro (productos.unit_type).
    qty: numeric('qty', { precision: 19, scale: 4 }).notNull(),

    // Para adjustment: motivo obligatorio (CHECK constraint abajo).
    // Para sale: opcional (puede heredar de sales.notes).
    // Para loss: opcional pero recomendado (rotura/vencimiento/robo).
    reason: text('reason'),

    // FK opcionales — uno O el otro, no ambos (CHECK constraint).
    // related_sale_id: SOLO cuando type='sale' (o 'return' de venta previa)
    // related_purchase_id: F1+ cuando exista módulo compras (Sprint 8+ posible)
    related_sale_id: uuid('related_sale_id').references(() => sales.id, {
      onDelete: 'restrict',
    }),
    related_purchase_id: uuid('related_purchase_id'),
    // NOTA: related_purchase_id sin FK F0 porque no existe tabla purchases.
    // F1+ agregar FK cuando se construya módulo de compras.

    // Quién originó el movimiento — para audit + restricción de permisos.
    created_by: uuid('created_by').references(() => users.id, {
      onDelete: 'restrict',
    }),

    // Tracing — heredado del context cuando aplica.
    correlation_id: uuid('correlation_id'),

    created_at: createdAt(),
  },
  (table) => ({
    // Index para query "movimientos de este producto en este tenant" (típico
    // en reportes de kardex + cálculo de stock actual via SUM).
    tenantProductIdx: index('stock_movements_tenant_product_idx').on(
      table.tenant_id,
      table.product_id,
      table.created_at
    ),

    // Index para query "movimientos de esta venta" (típico al ver detalle
    // de sale).
    saleIdx: index('stock_movements_sale_idx')
      .on(table.related_sale_id)
      .where(sql`${table.related_sale_id} IS NOT NULL`),

    // Index para correlation_id (investigación cross-domain de operación).
    correlationIdx: index('stock_movements_correlation_idx')
      .on(table.correlation_id)
      .where(sql`${table.correlation_id} IS NOT NULL`),

    // Type del catálogo cerrado.
    typeCheck: check(
      'stock_movements_type_check',
      sql`${table.type} IN (${sql.raw(STOCK_MOVEMENT_TYPES.map((t) => `'${t}'`).join(','))})`
    ),

    // qty siempre positiva — el signo va por type.
    qtyPositiveCheck: check(
      'stock_movements_qty_positive',
      sql`${table.qty} > 0`
    ),

    // Reason obligatorio para adjustment — previene "ajuste sin motivo".
    // NULL aceptado para otros types (puede agregarse opcional como notes).
    adjustmentReasonCheck: check(
      'stock_movements_adjustment_reason',
      sql`${table.type} != 'adjustment' OR (${table.reason} IS NOT NULL AND length(${table.reason}) > 0)`
    ),

    // related_sale_id + related_purchase_id mutuamente exclusivos —
    // un movimiento no puede ser simultáneamente venta y compra.
    relatedExclusiveCheck: check(
      'stock_movements_related_exclusive',
      sql`NOT (${table.related_sale_id} IS NOT NULL AND ${table.related_purchase_id} IS NOT NULL)`
    ),

    // sale type implica related_sale_id (defense — sin FK que no quede huérfano).
    saleRequiresRelatedCheck: check(
      'stock_movements_sale_requires_related',
      sql`${table.type} != 'sale' OR ${table.related_sale_id} IS NOT NULL`
    ),
  })
);

export type StockMovement = typeof stock_movements.$inferSelect;
export type NewStockMovement = typeof stock_movements.$inferInsert;
