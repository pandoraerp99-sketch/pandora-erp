/**
 * Pendientes del comercio (migration 0030).
 *
 * A diferencia de `expenses`, `stock_movements` y `audit_log`, esta tabla **se
 * edita**: un pendiente es una intención, no un hecho. Se tacha, se destacha
 * porque uno se equivocó de fila y se pasa para el jueves.
 *
 * Y eso tiene un costo que conviene tener presente: **no queda historia de los
 * cambios**. `created_by` dice quién la creó y `done_by` quién la tachó; si
 * alguien reescribe el título o mueve la fecha, lo anterior no queda en ningún
 * lado. Es a propósito — el catálogo de `audit_log` está cerrado y un pendiente
 * no toca plata ni stock — pero es una decisión, no un olvido.
 *
 * Ver RESEARCH-BRIEF-calendario-y-proyecciones.md §9 (slice 2).
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { users } from './users.js';

/**
 * Lista cerrada. Un campo de texto libre termina con 'proveedor', 'Proveedor' y
 * 'proveedores' como tres categorías distintas.
 */
export const TASK_TYPES = [
  'general',
  'stock',
  'caja',
  'proveedor',
  'cliente',
  'fiscal',
  'contador',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/**
 * Las tres cadencias que un comercio usa de verdad. NO es un motor de
 * calendario: nada de "el tercer martes de cada mes".
 */
export const TASK_RECURRENCES = ['diaria', 'semanal', 'mensual'] as const;
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    titulo: text('titulo').notNull(),
    detalle: text('detalle'),
    tipo: text('tipo').notNull().default('general'),

    /** Nullable: "alguna vez hay que llamar al gasista" es un pendiente válido. */
    due_date: date('due_date'),
    recurrencia: text('recurrencia'),

    /** Los dos viajan juntos: un done_at sin done_by es una tarea que se hizo sola. */
    done_at: timestamp('done_at', { withTimezone: true }),
    done_by: uuid('done_by').references(() => users.id, { onDelete: 'restrict' }),

    /**
     * Tachar una recurrente crea la ocurrencia siguiente; esto apunta a ella
     * para que destachar (casi siempre "me equivoqué de fila") la pueda borrar
     * en vez de dejarla suelta.
     */
    spawned_task_id: uuid('spawned_task_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'set null',
    }),

    created_by: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Los dos índices son PARCIALES, igual que en la migration 0030. Declararlos
  // sin el `where` haría que un `drizzle-kit generate` propusiera reemplazarlos
  // por índices completos — más grandes y peores para la consulta que importa.
  (table) => ({
    pendientesIdx: index('tasks_pendientes_idx')
      .on(table.tenant_id, table.due_date)
      .where(sql`done_at IS NULL`),
    hechasIdx: index('tasks_tenant_done_idx')
      .on(table.tenant_id, table.done_at.desc())
      .where(sql`done_at IS NOT NULL`),
  })
);

export type Task = typeof tasks.$inferSelect;
