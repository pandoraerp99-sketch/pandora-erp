'use server';

/**
 * Server Actions de Gastos. Mismo patrón que /clientes: tracing + envelope,
 * cero lógica de negocio (eso vive en expense.service.ts).
 */
import { clasificarGasto } from '@/lib/services/expenses/cost-behaviour.service';
import { revalidatePath } from 'next/cache';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { DomainError } from '@/lib/multi_tenant/errors';
import {
  annulExpense,
  armarCsvGastos,
  armarCsvProveedores,
  getExpenseById,
  getExpenseItems,
  getProveedoresDelPeriodo,
  listExpenses,
  registerExpenseOnce,
  ExpenseError,
  type NuevoGasto,
} from '@/lib/services/expenses/expense.service';
import {
  settleSupplier,
  SupplierAccountError,
} from '@/lib/services/expenses/supplier-account.service';
import {
  adjuntarComprobante,
  adjuntarContrato,
  listarAdjuntosDeGasto,
  listarContratosDeTercero,
  quitarComprobante,
  urlParaDescargar,
  AttachmentError,
  type AdjuntoDeGasto,
  type ContratoDeTercero,
} from '@/lib/services/expenses/attachment.service';
import { almacenSupabase } from '@/lib/services/expenses/attachment.storage';
import type { SupplierPaymentMethod } from '@/lib/db/schema/supplier_account';
import {
  armarCsvAcreedores,
  getAcreedoresAlCierre,
} from '@/lib/services/reporting/cierre.report';
import { fechaDeLaFoto } from '@/lib/domain/inventario';
import { searchProducts } from '@/lib/services/products/product.service';
import { getActiveCashSession } from '@/lib/cash/sessions';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import {
  getMesCierreEjercicio,
  periodoDe,
  GRANOS,
  type Grano,
} from '@/lib/services/reporting/accountant.report';

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
 *
 * `clave` es la de idempotencia del formulario (ver `registerExpenseOnce`):
 * el alta vive fija en la pantalla y un doble click no puede cargar dos
 * gastos. Devuelve el id para que el navegador suba el comprobante elegido.
 */
export async function registrarGastoAction(
  input: GastoFormInput,
  clave: string
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    if (typeof clave !== 'string' || clave.length < 8 || clave.length > 100) {
      throw new ExpenseError('clave_invalida', 'Volvé a cargar la página y probá de nuevo.');
    }
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

    const { id } = await registerExpenseOnce(
      {
        ...input,
        ...(cashSessionId !== undefined ? { cash_session_id: cashSessionId } : {}),
      },
      clave
    );

    revalidatePath('/gastos');
    // El panel de la contadora lee el IVA crédito de acá: si no se revalida,
    // sigue mostrando la posición de IVA vieja.
    revalidatePath('/contador');
    // El efectivo sale de la caja: el esperado de /caja cambió.
    if (input.medio_pago === 'efectivo') revalidatePath('/caja');
    return { id };
  });
}

/**
 * Pagarle a un proveedor.
 *
 * Espejo de `cobrarAction` en /clientes: la caja la resuelve el SERVIDOR (si el
 * navegador pudiera elegir a qué sesión imputar la salida, podría mandarla a un
 * arqueo ya cerrado), y sólo el efectivo la toca.
 *
 * La `fecha` es HOY, del calendario del comercio, y no viaja desde el
 * navegador: el pago es el acto de pagar, pasa ahora. Un `new Date()` en el
 * cliente además tomaría la zona de la máquina, que a las 22:00 en Ushuaia ya
 * está en el día siguiente en UTC.
 */
export async function pagarProveedorAction(
  terceroId: string,
  monto: string,
  medio: SupplierPaymentMethod
): Promise<ActionResult<null>> {
  return runAction(async () => {
    let cashSessionId: string | undefined;
    if (medio === 'efectivo') {
      const sesion = await getActiveCashSession(SALE_POINT);
      if (sesion === null) {
        throw new SupplierAccountError(
          'cash_needs_session',
          'No hay una caja abierta. Pagarle a un proveedor en efectivo saca plata del cajón del día.'
        );
      }
      cashSessionId = sesion.id;
    }

    await settleSupplier({
      tercero_id: terceroId,
      amount: monto,
      method: medio,
      fecha: diaDelComercio(),
      ...(cashSessionId !== undefined ? { cash_session_id: cashSessionId } : {}),
    });

    revalidatePath('/gastos');
    // Es plata que sale del cajón: el arqueo de /caja lo tiene que ver ya.
    revalidatePath('/caja');
    revalidatePath('/contador');
    return null;
  });
}

