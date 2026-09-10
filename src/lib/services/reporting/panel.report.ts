/**
 * Los números del Panel.
 *
 * ── LA REGLA DE ESTE ARCHIVO ──────────────────────────────────────────────
 * Cada bloque del Panel sale de una consulta REAL o no se dibuja. La maqueta
 * (`public/panel.html`) muestra doce bloques y algunos no tienen dato detrás
 * (comprobantes AFIP, meta del día, calendario). Esos NO se rellenan con un
 * número inventado ni con un cero: un cero se lee como "no hubo movimiento",
 * que es una afirmación distinta de "todavía no lo tenemos". Mismo criterio
 * que el panel de la contadora.
 *
 * ── EL DIA ES EL DEL COMERCIO, NO EL DE LA BASE ───────────────────────────
 * La base corre en UTC. A las 21:00 de Ushuaia ya es el día siguiente en UTC,
 * así que `created_at::date = current_date` le cambiaría el día al comerciante
 * con el local abierto: "ventas de hoy" volvería a cero a media tarde-noche.
 * Verificado en la base de desarrollo: a las 00:01 UTC, `current_date` daba 20
 * ventas y el día real de Ushuaia, 13.
 *
 * Por eso TODA frontera de tiempo de este archivo pasa por `AT TIME ZONE`.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';

/**
 * Zona del comercio.
 *
 * Constante y no una columna de `companies` porque F0 es TDF (CLAUDE.md §1.2),
 * y una columna sin segundo caso es configuración inflada. Cuando aparezca el
 * primer cliente fuera de Tierra del Fuego, esto pasa a ser un campo de la
 * empresa — y este archivo ya está escrito para recibirlo, porque la zona entra
 * por parámetro en el SQL en vez de estar embebida en cada comparación.
 */
export const TZ_COMERCIO = 'America/Argentina/Ushuaia';

function requireTenantId(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'panel.report (sin tenant en el context)'
    );
  }
  return ctx.tenant_id;
}

/** `created_at` llevado al día del comercio. */
const diaLocal = sql`(created_at AT TIME ZONE ${TZ_COMERCIO})::date`;
/** Hoy, según el comercio. */
const hoyLocal = sql`(now() AT TIME ZONE ${TZ_COMERCIO})::date`;

/** Una venta cuenta cuando está cobrada. Un carrito abandonado no es una venta. */
const VENTA_CERRADA = sql`commercial_status IN ('cobrada', 'terminada')`;

export interface PanelHoy {
  /** Todo en strings: es plata (CLAUDE.md §9). */
  total: string;
  tickets: number;
  ticketPromedio: string;
  /** El mismo día de la semana pasada, para comparar peras con peras. */
  totalSemanaPasada: string;
  /** Variación porcentual contra ese día. `null` si no hay con qué comparar. */
  variacion: number | null;
  /** Hora del día con más facturación, de los últimos 30 días. `null` si no hay. */
  mejorHora: number | null;
  mejorHoraTotal: string;
}

/**
 * El día de hoy, y contra qué compararlo.
 *
 * Compara contra el MISMO DÍA de la semana pasada y no contra ayer: un lunes
 * contra un domingo no dice nada, y en un comercio el día de la semana manda
 * más que la fecha. La maqueta dice "vs ayer"; esto es más honesto y se rotula
 * como lo que es.
 */
export async function getPanelHoy(): Promise<PanelHoy> {
  const tenantId = requireTenantId();

  const [fila] = await db.execute<{
    total: string;
    tickets: string;
    semana_pasada: string;
    tickets_semana_pasada: string;
  }>(
    sql`SELECT
          coalesce(sum(total) FILTER (WHERE ${diaLocal} = ${hoyLocal}), 0)::text          AS total,
          count(*)            FILTER (WHERE ${diaLocal} = ${hoyLocal})::text              AS tickets,
          coalesce(sum(total) FILTER (WHERE ${diaLocal} = ${hoyLocal} - 7), 0)::text      AS semana_pasada,
          count(*)            FILTER (WHERE ${diaLocal} = ${hoyLocal} - 7)::text          AS tickets_semana_pasada
        FROM sales
        WHERE tenant_id = ${tenantId} AND ${VENTA_CERRADA}
          AND ${diaLocal} >= ${hoyLocal} - 7`
  );

  const total = fila?.total ?? '0';
  const tickets = Number(fila?.tickets ?? '0');
  const semanaPasada = fila?.semana_pasada ?? '0';

  const [pico] = await db.execute<{ hora: string; total: string }>(
    sql`SELECT extract(hour FROM created_at AT TIME ZONE ${TZ_COMERCIO})::text AS hora,
               sum(total)::text                                                AS total
        FROM sales
        WHERE tenant_id = ${tenantId} AND ${VENTA_CERRADA}
          AND ${diaLocal} > ${hoyLocal} - 30
        GROUP BY 1
        ORDER BY sum(total) DESC
        LIMIT 1`
  );

  const nSemanaPasada = Number(semanaPasada);
  return {
    total,
    tickets,
    ticketPromedio: tickets === 0 ? '0' : (Number(total) / tickets).toFixed(2),
    totalSemanaPasada: semanaPasada,
    // Sin base no hay porcentaje. Devolver 0 diría "igual que la semana
    // pasada", que es otra cosa que "no hay con qué comparar".
    variacion:
      nSemanaPasada === 0 ? null : ((Number(total) - nSemanaPasada) / nSemanaPasada) * 100,
    mejorHora: pico ? Number(pico.hora) : null,
    mejorHoraTotal: pico?.total ?? '0',
  };
}

