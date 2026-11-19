/**
 * Fijo / variable / mixto de cada gasto — migration 0045. Append-only: la
 * clasificación vigente es la fila más reciente del gasto. CHECK, FK
 * compuesta, trigger y RLS viven en la migración.
 */
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { users } from './users.js';

export const expense_cost_behaviour = pgTable('expense_cost_behaviour', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  expense_id: uuid('expense_id').notNull(),
  comportamiento: text('comportamiento').notNull(),
  created_by: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
