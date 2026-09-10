/**
 * Los datos del Calendario.
 *
 * ── QUE PINTA CADA DIA ────────────────────────────────────────────────────
 * La grilla no muestra sólo el número del día — eso ya está en el teléfono y no
 * aporta nada. Cada día se pinta según lo que se facturó, así la grilla es
 * además un gráfico: se ve el patrón semanal, el día muerto y el efecto del
 * feriado sin leer un solo número.
 *
 * Y es la única parte del calendario que funciona **desde el día uno**, sin
 * ningún dato externo cargado.
 *
 * ── LOS FERIADOS SON DATO, NO CUENTA ──────────────────────────────────────
 * Ver migration 0028. Acá lo importante es la consecuencia: si un año no está
 * en `holiday_calendars`, la pantalla NO dibuja "un año sin feriados" —
 * informa que no lo tiene. Un mes sin marcas es una afirmación.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';
import { TZ_COMERCIO } from './panel.report.js';

function requireTenantId(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'calendar.report (sin tenant en el context)'
    );
  }
  return ctx.tenant_id;
}

export interface FeriadoDelCalendario {
  [k: string]: string | null;
  fecha: string;
  nombre: string;
  tipo: string;
  jurisdiction: string;
  nota: string | null;
}

/**
 * Los feriados de un rango de años.
 *
 * Se traen todos juntos y no mes a mes: son unas pocas decenas de filas por
 * año, y así navegar el calendario no pega contra la base en cada flecha.
 */
export async function getFeriados(desdeAnio: number, hastaAnio: number): Promise<FeriadoDelCalendario[]> {
  return db.execute<FeriadoDelCalendario>(
    sql`SELECT fecha::text AS fecha, nombre, tipo, jurisdiction, nota
        FROM holidays
        WHERE extract(year FROM fecha) BETWEEN ${desdeAnio} AND ${hastaAnio}
        ORDER BY fecha`
  );
}

export interface CoberturaCalendario {
  [k: string]: string | boolean | number | null;
  anio: number;
  jurisdiction: string;
  completo: boolean;
  nota: string | null;
  verified_at: string;
}

/**
 * Qué años tenemos cargados, y con qué grado de confianza.
 *
 * Esto es lo que permite decir "todavía no tengo los feriados de 2027" en vez
 * de dibujar 2027 como si no tuviera ninguno.
 */
export async function getCoberturaFeriados(
  desdeAnio: number,
  hastaAnio: number
): Promise<CoberturaCalendario[]> {
  return db.execute<CoberturaCalendario>(
    sql`SELECT anio, jurisdiction, completo, nota, verified_at::text AS verified_at
        FROM holiday_calendars
        WHERE anio BETWEEN ${desdeAnio} AND ${hastaAnio}
        ORDER BY anio, jurisdiction`
  );
}

export interface DiaDelCalendario {
  [k: string]: string;
  dia: string;
  total: string;
  tickets: string;
}

/**
 * Un día por fila para los últimos N días, sin huecos.
 *
 * Igual que `getSerieDiaria` del panel, pero para el rango largo que necesita
 * el calendario. Se trae de una sola vez —un año son ~365 filas, nada— para que
 * pasar de mes sea instantáneo y no una consulta por flecha.
 *
 * `generate_series` y no un GROUP BY pelado: un día cerrado no produce fila, y
 * sin el cero explícito el calendario no podría distinguir "no vendí" de "no
 * tengo el dato". Son dos cosas distintas y se pintan distinto.
 */
export async function getDiasConVentas(dias: number): Promise<DiaDelCalendario[]> {
  const tenantId = requireTenantId();
  return db.execute<DiaDelCalendario>(
    sql`WITH d AS (
          SELECT generate_series(
            (now() AT TIME ZONE ${TZ_COMERCIO})::date - ${dias - 1}::int,
            (now() AT TIME ZONE ${TZ_COMERCIO})::date,
            '1 day'
          )::date AS dia
        )
        SELECT d.dia::text                     AS dia,
               coalesce(sum(s.total), 0)::text AS total,
               count(s.id)::text               AS tickets
        FROM d
        LEFT JOIN sales s
          ON s.tenant_id = ${tenantId}
         AND s.commercial_status IN ('cobrada', 'terminada')
         AND (s.created_at AT TIME ZONE ${TZ_COMERCIO})::date = d.dia
        GROUP BY d.dia
        ORDER BY d.dia`
  );
}
