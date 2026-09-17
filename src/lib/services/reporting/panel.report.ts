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
import Decimal from 'decimal.js';
import { db } from '../../db/client.js';
import { GASTO_PAGADO_SQL, GASTO_VIGENTE_SQL } from '../../db/schema/expenses.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';
import { getBalancesByCustomer } from '../customers/account.service.js';

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

export interface PuntoHora {
  [k: string]: string;
  /** Hora local, 0-23. */
  hora: string;
  total: string;
  tickets: string;
}

/**
 * Ventas de hoy, hora por hora.
 *
 * ── EL RANGO SALE DE LOS DATOS, NO DE UN HORARIO CONFIGURADO ──────────────
 * No existe el concepto de "horario de atención" en Pandora, así que el eje va
 * de la primera a la última venta del día. Es más honesto que una constante y
 * además dice algo: a qué hora abrió de verdad.
 *
 * Los huecos se rellenan con cero (`generate_series`): una hora sin ventas
 * TIENE que ser un cero en la curva. Si se salteara, la línea uniría las 12 con
 * las 15 en una recta y dibujaría ventas en horas muertas.
 */
export async function getSerieHoraria(): Promise<PuntoHora[]> {
  const tenantId = requireTenantId();
  return db.execute<PuntoHora>(
    sql`WITH v AS (
          SELECT extract(hour FROM created_at AT TIME ZONE ${TZ_COMERCIO})::int AS hora,
                 total
          FROM sales
          WHERE tenant_id = ${tenantId} AND ${VENTA_CERRADA}
            AND ${diaLocal} = ${hoyLocal}
        ),
        rango AS (SELECT min(hora) AS desde, max(hora) AS hasta FROM v)
        SELECT h::text                          AS hora,
               coalesce(sum(v.total), 0)::text  AS total,
               count(v.total)::text             AS tickets
        FROM rango, generate_series(rango.desde, rango.hasta) AS h
        LEFT JOIN v ON v.hora = h
        GROUP BY h
        ORDER BY h`
  );
}

