/**
 * Companies = tenants. Cada comercio (sederia, rotiseria, kiosko) es una company.
 * ADR-0002 multi-tenant + ADR-0022 jurisdiction context.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import {
  AFIP_ENVIRONMENTS,
  DEMO_STATUSES,
  JURISDICTION_PROVINCES,
  SPECIAL_REGIMES,
  TAX_REGIMES,
  createdAt,
  id,
  updatedAt,
} from './_common.js';

export const companies = pgTable(
  'companies',
  {
    id: id(),

    name: text('name').notNull(),
    legal_name: text('legal_name'),
    cuit: text('cuit').notNull().unique(),

    tax_regime: text('tax_regime').notNull(),

    merchant_jurisdiction_province: text('merchant_jurisdiction_province').notNull(),
    merchant_special_regime: text('merchant_special_regime'),

    afip_environment: text('afip_environment').notNull().default('homologacion'),
    afip_sale_point: text('afip_sale_point').notNull().default('0001'),

    demo_status: text('demo_status').notNull().default('trial'),
    demo_trial_started_at: timestamp('demo_trial_started_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .default(sql`now()`),

    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => ({
    taxRegimeCheck: check(
      'companies_tax_regime_check',
      sql`${table.tax_regime} IN (${sql.raw(TAX_REGIMES.map((r) => `'${r}'`).join(','))})`
    ),
    jurisdictionCheck: check(
      'companies_jurisdiction_check',
      sql`${table.merchant_jurisdiction_province} IN (${sql.raw(JURISDICTION_PROVINCES.map((j) => `'${j}'`).join(','))})`
    ),
    specialRegimeCheck: check(
      'companies_special_regime_check',
      sql`${table.merchant_special_regime} IS NULL OR ${table.merchant_special_regime} IN (${sql.raw(SPECIAL_REGIMES.map((s) => `'${s}'`).join(','))})`
    ),
    afipEnvCheck: check(
      'companies_afip_environment_check',
      sql`${table.afip_environment} IN (${sql.raw(AFIP_ENVIRONMENTS.map((e) => `'${e}'`).join(','))})`
    ),
    demoStatusCheck: check(
      'companies_demo_status_check',
      sql`${table.demo_status} IN (${sql.raw(DEMO_STATUSES.map((d) => `'${d}'`).join(','))})`
    ),
    cuitFormatCheck: check(
      'companies_cuit_format_check',
      sql`${table.cuit} ~ '^[0-9]{11}$'`
    ),
  })
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