/**
 * Anular un gasto.
 *
 * La caja la resuelve el SERVIDOR, igual que al registrar: si el gasto se pagó
 * en efectivo, la plata vuelve al cajón de HOY y no a la sesión vieja (que
 * puede estar cerrada y arqueada). Es además lo que pasa en la realidad.
 *
 * Los errores del service se muestran TEXTUALES en la pantalla: el de
 * mercadería ya vendida nombra el producto y sus números, y esa es la
 * diferencia entre "no se pudo anular" y "de Yerba 1kg quedan 7 y la compra fue
 * de 10".
 */
export async function anularGastoAction(
  expenseId: string,
  motivo: string
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const original = await getExpenseById(expenseId);
    if (original === null) {
      throw new ExpenseError('no_existe', 'No existe ese gasto');
    }

    let cashSessionId: string | undefined;
    if (original.cash_movement_id !== null) {
      const sesion = await getActiveCashSession(SALE_POINT);
      if (sesion === null) {
        throw new ExpenseError(
          'caja_requerida',
          'Ese gasto se pagó en efectivo: abrí la caja para que la plata pueda volver al cajón.'
        );
      }
      cashSessionId = sesion.id;
    }

    await annulExpense({
      expense_id: expenseId,
      motivo,
      ...(cashSessionId !== undefined ? { cash_session_id: cashSessionId } : {}),
    });

    revalidatePath('/gastos');
    revalidatePath('/contador');
    // Anular devuelve mercadería al stock y puede mover `products.cost`.
    revalidatePath('/productos');
    return null;
  });
}

export interface LineaDTO {
  linea: number;
  /** Nombre al momento de la compra, no el actual. */
  product_name: string;
  qty: string;
  unit_cost: string;
}

/** El detalle (los renglones) de una compra ya cargada. */
export async function getDetalleAction(
  expenseId: string
): Promise<ActionResult<LineaDTO[]>> {
  return runAction(async () => {
    const items = await getExpenseItems(expenseId);
    return items.map((i) => ({
      linea: i.linea,
      product_name: i.product_name_snapshot,
      qty: i.qty,
      unit_cost: i.unit_cost,
    }));
  });
}

export interface ProductoBuscadoDTO {
  id: string;
  name: string;
  sku: string | null;
  cost: string | null;
}

/** Buscar productos para el detalle de una compra. Mismo gesto que el POS. */
export async function buscarProductosAction(
  query: string
): Promise<ActionResult<ProductoBuscadoDTO[]>> {
  return runAction(async () => {
    if (query.trim().length === 0) return [];
    const encontrados = await searchProducts({ query: query.trim(), limit: 8 });
    return encontrados.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      // El costo de la última compra se ofrece como sugerencia al cargar la
      // línea: el proveedor casi siempre repite precio, y si aumentó, se ve
      // contra qué.
      cost: p.cost,
    }));
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

/**
 * CSV de proveedores del período — la primera mitad del ítem 9 de la carta
 * ("detalle de proveedores... razón social, CUIT e importe").
 *
 * Es lo que se les COMPRÓ en el período, pagado o no: `getProveedoresDelPeriodo`
 * no filtra por pago. Decía "lo que se les PAGÓ", que además daba a entender que
 * este archivo y el de acreedores son disjuntos — y no lo son: una compra a 30
 * días impaga sale en los dos.
 *
 * La otra mitad —lo que se les debe a la fecha de cierre— sale de
 * `exportarAcreedoresCsvAction`, acá abajo. Es una FOTO del libro, así que una
 * compra ya saldada figura acá y no allá: los dos archivos se pisan en lo
 * impago, nada más.
 */
export async function exportarProveedoresCsvAction(
  grano?: string
): Promise<{ ok: true; csv: string; nombre: string } | { ok: false; error: string }> {
  try {
    const g: Grano = GRANOS.includes(grano as Grano) ? (grano as Grano) : 'mes';
    const mesCierre = await withServerActionTracing(getMesCierreEjercicio, {
      requireAuth: true,
    });

    const periodo = periodoDe(g, new Date(), mesCierre);
    const desde = periodo.desde.toISOString().slice(0, 10);
    const hasta = periodo.hasta.toISOString().slice(0, 10);

    const csv = await withServerActionTracing(
      async () =>
        armarCsvProveedores(
          await getProveedoresDelPeriodo(desde, hasta),
          periodo.etiqueta
        ),
      { requireAuth: true }
    );

    const ultimo = new Date(periodo.hasta.getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      ok: true,
      csv,
      nombre: `proveedores-${desde}_a_${ultimo}.csv`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo exportar',
    };
  }
}

/**
 * CSV de ACREEDORES al cierre — la otra mitad del ítem 9, y la que el balance
 * pide de verdad: razón social, CUIT e importe de lo que se les DEBE.
 *
 * El corte es el último día del período, no el `hasta` exclusivo, para que el
 * archivo diga la misma fecha que la tarjeta de la pantalla.
 *
 * El CSV lleva adentro sus dos caveats (el corte por fecha de comprobante y que
 * sólo informa lo registrado): un archivo viaja solo, sin la pantalla al lado.
 */
