/**
 * Drizzle ORM client + postgres-js connection.
 * ADR-0001 stack: postgres-js + Drizzle ORM.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env, isProduction } from '../env.js';
import * as schema from './schema/index.js';

const queryClient = postgres(env.DATABASE_URL, {
  max: isProduction() ? 20 : 5,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false,
  transform: {
    undefined: null,
  },
});

export const db: PostgresJsDatabase<typeof schema> = drizzle(queryClient, {
  schema,
  logger: !isProduction(),
});

export type Db = typeof db;
export { schema };
