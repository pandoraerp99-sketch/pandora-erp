/**
 * Pedidos (encargos) con seña — migration 0043, ADR-0029.
 *
 * Un pedido NO es una venta: no mueve stock ni emite comprobante. La plata
 * que el cliente deja a cuenta sí es real y entra a la caja: vive en
 * `order_payments` (append-only), atada a la sesión de caja donde entró.
 *
 * Los CHECK, las FK compuestas "mismo comercio", los triggers y el RLS viven
 * en la migración; acá sólo la forma, para que Drizzle tipe las queries.
 */
import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { users } from './users.js';

/**
 * Estados persistidos. "Señado", "saldado" y "vencido" NO son estados: se
 * derivan de los cobros y de la fecha de retiro (ver domain/pedidos.ts).
 */
export const ORDER_STATUSES = [
  'tomado',
  'en_preparacion',
  'listo',
  'entregado',
  'cancelado',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_PAYMENT_KINDS = ['sena', 'parcial', 'saldo'] as const;
export type OrderPaymentKind = (typeof ORDER_PAYMENT_KINDS)[number];

/**
 * Sin `mp_qr`: el cobro por QR todavía no se verifica contra MercadoPago
 * (H-03), y anotar "pagó por QR" sin verificar es anotar plata que puede no
 * haber entrado. Esta lista y el CHECK de la 0043 tienen que coincidir.
 */
export const ORDER_PAYMENT_METHODS = [
  'efectivo',
  'debito',
  'credito',
  'transferencia',
] as const;
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  number: integer('number').notNull(),
  customer_id: uuid('customer_id'),
  customer_name: text('customer_name').notNull(),
  customer_phone: text('customer_phone'),
  pickup_date: date('pickup_date'),
  notes: text('notes'),
  status: text('status').notNull().default('tomado'),
  price_freezes: boolean('price_freezes').notNull().default(false),
  total: numeric('total', { precision: 19, scale: 4 }).notNull(),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  correlation_id: uuid('correlation_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  delivered_at: timestamp('delivered_at', { withTimezone: true }),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
});

export const order_items = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  order_id: uuid('order_id').notNull(),
  position: integer('position').notNull(),
  product_id: uuid('product_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 19, scale: 4 }).notNull(),
  unit_price: numeric('unit_price', { precision: 19, scale: 4 }).notNull(),
  line_total: numeric('line_total', { precision: 19, scale: 4 }).notNull(),
});

export const order_payments = pgTable('order_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  order_id: uuid('order_id').notNull(),
  kind: text('kind').notNull(),
  method: text('method').notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
  cash_session_id: uuid('cash_session_id').notNull(),
  created_by: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof order_items.$inferSelect;
export type OrderPayment = typeof order_payments.$inferSelect;
