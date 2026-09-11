/**
 * Panel — Server Component.
 *
 * Maqueta: `public/panel.html`. Es la pantalla de inicio, lo primero que ve el
 * comerciante al abrir Pandora.
 *
 * ── QUE CAMBIA RESPECTO DE LA MAQUETA ─────────────────────────────────────
 * Hasta hoy `/panel` NO era una pantalla: `next.config.ts` reescribía la ruta a
 * `public/panel.html` y el proxy la eximía de auth y de CSP. Se veía hermosa
 * porque todos los números estaban escritos a mano.
 *
 * Ahora cada bloque sale de una consulta real, o dice por qué no puede. Dos
 * bloques de la maqueta no tienen dato detrás y NO se rellenan con un número
 * inventado:
 *
 *   - **Comprobantes AFIP** ("41 Factura B · CAE último · latencia P95"): no
 *     hay ni una factura emitida porque falta el certificado. En vez del número
 *     falso, el bloque muestra el estado real y el paso que falta — que es más
 *     útil que un contador que miente.
 *   - **Meta del día**: no existe el concepto de meta en ningún lado, y
 *     inventar un objetivo de $400.000 es ponerle al comerciante una vara que
 *     nadie fijó. El anillo se conserva —es el ancla visual de la columna— pero
 *     mide algo real: cómo viene el día contra el mismo día de la semana
 *     pasada.
 *
 * ── CALENDARIO Y PENDIENTES ───────────────────────────────────────────────
 * Van juntos, en una fila de dos columnas, porque son las dos mitades de la
 * misma pregunta: el calendario dice qué días vienen (y cómo se vendió en los
 * que ya pasaron), Pendientes dice qué hay que hacer esos días.
 *
 * Lo que TODAVIA no está ahí son los **vencimientos fiscales**. Ese calendario
 * es dato verificado, no una regla que se pueda calcular: la supuesta regla del
 * cronograma de IVA por CUIT que repiten todos los blogs ya se probó falsa (ver
 * RESEARCH-BRIEF-vencimientos-fiscales.md). Cuando esté cargado entra por
 * `holidays` / `holiday_calendars`, que ya existen y ya saben decir qué años
 * NO tienen cargados.
 */
import { eq } from 'drizzle-orm';
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import {
  getIngresosVsGastos,
  getPanelClientes,
  getVentasPorRubro,
  TZ_COMERCIO,
  getMasVendidosHoy,
  getMediosDePagoHoy,
  getPanelHoy,
  getPanelMes,
  getResumenCuentaCorriente,
  getSerieDiaria,
  getSerieHoraria,
  getStockBajo,
  getUltimasVentas,
} from '@/lib/services/reporting/panel.report';
import {
  getCoberturaFeriados,
  getDiasConVentas,
  getFeriados,
} from '@/lib/services/reporting/calendar.report';
import { computeCashBreakdown, getActiveCashSession } from '@/lib/cash/sessions';
import { listOpenTasks } from '@/lib/services/tasks/task.service';
import {
  getDiasDeHistoria,
  getDiasDeStock,
} from '@/lib/services/reporting/stock.report';
import {
  getMargenDelMes,
  getRentabilidadPorProducto,
} from '@/lib/services/reporting/margen.report';
import { PanelClient } from './PanelClient';

// F0: un único punto de venta, igual que el resto de la app.
const SALE_POINT = 1;

