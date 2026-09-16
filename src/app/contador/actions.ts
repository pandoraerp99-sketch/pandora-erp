'use server';

/**
 * Server Actions del panel de la contadora.
 *
 * Las dos son de LECTURA o de preferencia: acá no se muta nada del comercio.
 * El rol `accountant` mira y exporta (Ley 20.488: Pandora prepara borradores,
 * la matriculada firma).
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
  armarCsvCaja,
  armarCsvDeudores,
  getCajaAlCierre,
  getDeudoresAlCierre,
} from '@/lib/services/reporting/cierre.report';

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
