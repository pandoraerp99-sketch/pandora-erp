/**
 * audit_log = append-only, particionado por anio, INMUTABLE.
 * EVENT-TAXONOMY.md §5 + CLAUDE.md §10.2.
 *
 * IMPORTANTE: Drizzle no soporta PARTITION BY nativo todavia.
 * La particion + trigger inmutabilidad se aplican via migracion SQL custom
 * en drizzle/migrations/post_initial/0001_partition_audit_log.sql.
 *
 * PRIMARY KEY COMPUESTA (id, created_at) — requerido por Postgres:
 * cuando una tabla esta PARTITION BY RANGE, la PK DEBE incluir la columna
 * de partition. SQL custom 0001 ya lo hace. Schema TS debe coincidir para
 * evitar drift cuando se haga `drizzle-kit generate`.
 * Bug B-4 fixeado 2026-05-31 (auditoria focal Paquete A).
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { ACTOR_TYPES, PII_LEVELS, SEVERITIES } from './_common.js';

export const audit_log = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).notNull(),

    event_name: text('event_name').notNull(),
    event_version: integer('event_version').notNull().default(1),

    tenant_id: uuid('tenant_id').notNull(),

    actor_user_id: uuid('actor_user_id'),
    actor_type: text('actor_type').notNull(),

    correlation_id: uuid('correlation_id').notNull(),
    request_id: uuid('request_id').notNull(),

    payload: jsonb('payload').notNull(),

    pii_level: text('pii_level').notNull().default('internal'),
    severity: text('severity').notNull().default('info'),

    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // PK compuesta — incluye created_at por requisito de PARTITION BY RANGE.
    pk: primaryKey({
      name: 'audit_log_pkey',
      columns: [table.id, table.created_at],
    }),
    tenantTimeIdx: index('audit_log_tenant_time_idx').on(
      table.tenant_id,
      table.created_at
    ),
    correlationIdx: index('audit_log_correlation_idx').on(table.correlation_id),
    eventNameIdx: index('audit_log_event_name_idx').on(
      table.tenant_id,
      table.event_name,
      table.created_at
    ),
    actorTypeCheck: check(
      'audit_log_actor_type_check',
      sql`${table.actor_type} IN (${sql.raw(ACTOR_TYPES.map((a) => `'${a}'`).join(','))})`
    ),
    piiLevelCheck: check(
      'audit_log_pii_level_check',
      sql`${table.pii_level} IN (${sql.raw(PII_LEVELS.map((p) => `'${p}'`).join(','))})`
    ),
    severityCheck: check(
      'audit_log_severity_check',
      sql`${table.severity} IN (${sql.raw(SEVERITIES.map((s) => `'${s}'`).join(','))})`
    ),
  })
);

export type AuditLog = typeof audit_log.$inferSelect;
export type NewAuditLog = typeof audit_log.$inferInsert;