export default async function PanelPage() {
  const session = await requireSessionWithCompany();

  // El año del COMERCIO, que hace falta antes de las consultas (el calendario
  // pide los feriados de un rango alrededor de él). Misma razón que la fecha:
  // el servidor corre en UTC y a las 21:00 de Ushuaia ya cambió de año el 31/12.
  const ahora = new Date();
  const anioComercio = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ_COMERCIO, year: 'numeric' }).format(ahora)
  );
  const hoyComercio = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_COMERCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);

  const datos = await withServerActionTracing(
    async () => {
      // Va PRIMERO y solo: la ventana de dias-de-stock se calcula a partir
      // de esto, asi que no puede ir en el mismo Promise.all que la usa.
      // Es una consulta de una fila sobre un indice; no mueve la aguja.
      const diasDeHistoria = await getDiasDeHistoria();

      const [
        hoy,
        mes,
        serie,
        ingresosGastos,
        medios,
        masVendidos,
        ultimas,
        stockBajo,
        cuentaCorriente,
        caja,
        serieHoraria,
        rubros,
        clientes,
        diasCalendario,
        feriados,
        coberturaFeriados,
        pendientes,
        diasDeStock,
        margen,
        rentabilidad,
      ] = await Promise.all([
        getPanelHoy(),
        getPanelMes(),
        // 31 días: el gráfico usa los últimos 30 y la proyección de cierre de mes
        // necesita cubrir un mes de 31 entero. Una consulta, no dos.
        getSerieDiaria(31),
        getIngresosVsGastos(6),
        getMediosDePagoHoy(),
        getMasVendidosHoy(5),
        getUltimasVentas(5),
        getStockBajo(4),
        getResumenCuentaCorriente(),
        getActiveCashSession(SALE_POINT),
        getSerieHoraria(),
        getVentasPorRubro(),
        getPanelClientes(),
        // Un año entero de días de una sola vez: son ~365 filas y así navegar
        // el calendario no pega contra la base en cada flecha.
        getDiasConVentas(400),
        getFeriados(anioComercio - 1, anioComercio + 1),
        getCoberturaFeriados(anioComercio - 1, anioComercio + 1),
        // Solo los abiertos: los tachados no van a esta lista. El tope
        // existe para que una lista abandonada de 3.000 items no cuelgue
        // el panel entero.
        listOpenTasks(60),
        getDiasDeStock(diasDeHistoria),
        // Margen bruto HISTORICO: con el costo congelado en cada linea
        // (migration 0031), no con el costo de hoy. Se devuelve crudo — la
        // decision de si hay numero o no la toma la capa pura al renderizar.
        getMargenDelMes(),
        getRentabilidadPorProducto(6),
      ]);

      // El desglose de la caja sale de `computeCashBreakdown`, que es LA MISMA
      // fórmula que usa el cierre. La pantalla muestra la cuenta entera —
      // cobrado en efectivo, cobros de fiado, retiros— y no sólo el resultado:
      // así el cajero la puede verificar contra el cajón en vez de confiar.
      //
      // NO se usa `getCashSessionSummary().totals.expected_from_movements`: ése
      // ignora las ventas (lo dice su propio docstring), y en pantalla daba
      // "esperado $49.800" contra una apertura de $50.000 después de un día
      // entero de ventas en efectivo.
      const desglose =
        caja === null
          ? null
          : await computeCashBreakdown(
              db,
              caja.id,
              session.active_company_id,
              caja.initial_amount
            );

      return {
        hoy,
        mes,
        serie,
        serieHoraria,
        ingresosGastos,
        medios,
        masVendidos,
        ultimas,
        stockBajo,
        cuentaCorriente,
        rubros,
        clientes,
        diasCalendario,
        feriados,
        coberturaFeriados,
        diasDeHistoria,
        diasDeStock,
        margen,
        rentabilidad,
        // `due_date` ya viene como texto 'AAAA-MM-DD' de Postgres (columna
        // `date`). `done_at` se serializa a ISO — solo para poder pasar por
        // el limite server/client, porque en esta lista siempre es null.
        pendientes: pendientes.map((t) => ({
          id: t.id,
          titulo: t.titulo,
          detalle: t.detalle,
          tipo: t.tipo,
          due_date: t.due_date,
          recurrencia: t.recurrencia,
          done_at: t.done_at === null ? null : t.done_at.toISOString(),
        })),
        caja:
          caja === null || desglose === null
            ? null
            : { abierta_at: caja.opened_at.toISOString(), ...desglose },
        // El DIA del comercio en que se abrio, no el dia UTC. Una caja abierta
        // ayer a las 22:00 de Ushuaia tiene fecha UTC de hoy: cortarle los
        // primeros 10 caracteres al ISO esconderia justo el caso que importa
        // (la caja que quedo abierta de ayer y nunca se arqueo).
        cajaAbiertaDesde:
          caja === null
            ? null
            : new Intl.DateTimeFormat('en-CA', {
                timeZone: TZ_COMERCIO,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(caja.opened_at),
      };
    },
    { requireAuth: true }
  );

  // ── LA FECHA Y LA HORA SON LAS DEL COMERCIO ───────────────────────────
  // Se resuelven acá, en el servidor, y viajan como valores ya formateados.
  // Calcularlas en el cliente con `new Date()` daría la fecha del NAVEGADOR: a
  // las 21:30 de Ushuaia una notebook en otro huso ya está en el día siguiente,
  // y el servidor (UTC) también. Además, si el servidor y el cliente cayeran en
  // días u horas distintas, React marcaría hydration mismatch.
  //
  // Es `Intl` y no una consulta: no hace falta molestar a la base para saber
  // qué hora es, y el `Promise.all` de arriba ya son 13 consultas.
  const fechaLarga = new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ_COMERCIO,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(ahora);
  const horaComercio = Number(
    new Intl.DateTimeFormat('es-AR', {
      timeZone: TZ_COMERCIO,
      hour: 'numeric',
      hour12: false,
    }).format(ahora)
  );

  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, session.active_company_id))
    .limit(1);

  return (
    <PanelClient
      {...datos}
      fechaLarga={fechaLarga}
      horaComercio={horaComercio}
      hoyComercio={hoyComercio}
      comercio={company?.name ?? 'Mi comercio'}
      usuario={session.email.replace(/@.*/, '')}
    />
  );
}