export interface SerieDia {
  [k: string]: string;
  dia: string;
  total: string;
  tickets: string;
}

/**
 * Serie diaria de los últimos N días, SIN huecos.
 *
 * `generate_series` y no un GROUP BY pelado: un domingo cerrado no produce
 * fila, y el sparkline uniría el sábado con el lunes dibujando una recta donde
 * hubo un día en cero. El gráfico mentiría en la dirección más fácil de creer.
 */
export async function getSerieDiaria(dias = 30): Promise<SerieDia[]> {
  const tenantId = requireTenantId();
  return db.execute<SerieDia>(
    sql`WITH dias AS (
          SELECT generate_series(${hoyLocal} - ${dias - 1}::int, ${hoyLocal}, '1 day')::date AS dia
        )
        SELECT d.dia::text                     AS dia,
               coalesce(sum(s.total), 0)::text AS total,
               count(s.id)::text               AS tickets
        FROM dias d
        LEFT JOIN sales s
          ON s.tenant_id = ${tenantId}
         AND s.commercial_status IN ('cobrada', 'terminada')
         AND (s.created_at AT TIME ZONE ${TZ_COMERCIO})::date = d.dia
        GROUP BY d.dia
        ORDER BY d.dia`
  );
}

export interface PanelMes {
  total: string;
  tickets: number;
  /** El mismo tramo del mes pasado: hasta el mismo día, para comparar justo. */
  totalMesPasado: string;
  variacion: number | null;
}

/**
 * El mes corriente, comparado contra el MISMO TRAMO del mes pasado.
 *
 * Comparar el mes corriente (que va por la mitad) contra el mes pasado ENTERO
 * daría siempre una caída enorme y falsa. Se corta el mes pasado en el mismo
 * día del mes.
 */
export async function getPanelMes(): Promise<PanelMes> {
  const tenantId = requireTenantId();
  const [fila] = await db.execute<{
    total: string;
    tickets: string;
    mes_pasado: string;
  }>(
    sql`WITH ref AS (
          SELECT date_trunc('month', ${hoyLocal})::date                       AS ini_mes,
                 (date_trunc('month', ${hoyLocal}) - interval '1 month')::date AS ini_ant,
                 extract(day FROM ${hoyLocal})::int                            AS dia_del_mes
        )
        SELECT
          coalesce(sum(total) FILTER (WHERE ${diaLocal} >= ref.ini_mes), 0)::text AS total,
          count(*)            FILTER (WHERE ${diaLocal} >= ref.ini_mes)::text     AS tickets,
          coalesce(sum(total) FILTER (
            WHERE ${diaLocal} >= ref.ini_ant
              AND ${diaLocal} <  ref.ini_ant + ref.dia_del_mes
          ), 0)::text AS mes_pasado
        FROM sales, ref
        WHERE tenant_id = ${tenantId} AND ${VENTA_CERRADA}
          AND ${diaLocal} >= ref.ini_ant`
  );

  const total = fila?.total ?? '0';
  const mesPasado = Number(fila?.mes_pasado ?? '0');
  return {
    total,
    tickets: Number(fila?.tickets ?? '0'),
    totalMesPasado: fila?.mes_pasado ?? '0',
    variacion: mesPasado === 0 ? null : ((Number(total) - mesPasado) / mesPasado) * 100,
  };
}

export interface MesIngresoGasto {
  [k: string]: string;
  mes: string;
  ingresos: string;
  gastos: string;
}

