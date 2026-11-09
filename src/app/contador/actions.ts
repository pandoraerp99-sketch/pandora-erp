'use server';

/**
 * Server Actions del panel de la contadora.
 *
 * Todas son de LECTURA o de preferencia: acá no se muta nada del comercio. El
 * rol `accountant` mira y exporta (Ley 20.488: Pandora prepara borradores, la
 * matriculada firma).
 *
 * ⚠️ Que este archivo no mute nada NO es lo que lo impide. Una action es
 * llamable de a una, así que lo que decide si la contadora puede escribir es
 * el SERVICE, no qué acciones dibuja esta pantalla. Al 2026-09-21 la única
 * guardia real que existe es la de los adjuntos
 * (`exigirQuePuedaEscribir`, attachment.service); `registerExpense` y
 * `createProduct` se probaron corriendo con rol `accountant` y escriben. Ver
 * el hallazgo en el encabezado de esa guardia.
 */
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { COOKIE_EMPRESA, requireSession } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import {
  armarCsv,
  getMesCierreEjercicio,
  getVentasParaExport,
  periodoDe,
  GRANOS,
  type Grano,
} from '@/lib/services/reporting/accountant.report';
import {
  armarCsvInventario,
  getInventarioAlCierre,
} from '@/lib/services/reporting/inventario.report';
import {
  armarCsvAcreedores,
  armarCsvCaja,
  armarCsvDeudores,
  getAcreedoresAlCierre,
  getCajaAlCierre,
  getDeudoresAlCierre,
} from '@/lib/services/reporting/cierre.report';
import {
  listarComprobantesDelPeriodo,
  urlParaDescargar,
  type ComprobanteDelPeriodo,
} from '@/lib/services/expenses/attachment.service';
import { almacenSupabase } from '@/lib/services/expenses/attachment.storage';

/**
 * Cambia la empresa que está mirando el contador.
 *
 * Valida contra las empresas del JWT ANTES de escribir la cookie. La
 * validación vuelve a hacerse al leer la sesión (`resolverEmpresaActiva`), así
 * que esto no es la defensa — es para que un pedido inválido falle acá, con un
 * mensaje, en vez de escribir una cookie que después se ignora en silencio.
 */
export async function cambiarEmpresaAction(
  companyId: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.available_company_ids.includes(companyId)) {
    return { ok: false, error: 'No tenés acceso a esa empresa' };
  }

  (await cookies()).set(COOKIE_EMPRESA, companyId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Sin maxAge: dura lo que la sesión del navegador. Es una preferencia de
    // "qué estoy mirando ahora", no una configuración que valga la pena
    // recordar por meses.
  });

  revalidatePath('/contador');
  return { ok: true };
}

/**
 * CSV de las ventas del período, para abrir en Excel o importar al sistema
 * contable.
 *
 * Devuelve el contenido, no un archivo: la descarga la arma el navegador con
 * un Blob. Servir un archivo desde el server obligaría a una route handler y a
 * pensar dónde se guarda; esto es un string que ya existe en memoria.
 */
