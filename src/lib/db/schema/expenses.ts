/**
 * Gastos del comercio (migration 0026).
 *
 * APPEND-ONLY con triggers en la base: corregir es registrar un gasto de
 * ajuste, no editar. Un gasto editable después de que la contadora lo usó para
 * una DDJJ es un problema, no una comodidad.
 *
 * Ver RESEARCH-BRIEF-gastos.md.
 */
import {
  bigint,
  boolean,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { terceros } from './terceros.js';
import { users } from './users.js';

/** Categorías tomadas del pedido real de la contadora, no inventadas. */
export const EXPENSE_CATEGORIES = [
  'alquiler',
  'seguros',
  'servicios',
  'impuestos_y_tasas',
  'honorarios',
  'mercaderia',
  'otros',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Sólo `efectivo` genera movimiento de caja. */
export const EXPENSE_PAYMENT_METHODS = [
  'efectivo',
  'transferencia',
  'debito',
  'credito',
  'otro',
] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    /** Fecha DEL GASTO, no de la carga: se cargan atrasados todo el tiempo. */
    fecha: date('fecha').notNull(),
    categoria: text('categoria').notNull(),

    /** Opcional. El nombre va aparte, como snapshot. */
    tercero_id: uuid('tercero_id').references(() => terceros.id, {
      onDelete: 'restrict',
    }),
    payee_name: text('payee_name'),
    /** CUIT al momento del gasto. La contadora lo pide para el detalle. */
    payee_doc: text('payee_doc'),

    neto: numeric('neto', { precision: 19, scale: 4 }).notNull().default('0'),
    iva: numeric('iva', { precision: 19, scale: 4 }).notNull().default('0'),
    total: numeric('total', { precision: 19, scale: 4 }).notNull(),

    descripcion: text('descripcion'),
    comprobante_tipo: text('comprobante_tipo'),
    comprobante_numero: text('comprobante_numero'),

    /**
     * Si entra al IVA compras. Los que SÍ, el estudio ya los baja de ARCA; los
     * que NO son los que el comercio tiene que mandar. Sin esta separación el
     * export duplica lo que la contadora ya tiene.
     */
    en_iva_compras: boolean('en_iva_compras').notNull().default(false),

    medio_pago: text('medio_pago').notNull(),
    // bigint: cash_movements usa bigserial.
    cash_movement_id: bigint('cash_movement_id', { mode: 'bigint' }),

    created_by: uuid('created_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantFechaIdx: index('expenses_tenant_fecha_idx').on(
      table.tenant_id,
      table.fecha
    ),
  })
);

export type Expense = typeof expenses.$inferSelect;
