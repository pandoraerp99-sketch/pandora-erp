/**
 * Products = catalogo de cada tenant.
 * Soporta SKU + barcode + Ley 19.640 TDF flag + stock minimo + tipo unidad.
 * Cantidades en decimal para soportar venta por metro (sederia) o peso.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { createdAt, id, tenantId, updatedAt } from './_common.js';

export const UNIT_TYPES = ['unidad', 'metro', 'kg', 'gramo', 'litro', 'docena'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const products = pgTable(
  'products',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    description: text('description'),
    sku: text('sku'),
    barcode: text('barcode'),

    unit_type: text('unit_type').notNull().default('unidad'),

    price: numeric('price', { precision: 19, scale: 4 }).notNull(),
    cost: numeric('cost', { precision: 19, scale: 4 }),

    tax_rate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('21.00'),
    tdf_exempt: boolean('tdf_exempt').notNull().default(false),

    stock_current: numeric('stock_current', { precision: 19, scale: 4 })
      .notNull()
      .default('0'),
    stock_minimum: numeric('stock_minimum', { precision: 19, scale: 4 }),
    stock_tracking_enabled: boolean('stock_tracking_enabled').notNull().default(true),

    is_active: boolean('is_active').notNull().default(true),

    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => ({
    // Partial unique indexes: SOLO aplican cuando sku/barcode no son NULL.
    // Esto permite tener muchos productos sin SKU (caso real: comercio que carga
    // lista inicial sin codificar) y al mismo tiempo previene duplicados de SKU
    // explicito dentro del mismo tenant.
    skuUniquePartial: uniqueIndex('products_tenant_sku_unique_partial')
      .on(table.tenant_id, table.sku)
      .where(sql`${table.sku} IS NOT NULL`),
    barcodeUniquePartial: uniqueIndex('products_tenant_barcode_unique_partial')
      .on(table.tenant_id, table.barcode)
      .where(sql`${table.barcode} IS NOT NULL`),
    tenantIdx: index('products_tenant_idx').on(table.tenant_id),
    barcodeIdx: index('products_barcode_idx').on(table.tenant_id, table.barcode),
    unitTypeCheck: check(
      'products_unit_type_check',
      sql`${table.unit_type} IN (${sql.raw(UNIT_TYPES.map((u) => `'${u}'`).join(','))})`
    ),
    priceNonNegativeCheck: check(
      'products_price_non_negative',
      sql`${table.price} >= 0`
    ),
    taxRateRangeCheck: check(
      'products_tax_rate_range',
      sql`${table.tax_rate} >= 0 AND ${table.tax_rate} <= 100`
    ),
  })
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