export interface PanelMes {
  total: string;
  tickets: number;
  /** El mismo tramo del mes pasado: hasta el mismo día, para comparar justo. */
  totalMesPasado: string;
  variacion: number | null;
  /** El mes pasado ENTERO. Es contexto, no la base de la comparación. */
  totalMesPasadoCompleto: string;
  /** Qué día del mes es hoy: "1–10 sep" en la barra comparativa. */
  diaDelMes: number;
  /** 'AAAA-MM-01' del mes corriente y del anterior, para rotular. */
  mesActual: string;
  mesAnterior: string;
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
    mes_pasado_completo: string;
    dia_del_mes: string;
    mes_actual: string;
    mes_anterior: string;
  }>(
    sql`WITH ref AS (
          SELECT date_trunc('month', ${hoyLocal})::date                       AS ini_mes,
                 (date_trunc('month', ${hoyLocal}) - interval '1 month')::date AS ini_ant,
                 extract(day FROM ${hoyLocal})::int                            AS dia_del_mes
        )
        SELECT
          coalesce(sum(total) FILTER (WHERE ${diaLocal} >= ref.ini_mes), 0)::text AS total,
          count(*)            FILTER (WHERE ${diaLocal} >= ref.ini_mes)::text     AS tickets,
          -- El MISMO TRAMO del mes pasado: hasta el mismo día del mes.
          coalesce(sum(total) FILTER (
            WHERE ${diaLocal} >= ref.ini_ant
              AND ${diaLocal} <  ref.ini_ant + ref.dia_del_mes
          ), 0)::text AS mes_pasado,
          -- Y el mes pasado ENTERO. Es contexto ("agosto cerró en X"), NO la
          -- base de la comparación: comparar un mes a medio andar contra un mes
          -- completo daría siempre una caída falsa.
          coalesce(sum(total) FILTER (
            WHERE ${diaLocal} >= ref.ini_ant AND ${diaLocal} < ref.ini_mes
          ), 0)::text AS mes_pasado_completo,
          max(ref.dia_del_mes)::text AS dia_del_mes,
          max(ref.ini_mes)::text     AS mes_actual,
          max(ref.ini_ant)::text     AS mes_anterior
        FROM sales, ref
        WHERE tenant_id = ${tenantId} AND ${VENTA_CERRADA}
          AND ${diaLocal} >= ref.ini_ant`
  );

  // Sin NINGUNA venta desde el mes pasado, el FROM no devuelve filas y los
  // rótulos quedarían vacíos. Se recalculan las fechas para que la pantalla
  // igual sepa qué meses está mostrando.
  const [ref] = await db.execute<{ dia: string; actual: string; anterior: string }>(
    sql`SELECT extract(day FROM ${hoyLocal})::text                             AS dia,
               date_trunc('month', ${hoyLocal})::date::text                     AS actual,
               (date_trunc('month', ${hoyLocal}) - interval '1 month')::date::text AS anterior`
  );

  const total = fila?.total ?? '0';
  const mesPasado = Number(fila?.mes_pasado ?? '0');
  return {
    total,
    tickets: Number(fila?.tickets ?? '0'),
    totalMesPasado: fila?.mes_pasado ?? '0',
    variacion: mesPasado === 0 ? null : ((Number(total) - mesPasado) / mesPasado) * 100,
    totalMesPasadoCompleto: fila?.mes_pasado_completo ?? '0',
    diaDelMes: Number(fila?.dia_del_mes ?? ref?.dia ?? '1'),
    mesActual: fila?.mes_actual ?? ref?.actual ?? '',
    mesAnterior: fila?.mes_anterior ?? ref?.anterior ?? '',
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
          --
          -- Este grafico compara plata que ENTRO contra plata que SALIO. Una
          -- compra a 30 dias todavia no salio: si sumara aca, el mes en que se
          -- compro se veria carisimo y el mes en que se paga, gratis — dos
          -- meses mal por un gasto bien cargado.
          SELECT date_trunc('month', fecha)::date AS mes, sum(total) AS monto
          FROM expenses
          WHERE tenant_id = ${tenantId}
            AND ${GASTO_VIGENTE_SQL}
            AND ${GASTO_PAGADO_SQL}
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

export interface StockBajo {
  [k: string]: string;
  nombre: string;
  stock: string;
  minimo: string;
}

/**
 * Productos en o por debajo del mínimo.
 *
 * Sólo los que llevan control de stock (`stock_tracking_enabled`) y tienen un
 * mínimo cargado: sin mínimo no hay contra qué comparar, y tratar el `NULL`
 * como cero pondría todo el catálogo en la lista.
 */
export async function getStockBajo(limite = 5): Promise<StockBajo[]> {
  const tenantId = requireTenantId();
  return db.execute<StockBajo>(
    sql`SELECT name AS nombre, stock_current::text AS stock, stock_minimum::text AS minimo
        FROM products
        WHERE tenant_id = ${tenantId}
          AND is_active
          AND stock_tracking_enabled
          AND stock_minimum IS NOT NULL
          AND stock_current <= stock_minimum
        ORDER BY (stock_current - stock_minimum), name
        LIMIT ${limite}`
  );
}

export interface ResumenCuentaCorriente {
  /** Cuánto deben, en total. Positivo = a favor del comercio. */
  porCobrar: string;
  deudores: number;
}

/**
 * Cuánto hay en la calle.
 *
 * ── REUSA getBalancesByCustomer, NO REESCRIBE LA SUMA ─────────────────────
 * El saldo no está guardado: sale del libro (ADR-0027), y el signo NO es un
 * `sum(amount)` — un `charge` suma y un `payment` resta. Escribir esa regla una
 * segunda vez acá es exactamente el problema que tenía el CSV antes de
 * `csv.ts`: si una de las dos versiones deriva, el test de cada archivo pasa
 * igual porque mide su propio camino. Y acá lo que derivaría es el signo de la
 * plata que el comercio tiene por cobrar.
 *
 * La suma final va en Decimal (§9.8), en el servidor.
 */
export async function getResumenCuentaCorriente(): Promise<ResumenCuentaCorriente> {
  const saldos = await getBalancesByCustomer();
  let total = new Decimal(0);
  let deudores = 0;
  for (const saldo of saldos.values()) {
    // Sólo los que DEBEN. Un saldo a favor del cliente no es algo por cobrar.
    if (saldo.gt(0)) {
      total = total.plus(saldo);
      deudores += 1;
    }
  }
  return { porCobrar: total.toFixed(2), deudores };
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

export interface RubroVendido {
  [k: string]: string;
  rubro: string;
  total: string;
  unidades: string;
  /** Porción de la facturación del mes, ya calculada en SQL. */
  porcentaje: string;
}

/**
 * Ventas por rubro del mes — "qué góndola paga el alquiler".
 *
 * Es el bloque que la investigación externa señaló como el hallazgo más fuerte
 * (VMS: *"un total de ventas no te dice qué góndola te está pagando el
 * alquiler"*), y el dato ya estaba: `products.category` no se usaba en NINGUNA
 * pantalla.
 *
 * ── EL DENOMINADOR ES EL TOTAL DEL MES, NO LA SUMA DE LOS ITEMS ───────────
 * Arriba, en la misma pantalla, "Facturación del mes" muestra `sum(sales.total)`.
 * Si acá los porcentajes se calcularan sobre `sum(sale_items.line_total)`, las
 * dos cifras podrían no cerrar y NADA en pantalla lo diría.
 *
 * Y no es hipotético: en la base de desarrollo hay 10 ventas cerradas cuyo
 * `total` no coincide con sus ítems (ventas sin una sola línea). Hoy son de
 * otros tenants y el comercio de la demo está alineado, pero la forma del
 * problema existe, y va a volver con el módulo de descuentos —un descuento
 * global vive en la venta, no en la línea.
 *
 * Por eso el faltante NO se esconde: sale como fila propia, igual que
 * "(sin proveedor indicado)" en el listado de gastos. Los rubros SIEMPRE suman
 * el total del mes.
 *
 * ── SE MUESTRAN LOS 6 PRIMEROS ────────────────────────────────────────────
 * Una ferretería puede tener treinta rubros y la tarjeta no tiene scroll. El
 * resto se agrupa en "Otros rubros" en vez de recortarse con un LIMIT, que
 * rompería la reconciliación de arriba.
 *
 * ── EL RUBRO ES EL DE HOY, NO EL DE LA VENTA ──────────────────────────────
 * `sale_items` snapshotea nombre, sku y precio, pero NO el rubro, así que hay
 * que ir a `products`. Consecuencia real: si el comerciante recategoriza un
 * producto, la historia se mueve con él. Se acepta —una agrupación de análisis
 * no es un importe fiscal— pero es la MISMA familia de problema que el costo
 * sin snapshotear (ver RESEARCH-BRIEF-panel §8.b), y por eso queda escrito.
 */
const RUBROS_VISIBLES = 6;

export async function getVentasPorRubro(): Promise<RubroVendido[]> {
  const tenantId = requireTenantId();
  return db.execute<RubroVendido>(
    sql`WITH v AS (
          SELECT id, total
          FROM sales
          WHERE tenant_id = ${tenantId} AND ${VENTA_CERRADA}
            AND ${diaLocal} >= date_trunc('month', ${hoyLocal})::date
        ),
        tot AS (SELECT coalesce(sum(total), 0) AS t FROM v),
        por_rubro AS (
          SELECT coalesce(nullif(trim(p.category), ''), '(sin rubro)') AS rubro,
                 sum(si.line_total) AS total,
                 sum(si.quantity)   AS unidades
          FROM sale_items si
          JOIN v          ON v.id = si.sale_id
          JOIN products p ON p.id = si.product_id
          WHERE si.tenant_id = ${tenantId}
          GROUP BY 1
        ),
        rank AS (
          SELECT rubro, total, unidades,
                 row_number() OVER (ORDER BY total DESC, rubro) AS rn
          FROM por_rubro
        ),
        agrupado AS (
          SELECT rubro, total, unidades, rn
          FROM rank WHERE rn <= ${RUBROS_VISIBLES}
          UNION ALL
          -- El resto junto, para no recortar plata del total.
          SELECT 'Otros rubros', sum(total), sum(unidades), ${RUBROS_VISIBLES + 1}
          FROM rank WHERE rn > ${RUBROS_VISIBLES}
          HAVING count(*) > 0
          UNION ALL
          -- Lo que la venta cobró y sus líneas no explican.
          SELECT '(sin detalle de items)',
                 (SELECT t FROM tot) - coalesce((SELECT sum(total) FROM por_rubro), 0),
                 0, ${RUBROS_VISIBLES + 2}
          WHERE (SELECT t FROM tot)
                - coalesce((SELECT sum(total) FROM por_rubro), 0) > 0.005
        )
        SELECT rubro,
               total::text    AS total,
               unidades::text AS unidades,
               round(100 * total / nullif((SELECT t FROM tot), 0), 1)::text AS porcentaje
        FROM agrupado
        ORDER BY rn`
  );
}

export interface PanelClientes {
  /** Clientes IDENTIFICADOS que compraron este mes. */
  activos: number;
  /** De esos, los que compraron por primera vez este mes. */
  nuevos: number;
  /** Los que ya habían comprado antes y volvieron. */
  vuelven: number;
  /** Facturación del mes que tiene nombre y apellido. */
  facturadoIdentificado: string;
  /** Qué porción del mes es eso. `null` si no hubo ventas. */
  porcentajeIdentificado: string | null;
}

/**
 * Clientes del mes.
 *
 * ── POR QUE NO ES UN RATIO "ACTIVOS / TOTAL" ──────────────────────────────
 * Medido sobre la base real: 6 clientes cargados, los 6 compraron. Un "100% de
 * clientes activos" no cambia ninguna decisión — es exactamente el *vanity
 * metric* contra el que advierte KORONA.
 *
 * El número que SÍ decide algo es otro: de 3.439 ventas cerradas, 1.020 tienen
 * cliente identificado. Saber qué porción de la facturación tiene nombre y
 * apellido es lo que dice si vale la pena la cuenta corriente o una promo
 * dirigida. El resto es consumidor final, y eso se dice en pantalla en vez de
 * dejar que el 30% se lea como "perdí el 70% de mis clientes".
 *
 * ── "NUEVO" ES POR PRIMERA COMPRA, NO POR `created_at` ────────────────────
 * `customers.created_at` es cuándo se cargó la ficha, que en la base de
 * desarrollo es el día del seed: daría "6 nuevos de 6" siempre. Un cliente
 * nuevo es el que compró por primera vez, y eso sale de `sales`.
 */
export async function getPanelClientes(): Promise<PanelClientes> {
  const tenantId = requireTenantId();
  const [fila] = await db.execute<{
    activos: string;
    nuevos: string;
    facturado_identificado: string;
    porcentaje: string | null;
  }>(
    sql`WITH ref AS (
          SELECT date_trunc('month', ${hoyLocal})::date AS ini
        ),
        primera AS (
          SELECT customer_id, min(${diaLocal}) AS primera_compra
          FROM sales
          WHERE tenant_id = ${tenantId} AND ${VENTA_CERRADA}
            AND customer_id IS NOT NULL
          GROUP BY 1
        )
        SELECT
          count(DISTINCT s.customer_id)::text AS activos,
          count(DISTINCT s.customer_id)
            FILTER (WHERE pr.primera_compra >= ref.ini)::text AS nuevos,
          coalesce(sum(s.total) FILTER (WHERE s.customer_id IS NOT NULL), 0)::text
            AS facturado_identificado,
          round(
            100 * coalesce(sum(s.total) FILTER (WHERE s.customer_id IS NOT NULL), 0)
                / nullif(sum(s.total), 0), 1
          )::text AS porcentaje
        FROM sales s
        CROSS JOIN ref
        LEFT JOIN primera pr ON pr.customer_id = s.customer_id
        WHERE s.tenant_id = ${tenantId}
          AND s.commercial_status IN ('cobrada', 'terminada')
          AND (s.created_at AT TIME ZONE ${TZ_COMERCIO})::date >= ref.ini`
  );

  const activos = Number(fila?.activos ?? '0');
  const nuevos = Number(fila?.nuevos ?? '0');
  return {
    activos,
    nuevos,
    vuelven: activos - nuevos,
    facturadoIdentificado: fila?.facturado_identificado ?? '0',
    porcentajeIdentificado: fila?.porcentaje ?? null,
  };
}
