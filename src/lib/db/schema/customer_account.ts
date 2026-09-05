/**
 * Libro de cuenta corriente de clientes (migration 0024, ADR-0027).
 *
 * APPEND-ONLY, con triggers en la base que bloquean UPDATE y DELETE. Corregir
 * es agregar un movimiento de tipo `adjustment` con su motivo, nunca editar.
 *
 * NO hay `customers.saldo`: el saldo se CALCULA sumando el libro. Un saldo
 * denormalizado y un libro divergen, y cuando divergen nadie sabe cual tiene
 * razon (CLAUDE.md 20.26).
 */
import {
  bigint,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { customers } from './customers.js';
import { sales } from './sales.js';
import { users } from './users.js';

/** charge = venta a cuenta · payment = el cliente paga · adjustment = correccion */
export const ACCOUNT_MOVEMENT_TYPES = ['charge', 'payment', 'adjustment'] as const;
export type AccountMovementType = (typeof ACCOUNT_MOVEMENT_TYPES)[number];

export const customer_account_movements = pgTable(
  'customer_account_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    customer_id: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),

    type: text('type').notNull(),

    /** SIEMPRE positivo. El signo lo da el `type`, no el numero. */
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),

    sale_id: uuid('sale_id').references(() => sales.id, { onDelete: 'restrict' }),

    /**
     * Con que pago. Solo en 'payment'. El efectivo ADEMAS genera un
     * cash_movements ligado a la sesion abierta; transferencia y tarjeta NO
     * tocan la caja.
     */
    payment_method: text('payment_method'),
    // mode 'bigint': cash_movements.id es bigserial y el driver lo devuelve
    // como bigint, no como number.
    cash_movement_id: bigint('cash_movement_id', { mode: 'bigint' }),

    /** Obligatorio en 'adjustment'. */
    reason: text('reason'),

    created_by: uuid('created_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantCustomerIdx: index('cam_tenant_customer_idx').on(
      table.tenant_id,
      table.customer_id,
      table.created_at
    ),
  })
);

export type CustomerAccountMovement =
  typeof customer_account_movements.$inferSelect;