export async function exportarAcreedoresCsvAction(
  grano?: string
): Promise<{ ok: true; csv: string; nombre: string } | { ok: false; error: string }> {
  try {
    const g: Grano = GRANOS.includes(grano as Grano) ? (grano as Grano) : 'mes';
    const mesCierre = await withServerActionTracing(getMesCierreEjercicio, {
      requireAuth: true,
    });

    const periodo = periodoDe(g, new Date(), mesCierre);
    // El MISMO helper que la pantalla (acota a hoy y lee el día en la zona del
    // comercio): el archivo tiene que decir la fecha que dice la tarjeta.
    const alCierre = fechaDeLaFoto(periodo.hasta);

    const csv = await withServerActionTracing(
      async () => armarCsvAcreedores(alCierre, await getAcreedoresAlCierre(alCierre)),
      { requireAuth: true }
    );

    return { ok: true, csv, nombre: `acreedores-al-${alCierre}.csv` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo exportar',
    };
  }
}

// ── Comprobantes adjuntos (ítem 12) ─────────────────────────────────────────
//
// El archivo llega por `FormData` a una Server Action. No es una elección:
// CLAUDE.md §6.2 prohíbe Multer y formidable justamente para que el upload no
// tenga un endpoint propio con reglas propias. La consecuencia buena es que el
// path lo arma el SERVIDOR y el navegador nunca propone dónde se guarda.

export async function adjuntarComprobanteAction(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const expenseId = String(formData.get('expense_id') ?? '');
    const archivo = formData.get('archivo');

    if (!(archivo instanceof File)) {
      throw new AttachmentError('No llegó ningún archivo', 'SIN_ARCHIVO');
    }

    const { id } = await adjuntarComprobante(
      {
        expense_id: expenseId,
        archivo: {
          nombre: archivo.name,
          // Lo que declara el navegador. El service lo valida contra la lista
          // permitida, pero no inspecciona el contenido — ver su comentario.
          contentType: archivo.type,
          bytes: new Uint8Array(await archivo.arrayBuffer()),
        },
      },
      await almacenSupabase()
    );

    revalidatePath('/gastos');
    return { id };
  });
}

export async function listarComprobantesAction(
  expenseId: string
): Promise<ActionResult<AdjuntoDeGasto[]>> {
  return runAction(async () =>
    listarAdjuntosDeGasto(expenseId, await almacenSupabase())
  );
}

/**
 * Devuelve un link firmado de vida corta, o el estado "el archivo no está".
 *
 * La URL no se loguea ni se guarda: es un bearer token con los datos de un
 * tercero adentro (CLAUDE.md §10.5).
 */
export async function urlDeComprobanteAction(
  attachmentId: string
): Promise<ActionResult<{ url: string; nombre: string } | { falta: true }>> {
  return runAction(async () => urlParaDescargar(attachmentId, await almacenSupabase()));
}

// ── Contratos del proveedor (ítem 12, slice 3) ──────────────────────────────

export async function adjuntarContratoAction(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const archivo = formData.get('archivo');
    if (!(archivo instanceof File)) {
      throw new AttachmentError('No llegó ningún archivo', 'SIN_ARCHIVO');
    }

    const { id } = await adjuntarContrato(
      {
        tercero_id: String(formData.get('tercero_id') ?? ''),
        vigencia_desde: String(formData.get('vigencia_desde') ?? ''),
        vigencia_hasta: String(formData.get('vigencia_hasta') ?? ''),
        archivo: {
          nombre: archivo.name,
          contentType: archivo.type,
          bytes: new Uint8Array(await archivo.arrayBuffer()),
        },
      },
      await almacenSupabase()
    );

    revalidatePath('/gastos');
    return { id };
  });
}

export async function listarContratosAction(
  terceroId: string
): Promise<ActionResult<ContratoDeTercero[]>> {
  return runAction(async () =>
    // El día lo resuelve el SERVIDOR en la zona del comercio: si lo mandara el
    // navegador, un contrato vencería o no según el reloj de la máquina.
    listarContratosDeTercero(
      terceroId,
      diaDelComercio(new Date()),
      await almacenSupabase()
    )
  );
}

export async function quitarComprobanteAction(
  attachmentId: string,
  motivo: string
): Promise<ActionResult<null>> {
  return runAction(async () => {
    await quitarComprobante({ attachment_id: attachmentId, motivo });
    revalidatePath('/gastos');
    return null;
  });
}

/** Fijo / variable / mixto de un gasto ya cargado (0045). Agrega una fila. */
export async function clasificarGastoAction(
  expenseId: string,
  comportamiento: string
): Promise<ActionResult<{ cambiado: boolean }>> {
  return runAction(async () => {
    const r = await clasificarGasto(expenseId, comportamiento);
    revalidatePath('/gastos');
    return r;
  });
}
