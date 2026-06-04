/**
 * fiscal_snapshots = registro INMUTABLE por factura emitida.
 * ADR-0022 + RECONCILIATION-ENGINE.md.
 * Permite reproducir exactamente que se le envio a AFIP anos despues.
 *
 * Trigger anti-UPDATE/DELETE se aplica via migracion SQL custom en B5.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { INVOICE_TYPES, id, tenantId } from './_common.js';
import { companies } from './companies.js';
import { sales } from './sales.js';

export const fiscal_snapshots = pgTable(
  'fiscal_snapshots',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    sale_id: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),

    calculation_engine_version: text('calculation_engine_version').notNull(),
    tax_policy_version: text('tax_policy_version').notNull(),
    rounding_mode: text('rounding_mode').notNull(),
    rounding_stage: text('rounding_stage').notNull(),

    iva_rates_applied: jsonb('iva_rates_applied').notNull(),
    currency_code: text('currency_code').notNull().default('ARS'),

    jurisdiction_context: jsonb('jurisdiction_context').notNull(),
    fiscal_breakdown: jsonb('fiscal_breakdown').notNull(),

    wsfe_version: text('wsfe_version').notNull().default('WSFEv1'),
    wsfe_request_payload: jsonb('wsfe_request_payload'),
    wsfe_response_raw: jsonb('wsfe_response_raw'),

    sale_point: integer('sale_point'),
    invoice_type: text('invoice_type'),
    invoice_number: integer('invoice_number'),

    cae: text('cae'),
    cae_expiry_date: date('cae_expiry_date'),

    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    saleUnique: unique('fiscal_snapshots_sale_unique').on(table.sale_id),
    tenantIdx: index('fiscal_snapshots_tenant_idx').on(
      table.tenant_id,
      table.created_at
    ),
    caeIdx: index('fiscal_snapshots_cae_idx').on(table.tenant_id, table.cae),
    invoiceNumberIdx: index('fiscal_snapshots_invoice_number_idx').on(
      table.tenant_id,
      table.sale_point,
      table.invoice_type,
      table.invoice_number
    ),
    invoiceTypeCheck: check(
      'fiscal_snapshots_invoice_type_check',
      sql`${table.invoice_type} IS NULL OR ${table.invoice_type} IN (${sql.raw(INVOICE_TYPES.map((t) => `'${t}'`).join(','))})`
    ),
    roundingModeCheck: check(
      'fiscal_snapshots_rounding_mode_check',
      sql`${table.rounding_mode} = 'HALF_EVEN'`
    ),
  })
);

export type FiscalSnapshot = typeof fiscal_snapshots.$inferSelect;
export type NewFiscalSnapshot = typeof fiscal_snapshots.$inferInsert;
