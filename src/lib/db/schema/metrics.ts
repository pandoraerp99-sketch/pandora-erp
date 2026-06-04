/**
 * metrics_counter — tabla unica para tracking de counters F0.
 * EVENT-TAXONOMY.md §4 v2.0.2 + CLAUDE.md §10.4.
 *
 * Disena para evitar **cardinality explosion** (anti-pattern §20.8):
 * - PK natural (metric_name, tenant_id, tag_key, tag_value) — NO COALESCE
 *   (Postgres no permite NULL en PK). System-wide metrics usan
 *   SYSTEM_TENANT_ID sentinel UUID `00000000-...`.
 * - Whitelist obligatoria a nivel TS (src/lib/observability/metrics.ts) —
 *   incrementCounter() throws si metric_name no esta en METRIC_WHITELIST.
 * - tag_key/tag_value default `''` cuando metric no tiene tags
 *   (PK requiere NOT NULL).
 *
 * F1+ trigger migrar a OpenTelemetry / Datadog cuando volumen lo amerite
 * (> 5M increments/dia O > 30 tenants).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const metrics_counter = pgTable(
  'metrics_counter',
  {
    metric_name: text('metric_name').notNull(),
    tenant_id: uuid('tenant_id').notNull(),
    tag_key: text('tag_key').notNull().default(''),
    tag_value: text('tag_value').notNull().default(''),
    count: bigint('count', { mode: 'bigint' }).notNull().default(BigInt(0)),
    last_incremented_at: timestamp('last_incremented_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    pk: primaryKey({
      name: 'metrics_counter_pkey',
      columns: [table.metric_name, table.tenant_id, table.tag_key, table.tag_value],
    }),
    // Index secundario para queries por tenant + recencia (dashboards)
    tenantRecentIdx: index('idx_metrics_counter_tenant_recent').on(
      table.tenant_id,
      table.last_incremented_at.desc()
    ),
  })
);

export type MetricsCounter = typeof metrics_counter.$inferSelect;
export type NewMetricsCounter = typeof metrics_counter.$inferInsert;
