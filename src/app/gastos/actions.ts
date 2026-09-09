'use server';

/**
 * Server Actions de Gastos. Mismo patrón que /clientes: tracing + envelope,
 * cero lógica de negocio (eso vive en expense.service.ts).
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { requireTracingContext } from '@/lib/tracing/context';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { DomainError } from '@/lib/multi_tenant/errors';
import {
  armarCsvGastos,
  listExpenses,
  registerExpense,
  ExpenseError,
  type NuevoGasto,
} from '@/lib/services/expenses/expense.service';
import { getActiveCashSession } from '@/lib/cash/sessions';
import { periodoDe, GRANOS, type Grano } from '@/lib/services/reporting/accountant.report';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await withServerActionTracing(fn, { requireAuth: true });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DomainError) {
      return { ok: false, error: e.messageEs, code: e.code };
    }
    throw e;
  }
}

// F0: un único punto de venta (Caja 1), igual que /caja, /clientes y el POS.
const SALE_POINT = 1;

/**
 * Mes de cierre de ejercicio de la empresa de la sesión (migration 0027).
 *
 * Va acá y no como parámetro del cliente a propósito: define QUÉ DOCE MESES
 * salen en el CSV que se le manda a la contadora.
 */
async function getMesCierreEjercicio(): Promise<number> {
  const tenantId = requireTracingContext().tenant_id;
  if (tenantId === null || tenantId === undefined) return 12;
  const [c] = await db
    .select({ mes: companies.fiscal_year_end_month })
    .from(companies)
    .where(eq(companies.id, tenantId))
    .limit(1);
  return c?.mes ?? 12;
}

/** Lo que llega del formulario. El `cash_session_id` NO viaja: lo pone el server. */
export type GastoFormInput = Omit<NuevoGasto, 'cash_session_id'>;

/**
 * Registrar un gasto.
 *
 * El `cash_session_id` lo resuelve el SERVIDOR con la caja abierta del punto de
 * venta, igual que el cobro de cuenta corriente: si el navegador pudiera elegir
 * a qué caja imputar la salida de plata, podría mandarla a una sesión vieja y
 * ensuciar un arqueo ya cerrado.
 *
 * Sólo el efectivo necesita caja. Transferencia y tarjeta no la tocan: si todo
 * egreso saliera del cajón, el arqueo descontaría plata que nunca estuvo ahí.
 */
export async function registrarGastoAction(
  input: GastoFormInput
): Promise<ActionResult<null>> {
  return runAction(async () => {
    let cashSessionId: string | undefined;
    if (input.medio_pago === 'efectivo') {
      const sesion = await getActiveCashSession(SALE_POINT);
      if (sesion === null) {
        throw new ExpenseError(
          'cash_needs_session',
          'No hay una caja abierta. Un gasto pagado en efectivo tiene que salir de la caja del día.'
        );
      }
      cashSessionId = sesion.id;
    }

    await registerExpense({
      ...input,
      ...(cashSessionId !== undefined ? { cash_session_id: cashSessionId } : {}),
    });

    revalidatePath('/gastos');
    // El panel de la contadora lee el IVA crédito de acá: si no se revalida,
    // sigue mostrando la posición de IVA vieja.
    revalidatePath('/contador');
    return null;
  });
}

/**
 * CSV de gastos del período para mandarle al estudio.
 *
 * Por defecto exporta SÓLO los que no entran al IVA compras, porque es
 * literalmente lo que pidió la contadora: los que sí entran ya los baja ella de
 * ARCA, y mandárselos de nuevo la hace revisar dos veces lo mismo.
 *
 * Devuelve el contenido, no un archivo: la descarga la arma el navegador con un
 * Blob. Mismo criterio que el export de ventas.
 */
export async function exportarGastosCsvAction(
  grano?: string,
  soloFueraDeArca = true
): Promise<{ ok: true; csv: string; nombre: string } | { ok: false; error: string }> {
  try {
    const g: Grano = GRANOS.includes(grano as Grano) ? (grano as Grano) : 'mes';

    // El mes de cierre lo resuelve el SERVIDOR desde la empresa de la sesión,
    // no viaja del navegador — mismo criterio que el `cash_session_id`.
    //
    // Y no es sólo seguridad: si esta acción usara el default 12 mientras la
    // pantalla muestra el ejercicio real, el CSV traería OTROS doce meses que
    // los que dice el título. Se vería perfectamente bien formado.
    const mesCierre = await withServerActionTracing(getMesCierreEjercicio, {
      requireAuth: true,
    });

    const periodo = periodoDe(g, new Date(), mesCierre);
    const desde = periodo.desde.toISOString().slice(0, 10);
    const hasta = periodo.hasta.toISOString().slice(0, 10);

    const csv = await withServerActionTracing(
      async () => {
        const todos = await listExpenses(desde, hasta);
        const filas = soloFueraDeArca
          ? todos.filter((g2) => !g2.en_iva_compras)
          : todos;
        return armarCsvGastos(filas);
      },
      { requireAuth: true }
    );

    // El nombre lleva el rango COMPLETO y dice qué subconjunto es: en la
    // carpeta del estudio, "gastos-2026-01" bajando el año pasaría por el de
    // enero, y "gastos" a secas se confunde con el listado entero.
    const ultimo = new Date(periodo.hasta.getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
    const que = soloFueraDeArca ? 'fuera-de-arca' : 'todos';
    return { ok: true, csv, nombre: `gastos-${que}-${desde}_a_${ultimo}.csv` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo exportar',
    };
  }
}
