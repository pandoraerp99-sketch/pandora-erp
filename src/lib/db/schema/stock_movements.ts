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
  date,
  index,
  numeric,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { expenses } from './expenses.js';
import { products } from './products.js';
import { sales } from './sales.js';
import { users } from './users.js';
import {
  createdAt,
  MOTIVOS_AJUSTE_CORRECCION_DB,
  MOTIVOS_AJUSTE_MERMA_DB,
  type MotivoAjusteDb,
  MOVEMENT_DIRECTIONS,
  STOCK_MOVEMENT_TYPES,
  type MovementDirection,
} from './_common.js';

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

    // Cantidad — siempre POSITIVA. El signo vive en `direction`.
    // Decimal para soportar venta por metro/kg/litro (productos.unit_type).
    qty: numeric('qty', { precision: 19, scale: 4 }).notNull(),

    // Signo del movimiento (migration 0032): 'in' suma, 'out' resta.
    //
    // Para sale/loss/purchase/return se deriva del type y guardarlo es
    // redundante a propósito: quien lee el ledger hace UNA cuenta
    // (`CASE WHEN direction='in' THEN qty ELSE -qty END`) sin conocer el
    // catálogo de types.
    //
    // Para `adjustment` NO es redundante: la elige quien ajusta y no se puede
    // reconstruir después. Antes de 0032 no se guardaba, y dos ajustes de la
    // misma cantidad en sentidos opuestos quedaban como filas idénticas.
    direction: text('direction').$type<MovementDirection>().notNull(),

    // Por qué se ajustó a mano (migration 0038), de la lista cerrada de
    // `domain/ajuste-stock.ts`. Merma (rotura/vencimiento/robo) ⇔ type 'loss';
    // corrección (recuento/error_carga/otro) ⇒ 'adjustment'. NULL en los
    // movimientos del sistema, cuyo origen está en su vínculo.
    motivo: text('motivo').$type<MotivoAjusteDb>(),

    // Para adjustment: motivo obligatorio (CHECK constraint abajo).
    // Para sale: opcional (puede heredar de sales.notes).
    // Para loss: opcional pero recomendado (rotura/vencimiento/robo).
    reason: text('reason'),

    // FK opcionales — uno O el otro, no ambos (CHECK constraint).
    // related_sale_id: SOLO cuando type='sale' (o 'return' de venta previa)
    // related_expense_id: el comprobante de compra — en el `purchase` que lo
    //   entró y, desde la migration 0037, también en el `adjustment`/out que lo
    //   revierte al anularlo. Para saber si una fila ES la compra, mirar `type`.
    //
    // Hasta la migration 0034 esto era `related_purchase_id`, un uuid sin FK
    // que esperaba una tabla `purchases` que no va a existir: la compra ES un
    // gasto con líneas. Se renombró en vez de dejar el nombre viejo apuntando
    // a `expenses`, que habría sido un nombre mintiendo sobre su referente.
    related_sale_id: uuid('related_sale_id').references(() => sales.id, {
      onDelete: 'restrict',
    }),
    related_expense_id: uuid('related_expense_id').references(() => expenses.id, {
      onDelete: 'restrict',
    }),

    // Quién originó el movimiento — para audit + restricción de permisos.
    created_by: uuid('created_by').references(() => users.id, {
      onDelete: 'restrict',
    }),

    // Tracing — heredado del context cuando aplica.
    correlation_id: uuid('correlation_id'),

    // El día en que el movimiento PASÓ (migration 0037) — lo que leen los
    // reportes. `created_at` es cuándo se escribió la fila, y no es lo mismo:
    // un comprobante de julio se carga en septiembre.
    //
    //  * purchase                 → la fecha del comprobante.
    //  * reversa de una anulación → la del comprobante original.
    //  * todo lo demás            → el día del comercio en que se cargó (default).
    fecha: date('fecha', { mode: 'string' })
      .notNull()
      .default(sql`(now() AT TIME ZONE 'America/Argentina/Ushuaia')::date`),

    created_at: createdAt(),
  },
  (table) => ({
    // El inventario al cierre suma el libro hasta una fecha (migration 0037).
    tenantProductFechaIdx: index('stock_movements_tenant_product_fecha_idx').on(
      table.tenant_id,
      table.product_id,
      table.fecha
    ),

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

    // Direction del catálogo cerrado (migration 0032).
    directionCheck: check(
      'stock_movements_direction_check',
      sql`${table.direction} IN (${sql.raw(MOVEMENT_DIRECTIONS.map((d) => `'${d}'`).join(','))})`
    ),

    // Motivo coherente con el type (migration 0038). El `IS NOT NULL` de cada
    // rama no es redundante: sin él, `NULL IN (...)` da NULL y la CHECK se
    // considera cumplida (una merma sin motivo entraba).
    motivoCheck: check(
      'stock_movements_motivo_check',
      sql`(${table.motivo} IS NULL AND ${table.type} <> 'loss')
        OR (${table.motivo} IS NOT NULL AND ${table.motivo} IN (${sql.raw(MOTIVOS_AJUSTE_MERMA_DB.map((m) => `'${m}'`).join(','))}) AND ${table.type} = 'loss')
        OR (${table.motivo} IS NOT NULL AND ${table.motivo} IN (${sql.raw(MOTIVOS_AJUSTE_CORRECCION_DB.map((m) => `'${m}'`).join(','))}) AND ${table.type} = 'adjustment')`
    ),

    // Una merma siempre sale (migration 0038).
    lossOutCheck: check(
      'stock_movements_loss_out_check',
      sql`${table.type} <> 'loss' OR ${table.direction} = 'out'`
    ),

    // qty siempre positiva — el signo va por `direction`.
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

    // related_sale_id + related_expense_id mutuamente exclusivos —
    // un movimiento no puede ser simultáneamente venta y compra.
    relatedExclusiveCheck: check(
      'stock_movements_related_exclusive',
      sql`NOT (${table.related_sale_id} IS NOT NULL AND ${table.related_expense_id} IS NOT NULL)`
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
