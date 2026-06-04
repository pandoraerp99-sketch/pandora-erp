/**
 * Users = personas que se autentican. Cada user puede pertenecer a 1+ companies
 * via tabla company_users. Si user es contador, puede tener N memberships.
 * ADR-0008 contador multi-empresa.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { USER_ROLES, createdAt, id, updatedAt } from './_common.js';
import { companies } from './companies.js';

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  full_name: text('full_name'),
  is_support: boolean('is_support').notNull().default(false),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const company_users = pgTable(
  'company_users',
  {
    id: id(),
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => ({
    uniqueMembership: unique('company_users_unique_membership').on(
      table.company_id,
      table.user_id
    ),
    roleCheck: check(
      'company_users_role_check',
      sql`${table.role} IN (${sql.raw(USER_ROLES.map((r) => `'${r}'`).join(','))})`
    ),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type CompanyUser = typeof company_users.$inferSelect;
export type NewCompanyUser = typeof company_users.$inferInsert;