/**
 * Ingresos vs gastos, por mes.
 *
 * **Este bloque es el que la maqueta sólo podía inventar.** Los ingresos
 * siempre estuvieron (las ventas), pero los gastos no existían hasta que se
 * construyó el módulo: hasta entonces la línea de gastos era un dibujo. Ahora
 * las dos salen de la base.
 */
export async function getIngresosVsGastos(meses = 6): Promise<MesIngresoGasto[]> {
  const tenantId = requireTenantId();
  return db.execute<MesIngresoGasto>(
    sql`WITH m AS (
          SELECT generate_series(
                   date_trunc('month', ${hoyLocal}) - (${meses - 1}::int || ' months')::interval,
                   date_trunc('month', ${hoyLocal}),
                   '1 month'
                 )::date AS mes
        ),
        ing AS (
          SELECT date_trunc('month', (created_at AT TIME ZONE ${TZ_COMERCIO}))::date AS mes,
                 sum(total) AS monto
          FROM sales
          WHERE tenant_id = ${tenantId} AND ${VENTA_CERRADA}
          GROUP BY 1
        ),
        gas AS (
          -- expenses.fecha es un date (la del gasto, no la de la carga): no
          -- lleva conversion de zona, y convertirlo seria un error.
          SELECT date_trunc('month', fecha)::date AS mes, sum(total) AS monto
          FROM expenses
          WHERE tenant_id = ${tenantId}
          GROUP BY 1
        )
        SELECT m.mes::text                        AS mes,
               coalesce(ing.monto, 0)::text       AS ingresos,
               coalesce(gas.monto, 0)::text       AS gastos
        FROM m
        LEFT JOIN ing ON ing.mes = m.mes
        LEFT JOIN gas ON gas.mes = m.mes
        ORDER BY m.mes`
  );
}

export interface MedioPago {
  [k: string]: string;
  medio: string;
  total: string;
  operaciones: string;
}

/**
 * Con qué pagaron hoy.
 *
 * Sale de `sale_payments` (una fila por pago) y no de `sales.payment_method`,
 * que es el denormalizado y dice 'mixto' cuando la venta se pagó con dos
 * medios. Con el denormalizado, una venta mitad efectivo mitad débito no
 * aparecería en ninguno de los dos.
 */
export async function getMediosDePagoHoy(): Promise<MedioPago[]> {
  const tenantId = requireTenantId();
  return db.execute<MedioPago>(
    sql`SELECT sp.method            AS medio,
               sum(sp.amount)::text AS total,
               count(*)::text       AS operaciones
        FROM sale_payments sp
        WHERE sp.tenant_id = ${tenantId}
          AND (sp.created_at AT TIME ZONE ${TZ_COMERCIO})::date = ${hoyLocal}
        GROUP BY 1
        ORDER BY sum(sp.amount) DESC`
  );
}

export interface ProductoVendido {
  [k: string]: string;
  nombre: string;
  unidades: string;
  total: string;
}

/** Lo más vendido de hoy, por facturación. */
export async function getMasVendidosHoy(limite = 5): Promise<ProductoVendido[]> {
  const tenantId = requireTenantId();
  return db.execute<ProductoVendido>(
    sql`SELECT si.product_name_snapshot AS nombre,
               sum(si.quantity)::text   AS unidades,
               sum(si.line_total)::text AS total
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE si.tenant_id = ${tenantId}
          AND s.commercial_status IN ('cobrada', 'terminada')
          AND (s.created_at AT TIME ZONE ${TZ_COMERCIO})::date = ${hoyLocal}
        GROUP BY 1
        ORDER BY sum(si.line_total) DESC
        LIMIT ${limite}`
  );
}

export interface UltimaVenta {
  [k: string]: string;
  id: string;
  hora: string;
  total: string;
  medio: string;
  cliente: string;
  items: string;
}

/** Las últimas ventas, para ver el pulso del día. */
export async function getUltimasVentas(limite = 6): Promise<UltimaVenta[]> {
  const tenantId = requireTenantId();
  return db.execute<UltimaVenta>(
    sql`SELECT s.id::text AS id,
               to_char(s.created_at AT TIME ZONE ${TZ_COMERCIO}, 'HH24:MI') AS hora,
               s.total::text                                                AS total,
               coalesce(s.payment_method, '')                               AS medio,
               coalesce(s.customer_name_snapshot, '')                       AS cliente,
               (SELECT count(*) FROM sale_items i WHERE i.sale_id = s.id)::text AS items
        FROM sales s
        WHERE s.tenant_id = ${tenantId} AND s.commercial_status IN ('cobrada', 'terminada')
        ORDER BY s.created_at DESC
        LIMIT ${limite}`
  );
}
