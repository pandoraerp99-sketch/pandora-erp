/**
 * invoice_sequences = numeracion fiscal por (tenant, sale_point, invoice_type).
 * ADR-0006: SELECT FOR UPDATE bloqueo pesimista para evitar colisiones.
 * El campo next_number SOLO se incrementa dentro de transaccion con lock.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { INVOICE_TYPES, createdAt, id, tenantId, updatedAt } from './_common.js';
import { companies } from './companies.js';

export const invoice_sequences = pgTable(
  'invoice_sequences',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    sale_point: integer('sale_point').notNull(),
    invoice_type: text('invoice_type').notNull(),

    next_number: integer('next_number').notNull().default(1),

    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => ({
    uniqueSequence: unique('invoice_sequences_unique').on(
      table.tenant_id,
      table.sale_point,
      table.invoice_type
    ),
    invoiceTypeCheck: check(
      'invoice_sequences_invoice_type_check',
      sql`${table.invoice_type} IN (${sql.raw(INVOICE_TYPES.map((t) => `'${t}'`).join(','))})`
    ),
    salePointPositiveCheck: check(
      'invoice_sequences_sale_point_positive',
      sql`${table.sale_point} > 0`
    ),
    nextNumberPositiveCheck: check(
      'invoice_sequences_next_number_positive',
      sql`${table.next_number} >= 1`
    ),
  })
);

export type InvoiceSequence = typeof invoice_sequences.$inferSelect;
export type NewInvoiceSequence = typeof invoice_sequences.$inferInsert;
