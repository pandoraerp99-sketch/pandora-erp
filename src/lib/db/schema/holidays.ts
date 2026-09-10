/**
 * Feriados y asuetos — dato de referencia VERIFICADO, no calculado.
 *
 * ── POR QUE NO LLEVAN tenant_id ───────────────────────────────────────────
 * Un feriado nacional es el mismo para todos los comercios. Es dato de
 * referencia: no hay nada que aislar y no hay fuga cross-tenant posible. Se lee
 * desde cualquier sesión autenticada y se escribe SÓLO con `service_role` — la
 * carga del calendario es mantenimiento verificado, no una acción del comercio
 * (migration 0028).
 *
 * ── POR QUE HAY UNA TABLA DE COBERTURA ────────────────────────────────────
 * Sin `holiday_calendars`, un año sin filas en `holidays` se dibujaría como un
 * año sin feriados — que es una afirmación, no una ausencia. Mismo criterio que
 * el resto del Panel: un cero se lee como "no hubo", y eso es distinto de
 * "todavía no lo tenemos".
 */
import { sql } from 'drizzle-orm';
import { boolean, date, index, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/** Las cuatro categorías oficiales de argentina.gob.ar/feriados, más el asueto. */
export const HOLIDAY_TIPOS = [
  'inamovible',
  'trasladable',
  'no_laborable',
  'turistico',
  /**
   * NO es un feriado. La facultad de decretar feriados es de la Nación, así que
   * el "feriado provincial" es en rigor un receso administrativo del sector
   * público y **el comercio elige si adhiere**. Tratarlo como feriado le diría
   * al comerciante que está cerrado cuando en realidad es su decisión.
   */
  'asueto_provincial',
] as const;
export type HolidayTipo = (typeof HOLIDAY_TIPOS)[number];

export const HOLIDAY_JURISDICTIONS = ['nacional', 'TIERRA_DEL_FUEGO'] as const;
export type HolidayJurisdiction = (typeof HOLIDAY_JURISDICTIONS)[number];

export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    fecha: date('fecha').notNull(),
    nombre: text('nombre').notNull(),
    tipo: text('tipo').notNull().$type<HolidayTipo>(),
    jurisdiction: text('jurisdiction').notNull().$type<HolidayJurisdiction>().default('nacional'),
    /** Aclaración para el comerciante cuando el día no significa lo obvio. */
    nota: text('nota'),
    /** De dónde salió la fecha. Sin esto no se puede auditar. */
    source_url: text('source_url').notNull(),
    verified_at: date('verified_at').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    fechaJurNombreUnique: unique('holidays_fecha_jurisdiction_nombre_unique').on(
      t.fecha,
      t.jurisdiction,
      t.nombre
    ),
    fechaIdx: index('holidays_fecha_idx').on(t.fecha),
  })
);

export const holiday_calendars = pgTable(
  'holiday_calendars',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    anio: smallint('anio').notNull(),
    jurisdiction: text('jurisdiction').notNull().$type<HolidayJurisdiction>().default('nacional'),
    source_url: text('source_url').notNull(),
    verified_at: date('verified_at').notNull(),
    /**
     * `false` = hay feriados de ese año que NO están cargados. La pantalla lo
     * dice en vez de mostrar el mes como si estuviera completo.
     */
    completo: boolean('completo').notNull().default(false),
    /** Qué falta, en castellano, para poder mostrarlo tal cual. */
    nota: text('nota'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    anioJurUnique: unique('holiday_calendars_anio_jurisdiction_unique').on(t.anio, t.jurisdiction),
  })
);

export type Holiday = typeof holidays.$inferSelect;
export type HolidayCalendar = typeof holiday_calendars.$inferSelect;
