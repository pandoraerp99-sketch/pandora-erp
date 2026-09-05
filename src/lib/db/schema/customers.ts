/**
 * Registro de clientes (migration 0023).
 *
 * **No confundir con el snapshot de la venta.** `sales` guarda
 * `customer_name_snapshot` y `customer_tax_condition_snapshot`, que son
 * INMUTABLES post-emision (CLAUDE.md 2.3): lo que dice una factura vieja no
 * cambia porque el cliente cambie de condicion fiscal el ano que viene. Esta
 * tabla es la agenda; el snapshot es lo que dice el comprobante.
 *
 * **Dos clasificaciones ortogonales** (research CLIENTES 2026-07-03):
 *   - `tax_condition` — FISCAL, una sola. Decide el tipo de comprobante y
 *     viaja a ARCA como CondicionIVAReceptorId (RG 5616).
 *   - `tags` — COMERCIAL, varias. Las inventa el comerciante y habilitan
 *     promos segmentadas. Un Mayorista puede ser RI o Monotributo.
 *
 * NO hay cuenta corriente ni deuda: es un dominio de dinero que necesita su
 * propio libro append-only y toca el cierre de caja. Ver el header de la
 * migration 0023.
 */
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),

    /** DNI | CUIT | CUIL | none. 'none' = consumidor final sin identificar. */
    doc_type: text('doc_type').notNull().default('none'),
    doc_number: text('doc_number'),

    /** Condicion frente al IVA — el campo FISCAL. */
    tax_condition: text('tax_condition'),

    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    notes: text('notes'),

    /**
     * Segmentos comerciales. Array de texto libre por tenant: el vocabulario
     * se deriva de lo que hay en uso, no hay tabla de catalogo (mismo criterio
     * que products.category).
     */
    tags: text('tags').array().notNull().default([]),

    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index('customers_tenant_idx').on(table.tenant_id),
  })
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
