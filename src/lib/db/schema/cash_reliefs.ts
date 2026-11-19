/**
 * Alivios de caja — migration 0044. Los CHECK, FK compuestas, triggers
 * append-only y RLS viven en la migración; acá sólo la forma para Drizzle.
 */
import { bigint, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { users } from './users.js';

/** Qué retiro fue un alivio. */
export const cash_reliefs = pgTable('cash_reliefs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  cash_session_id: uuid('cash_session_id').notNull(),
  cash_movement_id: bigint('cash_movement_id', { mode: 'bigint' }).notNull(),
  created_by: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Quién retiró el alivio y cuándo. Uno por alivio. */
export const cash_relief_pickups = pgTable('cash_relief_pickups', {
  relief_id: uuid('relief_id').primaryKey(),
  tenant_id: uuid('tenant_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  picked_by: uuid('picked_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  picked_at: timestamp('picked_at', { withTimezone: true }).notNull().defaultNow(),
});