export async function exportarVentasCsvAction(
  desdeIso?: string,
  grano?: string
): Promise<{ ok: true; csv: string; nombre: string } | { ok: false; error: string }> {
  try {
    // Mismo criterio que la pantalla: un grano raro cae al mes en vez de
    // romper. La fecha viene del propio periodo que se esta mirando, asi que
    // el CSV es SIEMPRE el del periodo en pantalla.
    const g: Grano = GRANOS.includes(grano as Grano) ? (grano as Grano) : 'mes';

    // El mes de cierre lo resuelve el SERVIDOR desde la empresa de la sesión:
    // define QUÉ DOCE MESES salen en el archivo.
    const mesCierre = await withServerActionTracing(getMesCierreEjercicio, {
      requireAuth: true,
    });

    // OJO con `ejercicio`. Los otros granos se fijan pasando una fecha DENTRO
    // del período en pantalla, y eso funciona porque son el período CORRIENTE
    // de esa fecha. `ejercicio` no: es el último CERRADO respecto de la fecha
    // de referencia, así que pasarle un día de adentro del ejercicio cerrado
    // devolvería el ANTERIOR. Un año entero corrido, en un CSV que se ve
    // perfectamente bien formado.
    const referencia =
      g === 'ejercicio' ? new Date() : desdeIso ? new Date(desdeIso) : new Date();
    const periodo = periodoDe(g, referencia, mesCierre);
    const csv = await withServerActionTracing(
      async () => armarCsv(await getVentasParaExport(periodo)),
      { requireAuth: true }
    );
    // El nombre lleva el rango COMPLETO, no el mes de inicio: bajando el año
    // el archivo se llamaría "ventas-2026-01" y en la carpeta del contador
    // pasaría por el de enero.
    const desde = periodo.desde.toISOString().slice(0, 10);
    const hasta = new Date(periodo.hasta.getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
    return { ok: true, csv, nombre: `ventas-${desde}_a_${hasta}.csv` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo exportar',
    };
  }
}

/**
 * CSV del inventario valorizado — ítem 8 del pedido de la contadora.
 *
 * Una fila por LOTE, que es lo que el ítem pide: fecha de adquisición, detalle
 * e importe de compra. Las unidades sin compra van en su propia fila, marcadas
 * y con la fecha vacía — inventarle una fecha de adquisición a algo que no tiene
 * comprobante detrás es justo lo que este reporte vino a evitar.
 *
 * La fecha la manda la pantalla porque es la que ya está mostrando: el archivo
 * y lo que se ve tienen que ser el mismo inventario.
 */
export async function exportarInventarioCsvAction(
  fecha: string
): Promise<{ ok: true; csv: string; nombre: string } | { ok: false; error: string }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return { ok: false, error: 'Fecha inválida' };
    }
    const csv = await withServerActionTracing(
      async () => armarCsvInventario(await getInventarioAlCierre(fecha)),
      { requireAuth: true }
    );
    return { ok: true, csv, nombre: `inventario-valorizado-al-${fecha}.csv` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo exportar',
    };
  }
}

/**
 * CSV de deudores a la fecha de cierre — ítem 5: razón social, CUIT e importe.
 *
 * Es el saldo AL CIERRE, no a hoy: es el que va al balance. El archivo aclara
 * adentro que el corte usa la fecha de registración del movimiento, porque el
 * libro de cuenta corriente no guarda la de la operación.
 */
export async function exportarDeudoresCsvAction(
  fecha: string
): Promise<{ ok: true; csv: string; nombre: string } | { ok: false; error: string }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return { ok: false, error: 'Fecha inválida' };
    }
    const csv = await withServerActionTracing(
      async () => armarCsvDeudores(fecha, await getDeudoresAlCierre(fecha)),
      { requireAuth: true }
    );
    return { ok: true, csv, nombre: `deudores-al-${fecha}.csv` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo exportar',
    };
  }
}

/**
 * CSV de acreedores a la fecha de cierre — ítem 9 (ADR-0028).
 *
 * La otra columna del mismo balance que `exportarDeudoresCsvAction`. Toma la
 * fecha ya resuelta por la pantalla, igual que sus hermanas, para que las
 * cuatro tarjetas del cierre hablen del MISMO día.
 */
export async function exportarAcreedoresCsvAction(
  fecha: string
): Promise<{ ok: true; csv: string; nombre: string } | { ok: false; error: string }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return { ok: false, error: 'Fecha inválida' };
    }
    const csv = await withServerActionTracing(
      async () => armarCsvAcreedores(fecha, await getAcreedoresAlCierre(fecha)),
      { requireAuth: true }
    );
    return { ok: true, csv, nombre: `acreedores-al-${fecha}.csv` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo exportar',
    };
  }
}

/**
 * CSV del saldo de caja al cierre — ítem 1.
 *
 * Una fila por punto de venta con la fecha de SU arqueo, y las cajas que
 * quedaron abiertas sin importe: que faltó contar una caja es el dato.
 */
export async function exportarCajaCsvAction(
  fecha: string
): Promise<{ ok: true; csv: string; nombre: string } | { ok: false; error: string }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return { ok: false, error: 'Fecha inválida' };
    }
    const csv = await withServerActionTracing(
      async () => armarCsvCaja(await getCajaAlCierre(fecha)),
      { requireAuth: true }
    );
    return { ok: true, csv, nombre: `caja-al-${fecha}.csv` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo exportar',
    };
  }
}

