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
  getVentasParaExport,
  periodoDe,
  GRANOS,
  type Grano,
} from '@/lib/services/reporting/accountant.report';

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
    const periodo = periodoDe(g, desdeIso ? new Date(desdeIso) : new Date());
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