/**
 * Los comprobantes adjuntos a los gastos del período — ítem 12, slice 4.
 *
 * Es lo único que hace que el ítem 12 deje de estar a medias: hasta acá la
 * contadora veía el DETALLE de cada gasto y no el archivo, así que los seguía
 * pidiendo por WhatsApp.
 *
 * ── El período lo resuelve el SERVER, con la fecha de hoy ────────────────
 * NO recibe una fecha de referencia del cliente, y eso no es estilo. La
 * primera versión recibía `resumen.periodo.desde` y la consulta corría contra
 * el año ANTERIOR al que la pantalla mostraba: `periodo.desde` es medianoche
 * UTC y `periodoDe` resuelve el calendario del comercio (UTC−3), así que el
 * primer instante de un período cae en el período de antes en hora local. La
 * lista salía vacía y la pantalla decía, con toda propiedad, "ningún gasto del
 * período tiene el comprobante adjunto" — un año entero corrido sin un solo
 * error. Está pinchado en
 * `tests/unit/periodo-no-es-su-propia-referencia.test.ts`.
 *
 * Resolverlo con `new Date()` da exactamente el período que está en pantalla,
 * porque /contador siempre muestra el que contiene AHORA: el selector cambia
 * el grano, nunca la fecha.
 *
 * ⚠️ `exportarVentasCsvAction` (más arriba) sigue teniendo el patrón viejo:
 * recibe `desdeIso` del cliente y lo reinterpreta. Mismo bug, no tocado acá
 * porque cambia el contenido de un archivo que el estudio ya usa.
 *
 * Sólo comprobantes de gasto: los contratos del proveedor NO entran acá
 * mientras B-11 siga abierta. Ver `listarComprobantesDelPeriodo`.
 */
export async function listarComprobantesDelPeriodoAction(
  grano?: string
): Promise<
  { ok: true; comprobantes: ComprobanteDelPeriodo[] } | { ok: false; error: string }
> {
  try {
    const g: Grano = GRANOS.includes(grano as Grano) ? (grano as Grano) : 'mes';
    const mesCierre = await withServerActionTracing(getMesCierreEjercicio, {
      requireAuth: true,
    });
    // La fecha de HOY para todos los granos, `ejercicio` incluido: ese ya
    // devuelve el último CERRADO respecto de la referencia, así que hoy es
    // justo lo que corresponde pasarle.
    const periodo = periodoDe(g, new Date(), mesCierre);

    // `periodo.hasta` es EXCLUSIVO y la consulta compara con `<=`: sin
    // restarle el día, el primer día del mes siguiente entraría en la lista.
    // Es el mismo ajuste que hacen los CSV para nombrar el archivo.
    const desde = periodo.desde.toISOString().slice(0, 10);
    const hasta = new Date(periodo.hasta.getTime() - 86400000)
      .toISOString()
      .slice(0, 10);

    const comprobantes = await withServerActionTracing(
      () => listarComprobantesDelPeriodo(desde, hasta),
      { requireAuth: true }
    );
    return { ok: true, comprobantes };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudieron leer los comprobantes',
    };
  }
}

/**
 * El link firmado para bajar un comprobante.
 *
 * Reusa `urlParaDescargar`, que filtra por el tenant del CONTEXT. Eso importa
 * más acá que en `/gastos`: la contadora tiene VARIAS empresas en el JWT, y el
 * tenant sale de `active_company_id`, ya validado contra ese array. Un id de
 * otro comercio devuelve cero filas aunque ella tenga acceso a los dos — que
 * es justo el caso que un chequeo contra "el tenant de la sesión" rompería.
 *
 * La URL vive 60 segundos y NO se loguea: es un bearer token, y lo que hay del
 * otro lado puede tener datos de un tercero (B-11).
 */
export async function bajarComprobanteAction(
  attachmentId: string
): Promise<
  | { ok: true; url: string; nombre: string }
  | { ok: true; falta: true }
  | { ok: false; error: string }
> {
  try {
    const r = await withServerActionTracing(
      async () => urlParaDescargar(attachmentId, await almacenSupabase()),
      { requireAuth: true }
    );
    if ('falta' in r) return { ok: true, falta: true };
    return { ok: true, url: r.url, nombre: r.nombre };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo abrir el comprobante',
    };
  }
}
