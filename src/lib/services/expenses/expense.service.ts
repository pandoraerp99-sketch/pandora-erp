/**
 * Gastos del comercio.
 *
 * Nace del pedido real de la contadora: el comercio hoy clasifica gastos y los
 * manda a mano todos los meses. Ver `RESEARCH-BRIEF-gastos.md`.
 *
 * ── EL GASTO NO ES UN MOVIMIENTO DE CAJA ──────────────────────────────────
 * Se registra igual se haya pagado en efectivo, por transferencia o con
 * tarjeta. Sólo el efectivo genera además un `cash_movements` de tipo
 * `provider_payment`, que YA suma en el arqueo. Mismo criterio que el cobro de
 * cuenta corriente (ADR-0027): si todo egreso saliera del cajón, el arqueo
 * descontaría plata que nunca estuvo ahí.
 *
 * Todo con Decimal: es plata (CLAUDE.md §9.8, prohibido Number en ese camino).
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '../../db/client.js';
import {
  expenses,
  GASTO_PAGADO_SQL,
  GASTO_VIGENTE,
  GASTO_VIGENTE_SQL,
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  type Expense,
  type ExpenseCategory,
  type ExpensePaymentMethod,
} from '../../db/schema/expenses.js';
import { expense_items, type ExpenseItem } from '../../db/schema/expense_items.js';
import {
  cantidadAcreedoresSql,
  deudaAProveedoresSql,
  pagosAProveedoresSql,
} from '../../db/schema/supplier_account.js';
import {
  anularDejariaPagosSinRespaldo,
  registerChargeFromExpense,
} from './supplier-account.service.js';
import { products } from '../../db/schema/products.js';
import { terceros } from '../../db/schema/terceros.js';
import { cash_movements } from '../../db/schema/cash_movements.js';
import { cash_sessions } from '../../db/schema/cash_sessions.js';
import {
  recordStockMovement,
  ProductInactiveError,
} from '../../inventory/stock.js';
import { withinTolerance } from '../../money/decimal.js';
import { requireTracingContext } from '../../tracing/context.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { logger } from '../../observability/logger.js';
import { csvArmar, csvNum, csvTxt } from '../reporting/csv.js';
import { diaDelComercio, ZONA_COMERCIO } from '../../domain/fecha-comercio.js';

export class ExpenseError extends DomainError {
  constructor(code: string, messageEs: string) {
    super(code, messageEs, 422);
  }
}

function ctx() {
  const c = requireTracingContext();
  if (!c.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'expense.service (sin tenant en el context)'
    );
  }
  return { tenantId: c.tenant_id, userId: c.actor_user_id };
}

export interface NuevoGasto {
  /** ISO `YYYY-MM-DD`. La del GASTO, no la de la carga. */
  fecha: string;
  categoria: ExpenseCategory;
  /** Total pagado. Obligatorio. */
  total: string;
  /** Si se discrimina, neto + iva tiene que dar el total. */
  neto?: string;
  iva?: string;
  medio_pago: ExpensePaymentMethod;
  /** Proveedor del catálogo. Si no está, alcanza con `payee_name`. */
  tercero_id?: string;
  payee_name?: string;
  payee_doc?: string;
  descripcion?: string;
  comprobante_tipo?: string;
  comprobante_numero?: string;
  en_iva_compras?: boolean;
  /** Obligatorio si `medio_pago='efectivo'`: sale del cajón. */
  cash_session_id?: string;
  /**
   * Detalle de la mercadería que entró. **Sólo para `categoria='mercaderia'`.**
   *
   * Cada línea es un lote: entra al stock como movimiento `purchase` y deja
   * registrado a qué costo, que es lo que el inventario valorizado al cierre
   * necesita y `products.cost` por sí solo no puede dar.
   */
  items?: LineaDeCompra[];
}

export interface LineaDeCompra {
  product_id: string;
  /** Unidades que entraron. */
  qty: string;
  /**
   * Costo unitario **NETO de IVA recuperable**.
   *
   * Si el comprobante discrimina IVA, es el neto por unidad. Si no lo
   * discrimina, el IVA es parte del costo y va incluido. De acá sale
   * `products.cost`.
   */
  unit_cost: string;
}

/**
 * Registra un gasto.
 *
 * En efectivo genera ADEMÁS el movimiento de caja, en la MISMA transacción: si
 * el gasto se guardara y el movimiento no, el arqueo cerraría de más y nadie
 * sabría por qué.
 */
export async function registerExpense(input: NuevoGasto): Promise<Expense> {
  const { tenantId, userId } = ctx();

  if (!EXPENSE_CATEGORIES.includes(input.categoria)) {
    throw new ExpenseError('categoria_invalida', 'Esa categoría no existe');
  }
  if (!EXPENSE_PAYMENT_METHODS.includes(input.medio_pago)) {
    throw new ExpenseError('medio_invalido', 'Ese medio de pago no existe');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) {
    throw new ExpenseError('fecha_invalida', 'La fecha tiene que ser AAAA-MM-DD');
  }

  const total = new Decimal(input.total);
  if (!total.isFinite() || total.lte(0)) {
    throw new ExpenseError('total_invalido', 'El importe tiene que ser mayor a cero');
  }

  const neto = new Decimal(input.neto ?? '0');
  const iva = new Decimal(input.iva ?? '0');
  if (!neto.isFinite() || !iva.isFinite() || neto.lt(0) || iva.lt(0)) {
    throw new ExpenseError('importes_invalidos', 'Los importes no pueden ser negativos');
  }
  // Si se discriminó, tiene que cerrar. Un tipeo acá pone en la DDJJ un crédito
  // fiscal que no coincide con el comprobante.
  const discrimina = neto.gt(0) || iva.gt(0);
  if (discrimina && !neto.plus(iva).eq(total)) {
    throw new ExpenseError(
      'no_cierra',
      `Neto + IVA (${neto.plus(iva).toFixed(2)}) no da el total (${total.toFixed(2)})`
    );
  }

  const comprobante = input.comprobante_numero?.trim() || null;
  if (input.en_iva_compras === true && comprobante === null) {
    throw new ExpenseError(
      'falta_comprobante',
      'Un gasto que entra al IVA compras necesita número de comprobante'
    );
  }

  if (input.medio_pago === 'efectivo' && input.cash_session_id === undefined) {
    throw new ExpenseError(
      'cash_needs_session',
      'Un gasto pagado en efectivo necesita una caja abierta: la plata sale del cajón'
    );
  }

  // Un gasto a cuenta corriente es una DEUDA, y una deuda sin acreedor
  // identificado no se puede ni pagar ni informar. `payee_name` como texto
  // suelto no alcanza: dos tipeos del mismo nombre serían dos acreedores
  // distintos en el listado que va al estudio.
  if (input.medio_pago === 'cuenta_corriente' && !input.tercero_id) {
    throw new ExpenseError(
      'cta_cte_needs_tercero',
      'Un gasto a cuenta corriente necesita el proveedor elegido de la lista: es a quién se le debe'
    );
  }

  // ── Las líneas de mercadería ──
  const items = input.items ?? [];
  if (items.length > 0 && input.categoria !== 'mercaderia') {
    throw new ExpenseError(
      'items_solo_mercaderia',
      'Sólo un gasto de mercadería lleva detalle de productos'
    );
  }

  // La mercadería entra al stock HOY y su movimiento lleva la fecha del
  // comprobante (migration 0037). Un comprobante de fecha futura dejaría el
  // libro de stock sin reconstruir el stock de hoy. Se rechaza acá, antes de
  // escribir nada, con un mensaje para el comerciante — el libro lo rechazaría
  // igual, pero a mitad de la transacción y en idioma de sistema.
  if (items.length > 0 && input.fecha > diaDelComercio()) {
    throw new ExpenseError(
      'fecha_futura',
      'Una compra de mercadería no puede tener fecha futura: la mercadería entra al stock hoy'
    );
  }

  if (items.length > 0) {
    for (const [i, linea] of items.entries()) {
      const qty = new Decimal(linea.qty);
      const costo = new Decimal(linea.unit_cost);
      if (!qty.isFinite() || qty.lte(0)) {
        throw new ExpenseError('linea_qty_invalida', `La línea ${i + 1} no tiene cantidad`);
      }
      if (!costo.isFinite() || costo.lt(0)) {
        throw new ExpenseError('linea_costo_invalido', `La línea ${i + 1} tiene un costo inválido`);
      }
    }

    // Las líneas tienen que dar lo mismo que el comprobante.
    //
    // Contra el NETO si el IVA está discriminado, contra el TOTAL si no: el
    // IVA no discriminado no da crédito fiscal, así que es parte del costo de
    // la mercadería. Esa distinción es la que mantiene `products.cost` neto de
    // IVA recuperable — y de `products.cost` sale `unit_cost_snapshot` al
    // vender, así que un costo en bruto dejaría todos los márgenes
    // subestimados con un número que parece razonable.
    const base = discrimina ? neto : total;
    const suma = items.reduce(
      (acc, l) => acc.plus(new Decimal(l.qty).times(l.unit_cost)),
      new Decimal(0)
    );
    // Tolerancia de reconciliación (no fiscal): qty × costo con 4 decimales no
    // tiene por qué dar exacto contra un comprobante redondeado a centavos.
    if (!withinTolerance(suma, base)) {
      throw new ExpenseError(
        'lineas_no_cierran',
        `El detalle suma ${suma.toFixed(2)} y el comprobante dice ${base.toFixed(2)}` +
          (discrimina ? ' (neto, sin IVA)' : '')
      );
    }
  }

  // El proveedor tiene que ser de ESTE comercio, y su nombre se copia como
  // snapshot: si mañana se renombra o se da de baja, el gasto sigue diciendo a
  // quién se le pagó.
  let payeeName = input.payee_name?.trim() || null;
  let payeeDoc = input.payee_doc?.trim() || null;
  if (input.tercero_id !== undefined) {
    const [t] = await db
      .select({ name: terceros.name, doc: terceros.doc })
      .from(terceros)
      .where(
        and(eq(terceros.tenant_id, tenantId), eq(terceros.id, input.tercero_id))
      )
      .limit(1);
    if (!t) {
      throw new ExpenseError(
        'tercero_not_found',
        'Ese proveedor no existe en este comercio'
      );
    }
    payeeName = t.name;
    payeeDoc = t.doc;
  }

  return db.transaction(async (tx) => {
    let cashMovementId: bigint | null = null;

    if (input.medio_pago === 'efectivo') {
      if (!userId) {
        throw new ExpenseError(
          'no_actor',
          'Un gasto en efectivo necesita un usuario identificado'
        );
      }
      const [sesion] = await tx
        .select({ id: cash_sessions.id, closed_at: cash_sessions.closed_at })
        .from(cash_sessions)
        .where(
          and(
            eq(cash_sessions.tenant_id, tenantId),
            eq(cash_sessions.id, input.cash_session_id!)
          )
        )
        .limit(1);
      if (!sesion) throw new ExpenseError('session_not_found', 'No existe esa caja');
      if (sesion.closed_at !== null) {
        throw new ExpenseError(
          'session_closed',
          'La caja ya está cerrada: no se puede sacar plata de una caja cerrada'
        );
      }

      const [mov] = await tx
        .insert(cash_movements)
        .values({
          cash_session_id: input.cash_session_id!,
          type: 'provider_payment',
          amount: total.toFixed(4),
          reason: payeeName ? `Gasto · ${payeeName}` : 'Gasto',
          created_by: userId,
        })
        .returning({ id: cash_movements.id });
      cashMovementId = mov?.id ?? null;
    }

    const [fila] = await tx
      .insert(expenses)
      .values({
        tenant_id: tenantId,
        fecha: input.fecha,
        categoria: input.categoria,
        tercero_id: input.tercero_id ?? null,
        payee_name: payeeName,
        payee_doc: payeeDoc,
        neto: neto.toFixed(4),
        iva: iva.toFixed(4),
        total: total.toFixed(4),
        descripcion: input.descripcion?.trim() || null,
        comprobante_tipo: input.comprobante_tipo?.trim() || null,
        comprobante_numero: comprobante,
        en_iva_compras: input.en_iva_compras ?? false,
        medio_pago: input.medio_pago,
        cash_movement_id: cashMovementId,
        created_by: userId,
      })
      .returning();

    if (!fila) throw new Error('Insert de gasto no devolvio fila');

    // ── La compra a crédito genera la deuda, en la MISMA transacción ──
    //
    // Mismo motivo que el stock de abajo: si el gasto queda y la deuda no, el
    // proveedor desaparece del listado de acreedores y nadie se entera hasta
    // que reclama. La fecha es la DEL GASTO, no la de hoy — el corte al cierre
    // depende de ella.
    if (input.medio_pago === 'cuenta_corriente') {
      await registerChargeFromExpense(
        {
          tercero_id: input.tercero_id!,
          expense_id: fila.id,
          amount: total.toFixed(4),
          fecha: input.fecha,
        },
        tx
      );
    }

    // ── La mercadería entra al stock, en la MISMA transacción ──
    //
    // Si el gasto se guardara y los movimientos no, el comercio tendría el
    // comprobante cargado y la mercadería invisible — que es exactamente el
    // agujero que este módulo vino a cerrar.
    const tocados = new Set<string>();
    const stockMovementIds: string[] = [];

    for (const [indice, linea] of items.entries()) {
      const [producto] = await tx
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(and(eq(products.tenant_id, tenantId), eq(products.id, linea.product_id)))
        .limit(1);
      if (!producto) {
        throw new ExpenseError(
          'producto_no_existe',
          `Un producto del detalle no existe en este comercio`
        );
      }

      const qty = new Decimal(linea.qty);
      const costo = new Decimal(linea.unit_cost);

      await tx.insert(expense_items).values({
        tenant_id: tenantId,
        expense_id: fila.id,
        // El renglón del papel, en el orden en que se cargó (migration 0036).
        // Es lo que hace que el detalle se relea siempre igual y que anular
        // pueda decidir qué línea fija el costo.
        linea: indice + 1,
        product_id: linea.product_id,
        qty: qty.toFixed(4),
        unit_cost: costo.toFixed(4),
        product_name_snapshot: producto.name,
      });

      try {
        const { movement } = await recordStockMovement(
          {
            product_id: linea.product_id,
            type: 'purchase',
            qty: qty.toFixed(4),
            related_expense_id: fila.id,
            // La fecha del comprobante, no la de carga: es cuándo entró la
            // mercadería, y es la misma que usa el lote en el inventario al
            // cierre. Con dos relojes, la cantidad y el lote no cerraban.
            fecha: input.fecha,
            // Una compra no es un ajuste manual: el movimiento no emite
            // `stock.adjusted_manually`. Lo audita `expense.registered` más
            // abajo con los ids de estos movimientos — mismo patrón que
            // `finalizeSale` con `sale.completed`. Sin ese evento, la
            // mercadería entraría al stock sin rastro de auditoría.
            skip_audit: true,
          },
          tx
        );
        stockMovementIds.push(String(movement.id));
      } catch (e) {
        if (e instanceof ProductInactiveError) {
          throw new ExpenseError(
            'producto_inactivo',
            `${producto.name} está dado de baja: reactivalo antes de comprarlo`
          );
        }
        throw e;
      }

      tocados.add(linea.product_id);
    }

    await recalcularCostoUltimaCompra(tx, tenantId, [...tocados]);

    // EVENT-TAXONOMY v2.1.0. En la MISMA transacción: si el evento no se
    // escribe, el gasto tampoco (CLAUDE.md §15.2). Sólo ids e importes; el
    // nombre y el CUIT del proveedor ya viven en la fila de `expenses`.
    await writeAuditLog(
      {
        event_name: 'expense.registered',
        payload: {
          expense_id: fila.id,
          fecha: fila.fecha,
          categoria: fila.categoria,
          total: fila.total,
          neto: fila.neto,
          iva: fila.iva,
          medio_pago: fila.medio_pago,
          en_iva_compras: fila.en_iva_compras,
          tercero_id: fila.tercero_id,
          comprobante_tipo: fila.comprobante_tipo,
          comprobante_numero: fila.comprobante_numero,
          cash_movement_id: cashMovementId === null ? null : String(cashMovementId),
          items: items.map((l) => ({
            product_id: l.product_id,
            qty: new Decimal(l.qty).toFixed(4),
            unit_cost: new Decimal(l.unit_cost).toFixed(4),
          })),
          stock_movement_ids: stockMovementIds,
        },
        pii_level: 'internal',
        severity: 'info',
      },
      tx
    );

    logger.info(
      {
        expense_id: fila.id,
        categoria: fila.categoria,
        lineas: items.length,
        total: fila.total,
        medio_pago: fila.medio_pago,
        en_iva_compras: fila.en_iva_compras,
        cash_movement_id: cashMovementId,
      },
      'expense.registered'
    );

    return fila;
  });
}

/**
 * Deja `products.cost` en el costo de la **última compra vigente** de cada
 * producto, o en NULL si no le queda ninguna.
 *
 * ── LA REGLA, EN UN SOLO LUGAR ────────────────────────────────────────────
 * "Última" se resuelve por, en este orden: fecha del comprobante, cuándo se
 * cargó, y número de renglón. Las tres hacen falta:
 *
 *  - **Fecha del comprobante**, no orden de carga: cargar en septiembre una
 *    factura de marzo que quedó traspapelada es normal, y escribir el costo de
 *    marzo encima del de septiembre haría que el margen de todas las ventas
 *    siguientes se calcule contra un precio viejo, con un número que parece
 *    perfectamente razonable.
 *  - **Cuándo se cargó**, para desempatar dos comprobantes de la misma fecha.
 *  - **Renglón** (migration 0036), para el mismo producto dos veces en un
 *    comprobante — la bonificación por cantidad: 10 a 800 y 5 a 780. Sin esta
 *    columna las dos filas comparten `created_at` y el desempate sería azar.
 *
 * 🔴 Si no queda NINGUNA compra vigente (se anuló la única), el costo va a
 * **NULL, no al valor anterior**: la única fuente de costo que el sistema tiene
 * es una compra, y la que lo había fijado acaba de dejar de existir. Dejar el
 * número sería afirmar el costo de un comprobante anulado; NULL es "no sé", que
 * el bloque de Rentabilidad ya sabe mostrar como hueco en vez de rellenarlo.
 * Cuesta: si el costo había sido tipeado a mano en el alta, se pierde. Se
 * prefiere perder un dato declarado antes que conservar uno desmentido.
 */
async function recalcularCostoUltimaCompra(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  productIds: string[]
): Promise<void> {
  if (productIds.length === 0) return;

  // Sin alias en `expenses`: `GASTO_VIGENTE_SQL` nombra la tabla, que es lo que
  // permite que la regla de "vigente" viva escrita una sola vez.
  const ultimas = await tx.execute<{ product_id: string; unit_cost: string }>(sql`
    SELECT DISTINCT ON (expense_items.product_id)
           expense_items.product_id,
           expense_items.unit_cost::text AS unit_cost
      FROM expense_items
      JOIN expenses ON expenses.id = expense_items.expense_id
     WHERE expense_items.tenant_id = ${tenantId}
       AND expense_items.product_id IN (${sql.join(
         productIds.map((id) => sql`${id}::uuid`),
         sql`, `
       )})
       AND ${GASTO_VIGENTE_SQL}
     ORDER BY expense_items.product_id,
              expenses.fecha DESC,
              expenses.created_at DESC,
              expense_items.linea DESC
  `);

  const costoDe = new Map(ultimas.map((f) => [f.product_id, f.unit_cost]));

  for (const productId of productIds) {
    const costo = costoDe.get(productId) ?? null;
    await tx
      .update(products)
      .set({
        cost: costo === null ? null : new Decimal(costo).toFixed(4),
        updated_at: new Date(),
      })
      .where(and(eq(products.tenant_id, tenantId), eq(products.id, productId)));
  }
}

export interface AnulacionGasto {
  /** Gasto a anular. */
  expense_id: string;
  /** Por qué se anula. Obligatorio: queda en la fila de anulación. */
  motivo: string;
  /**
   * Caja ABIERTA donde devolver la plata. Sólo hace falta si el gasto original
   * se pagó en efectivo (si no, no hay nada que devolver).
   */
  cash_session_id?: string;
}

/**
 * Anula un gasto.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 * Hasta la migration 0033 un gasto cargado de más NO se podía deshacer por
 * ningún camino: el trigger bloquea UPDATE y DELETE, y el CHECK `total > 0`
 * impedía el "gasto de ajuste" negativo que el brief de gastos daba por
 * disponible. Se encontró construyendo compras de mercadería — una compra mal
 * tipeada corrompería el inventario valorizado que va al estudio.
 *
 * ── CÓMO ──────────────────────────────────────────────────────────────────
 * No edita nada: INSERTA una fila en CERO que apunta al original con
 * `corrects_id` (patrón ADR-0026). El original deja de estar vigente porque
 * alguien lo apunta; la fila nueva no cuenta porque su total es 0. Las dos
 * quedan, y se puede ver qué se anuló y por qué.
 *
 * ⚠️ **Hereda la `fecha` del original, no la de hoy.** Las 7 consultas que
 * leen esta tabla filtran por rango de fechas. Si la anulación de un gasto de
 * marzo llevara la fecha de hoy, marzo perdería el gasto y septiembre ganaría
 * una fila fantasma — y ningún total se vería mal, la plata cambiaría de
 * período en silencio.
 *
 * ── LA PLATA VUELVE A LA CAJA DE HOY ──────────────────────────────────────
 * Si el gasto se pagó en efectivo salió del cajón. Devolverla es un `deposit`
 * en la caja **abierta ahora**, no en la sesión vieja: esa puede estar cerrada
 * y arqueada, y meterle un movimiento cambiaría un cierre ya hecho. Es además
 * lo que pasa en la realidad: la plata vuelve al cajón el día que te das
 * cuenta.
 *
 * Para corregir un IMPORTE (no anular): anular y volver a cargar con el valor
 * correcto. No se implementa una corrección parcial porque obligaría a
 * calcular el delta contra la caja, y anular+cargar da el mismo resultado.
 */
export async function annulExpense(input: AnulacionGasto): Promise<Expense> {
  const { tenantId, userId } = ctx();

  const motivo = input.motivo?.trim() ?? '';
  if (motivo.length < 3) {
    throw new ExpenseError(
      'motivo_requerido',
      'Anular un gasto necesita un motivo (mínimo 3 caracteres)'
    );
  }

  return db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(expenses)
      .where(and(eq(expenses.tenant_id, tenantId), eq(expenses.id, input.expense_id)))
      .limit(1);

    if (!original) {
      throw new ExpenseError('no_existe', 'No existe ese gasto');
    }

    // Ya anulado o ya corregido. El UNIQUE parcial sobre `corrects_id` es la
    // defensa real contra dos anulaciones concurrentes; este chequeo es para
    // dar un mensaje entendible en el caso normal.
    const [yaCorregido] = await tx
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.corrects_id, original.id))
      .limit(1);
    if (yaCorregido) {
      throw new ExpenseError('ya_anulado', 'Ese gasto ya fue anulado o corregido');
    }
    if (new Decimal(original.total).lte(0)) {
      throw new ExpenseError(
        'no_anulable',
        'Esa fila ya es una anulación: no se anula una anulación'
      );
    }

    // ── Un gasto a cuenta corriente con plata ya aplicada no se anula ──
    //
    // Decisión del owner (2026-09-17), fail-closed. Las alternativas eran peores:
    //   - arrastrar los pagos a la fila corregida obliga a caminar la cadena de
    //     `corrects_id` en CADA cálculo de saldo, y una cadena larga es donde
    //     se esconden los errores;
    //   - compensar con un `adjustment` automático inventa un movimiento que
    //     nadie registró, en un libro append-only que después nadie entiende.
    // Primero se deshace el pago —con su motivo, que queda auditado— y recién
    // ahí se anula.
    //
    // Lo que bloquea NO es "el proveedor tuvo pagos": es que al sacar este
    // cargo su saldo quedaría NEGATIVO, o sea plata pagada sin deuda contra
    // qué ir. Si le pagaste otra factura, ese pago lo absorbe la otra y este
    // duplicado se puede anular tranquilo.
    if (original.medio_pago === 'cuenta_corriente') {
      if (await anularDejariaPagosSinRespaldo(original.id, tx)) {
        throw new ExpenseError(
          'tiene_pagos',
          'No se puede anular: al proveedor ya se le pagó más de lo que quedaría debiéndole. ' +
            'Registrá primero el ajuste que revierte esa plata, y después anulalo.'
        );
      }
    }

    // ── Deshacer la entrada de mercadería, si la hubo ──
    //
    // Se chequea TODO antes de escribir nada. Una compra de 8 líneas que
    // fallara en la tercera dejaría al comerciante arreglando un producto,
    // reintentando, y chocando con el siguiente.
    const lineas = await tx
      .select()
      .from(expense_items)
      .where(
        and(
          eq(expense_items.tenant_id, tenantId),
          eq(expense_items.expense_id, original.id)
        )
      );

    const salidasDeStock: string[] = [];
    let depositoId: bigint | null = null;

    if (lineas.length > 0) {
      const sinStock: string[] = [];
      for (const linea of lineas) {
        const [prod] = await tx
          .select({ stock: products.stock_current, tracking: products.stock_tracking_enabled })
          .from(products)
          .where(and(eq(products.tenant_id, tenantId), eq(products.id, linea.product_id)))
          .limit(1);
        if (prod && prod.tracking && new Decimal(prod.stock).lt(linea.qty)) {
          sinStock.push(
            `${linea.product_name_snapshot} (quedan ${new Decimal(prod.stock).toFixed(2)} y hay que sacar ${new Decimal(linea.qty).toFixed(2)})`
          );
        }
      }
      if (sinStock.length > 0) {
        // Fail-closed: dejar el stock en negativo metería cantidades negativas
        // valorizadas al costo en el inventario que va al estudio. Si ya se
        // vendió la mercadería, la compra ocurrió — lo que hay que corregir es
        // otra cosa.
        throw new ExpenseError(
          'mercaderia_ya_vendida',
          `No se puede anular: ya se vendió parte de esta mercadería. ${sinStock.join('; ')}. Registrá un ajuste de stock con el motivo en vez de anular el comprobante.`
        );
      }

      for (const linea of lineas) {
        const { movement } = await recordStockMovement(
          {
            product_id: linea.product_id,
            // `adjustment` con dirección explícita, NO `return`: el catálogo
            // dice que una devolución a proveedor descuenta pero
            // `inferDirection` devuelve 'in' — usar `return` acá ataría el
            // significado del ledger a una función documentada como
            // contradictoria (ver el brief §6.3).
            type: 'adjustment',
            direction: 'out',
            qty: linea.qty,
            reason: `Anulación de compra · ${original.comprobante_numero ?? original.payee_name ?? 'sin comprobante'}`,
            // La fecha del comprobante ORIGINAL, igual que la fila de anulación
            // en `expenses`. Con la de hoy, anular en septiembre una compra de
            // julio sacaría el lote de julio pero dejaría la cantidad de julio
            // con esa mercadería adentro.
            fecha: original.fecha,
            // A qué compra revierte. Antes no se guardaba, y la migration 0037
            // tuvo que abortar-si-existían en vez de poder fecharlas.
            related_expense_id: original.id,
            // No es un ajuste manual del comerciante: es la contracara de una
            // anulación. Auditarlo como `stock.adjusted_manually` haría que el
            // audit log mintiera sobre quién movió el stock y por qué. Lo
            // audita `expense.annulled`, con estos ids.
            skip_audit: true,
          },
          tx
        );
        salidasDeStock.push(String(movement.id));
      }
    }

    // ── Devolver la plata al cajón, si había salido de ahí ──
    if (original.cash_movement_id !== null) {
      if (!userId) {
        throw new ExpenseError(
          'no_actor',
          'Devolver plata a la caja necesita un usuario identificado'
        );
      }
      if (!input.cash_session_id) {
        throw new ExpenseError(
          'caja_requerida',
          'Ese gasto se pagó en efectivo: hace falta una caja abierta para devolver la plata'
        );
      }
      const [sesion] = await tx
        .select({ id: cash_sessions.id, closed_at: cash_sessions.closed_at })
        .from(cash_sessions)
        .where(
          and(
            eq(cash_sessions.tenant_id, tenantId),
            eq(cash_sessions.id, input.cash_session_id)
          )
        )
        .limit(1);
      if (!sesion) throw new ExpenseError('session_not_found', 'No existe esa caja');
      if (sesion.closed_at !== null) {
        throw new ExpenseError(
          'session_closed',
          'La caja ya está cerrada: abrí la caja para devolver la plata del gasto anulado'
        );
      }

      const [deposito] = await tx
        .insert(cash_movements)
        .values({
          cash_session_id: input.cash_session_id,
          type: 'deposit',
          amount: new Decimal(original.total).toFixed(4),
          // El deposit NO se linkea a la fila de anulación: `cash_movement_id` es
          // el 1:1 gasto→egreso, y un ingreso no es el pago de un gasto. El
          // vínculo queda acá, en texto, y en el evento `expense.annulled`.
          reason: `Anulación de gasto · ${original.payee_name ?? original.categoria}`,
          created_by: userId,
        })
        .returning({ id: cash_movements.id });
      depositoId = deposito?.id ?? null;
    }

    const [fila] = await tx
      .insert(expenses)
      .values({
        tenant_id: tenantId,
        // Todo lo que describe QUÉ se anula se copia tal cual.
        fecha: original.fecha,
        categoria: original.categoria,
        tercero_id: original.tercero_id,
        payee_name: original.payee_name,
        payee_doc: original.payee_doc,
        comprobante_tipo: original.comprobante_tipo,
        comprobante_numero: original.comprobante_numero,
        en_iva_compras: original.en_iva_compras,
        medio_pago: original.medio_pago,
        // Los importes en cero son lo que hace que no cuente en ningún lado.
        total: '0.0000',
        neto: '0.0000',
        iva: '0.0000',
        descripcion: `ANULADO: ${motivo}`,
        corrects_id: original.id,
        cash_movement_id: null,
        created_by: userId,
      })
      .returning();

    if (!fila) throw new Error('Insert de anulacion no devolvio fila');

    // Recién ACÁ, con la fila de anulación ya insertada, el original dejó de
    // estar vigente — así que el recálculo ya no lo ve. Antes de este insert
    // habría vuelto a elegir el costo del comprobante que se está anulando.
    await recalcularCostoUltimaCompra(
      tx,
      tenantId,
      [...new Set(lineas.map((l) => l.product_id))]
    );

    // EVENT-TAXONOMY v2.1.0 — warning: deshace un hecho ya registrado (devuelve
    // plata, saca stock). Es la operación que la contadora o un inspector van a
    // preguntar, y la fila `ANULADO: <motivo>` dice qué pero no quién ni cuándo.
    await writeAuditLog(
      {
        event_name: 'expense.annulled',
        payload: {
          expense_id: original.id,
          annulment_id: fila.id,
          fecha_original: original.fecha,
          total_anulado: original.total,
          motivo,
          devolvio_a_caja: original.cash_movement_id !== null,
          cash_session_id: original.cash_movement_id !== null ? input.cash_session_id! : null,
          deposit_cash_movement_id: depositoId === null ? null : String(depositoId),
          stock_movement_ids: salidasDeStock,
        },
        pii_level: 'internal',
        severity: 'warning',
      },
      tx
    );

    logger.info(
      {
        expense_id: original.id,
        anulacion_id: fila.id,
        total_anulado: original.total,
        devolvio_a_caja: original.cash_movement_id !== null,
        motivo,
      },
      'expense.annulled'
    );

    return fila;
  });
}

/**
 * Un gasto por id, sin filtro de vigencia.
 *
 * A diferencia de `listExpenses`, devuelve también un gasto ya anulado: esta
 * lectura es para operar sobre una fila puntual (anularla, ver su detalle), no
 * para sumar ni informar. La vigencia la decide quien la usa.
 */
export async function getExpenseById(id: string): Promise<Expense | null> {
  const { tenantId } = ctx();
  const [fila] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.tenant_id, tenantId), eq(expenses.id, id)))
    .limit(1);
  return fila ?? null;
}

/**
 * El detalle de una compra: los renglones tal como se cargaron.
 *
 * Ordenado por `linea` (migration 0036) y no por `created_at`, porque las
 * líneas de un mismo comprobante se insertan en una sola transacción y
 * comparten el timestamp: sin el renglón, el mismo detalle se releería hoy en
 * un orden y mañana en otro, y no se podría cotejar contra el papel.
 *
 * Devuelve el nombre **snapshot**, no el actual del producto: si mañana lo
 * renombran, el comprobante viejo tiene que seguir diciendo lo que decía.
 */
export async function getExpenseItems(expenseId: string): Promise<ExpenseItem[]> {
  const { tenantId } = ctx();
  return db
    .select()
    .from(expense_items)
    .where(
      and(
        eq(expense_items.tenant_id, tenantId),
        eq(expense_items.expense_id, expenseId)
      )
    )
    .orderBy(expense_items.linea);
}

/**
 * Cuántos renglones tiene cada gasto de la lista.
 *
 * Es para que la pantalla sepa a cuáles ofrecerles "ver detalle" sin pedir el
 * detalle de todos. Un botón que al apretarlo dice "no hay nada" es peor que no
 * tener botón.
 */
export async function getItemCountsByExpense(
  expenseIds: string[]
): Promise<Record<string, number>> {
  const { tenantId } = ctx();
  if (expenseIds.length === 0) return {};

  const filas = await db.execute<{ expense_id: string; cantidad: string }>(sql`
    SELECT expense_id::text AS expense_id, count(*)::text AS cantidad
      FROM expense_items
     WHERE tenant_id = ${tenantId}
       AND expense_id IN (${sql.join(
         expenseIds.map((id) => sql`${id}::uuid`),
         sql`, `
       )})
     GROUP BY expense_id
  `);

  return Object.fromEntries(filas.map((f) => [f.expense_id, Number(f.cantidad)]));
}

/**
 * Los gastos ANULADOS del rango: el original con su anulación al lado.
 *
 * 🔴 Existe porque anular hace desaparecer el gasto de todas las demás
 * lecturas: el original deja de estar vigente (alguien lo apunta) y la fila de
 * anulación vale 0. Para el CSV del estudio eso es exactamente lo correcto —
 * un comprobante anulado no se informa — pero en la pantalla el comerciante ve
 * que el gasto se evapora, y no tiene forma de distinguir "lo anulé" de
 * "apreté mal y borré algo".
 *
 * Mismo criterio que los medios de pago corregidos en el cierre de caja
 * (ADR-0026): no se esconden, se muestran donde corresponde y no suman.
 *
 * ⚠️ El rango filtra por **cuándo se anuló**, no por la fecha del comprobante
 * (ver el comentario en el WHERE). Es la única lectura de este módulo que no
 * usa `expenses.fecha`, y es deliberado.
 */
export interface GastoAnulado {
  [k: string]: string | null;
  id: string;
  fecha: string;
  categoria: string;
  payee_name: string | null;
  comprobante_numero: string | null;
  total: string;
  motivo: string | null;
  /** 'AAAA-MM-DD': el día del comercio en que se anuló. */
  anulado_el: string;
}

export async function listAnnulledExpenses(
  desde: string,
  hasta: string
): Promise<GastoAnulado[]> {
  const { tenantId } = ctx();
  return db.execute<GastoAnulado>(sql`
    SELECT o.id::text          AS id,
           o.fecha::text       AS fecha,
           o.categoria,
           o.payee_name,
           o.comprobante_numero,
           o.total::text       AS total,
           -- El motivo se guarda como "ANULADO: <motivo>" en la descripción de
           -- la fila de anulación; se devuelve limpio para la pantalla.
           regexp_replace(a.descripcion, '^ANULADO: ', '') AS motivo,
           -- El DÍA del comercio, sin hora: created_at::text sale en UTC, y la
           -- anulación de las 22:30 del 31 se mostraba "anulada el 1". Se
           -- devuelve AAAA-MM-DD (como "cargado" en inventory/queries.ts) y no
           -- un timestamp sin offset, que un new Date() leería en otro huso.
           (a.created_at AT TIME ZONE ${ZONA_COMERCIO})::date::text AS anulado_el
      FROM expenses a
      JOIN expenses o ON o.id = a.corrects_id
     WHERE a.tenant_id = ${tenantId}
       -- 🔴 Por CUANDO SE ANULO, no por la fecha del comprobante.
       --
       -- La anulacion hereda la fecha del original a proposito, para que la
       -- plata no cambie de periodo (es lo que hace que los totales cierren).
       -- Pero esta pestania no contesta "que gastos hay en marzo": contesta
       -- "que anule". Anular hoy un comprobante de marzo es algo que paso HOY.
       --
       -- Y no es cosmetico: al anular, la pantalla salta a esta pestania. Con
       -- el filtro por la fecha del original, anular un gasto viejo dejaba al
       -- comerciante mirando "No anulaste ningun gasto en este periodo" un
       -- segundo despues de anular uno.
       --
       -- El corte es la medianoche DEL COMERCIO. created_at >= 'AAAA-MM-DD'::date
       -- compara contra la medianoche UTC: tres horas de anulaciones caían en
       -- el período siguiente.
       AND a.created_at >= (${desde}::date::timestamp AT TIME ZONE ${ZONA_COMERCIO})
       AND a.created_at <  (${hasta}::date::timestamp AT TIME ZONE ${ZONA_COMERCIO})
     ORDER BY a.created_at DESC
  `);
}

/** Gastos de un rango, del más nuevo al más viejo. */
export async function listExpenses(
  desde: string,
  hasta: string
): Promise<Expense[]> {
  const { tenantId } = ctx();
  return db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.tenant_id, tenantId),
        gte(expenses.fecha, desde),
        lt(expenses.fecha, hasta),
        GASTO_VIGENTE
      )
    )
    .orderBy(sql`fecha DESC, created_at DESC`);
}

export interface TotalPorCategoria {
  [k: string]: string;
  categoria: string;
  /**
   * DEVENGADO: lo pagado de una en el período. Ojo — esta función NO puede
   * informar "plata que salió" (ver el comentario de la consulta): un pago a
   * proveedor no tiene rubro. No tiene por qué coincidir con el total del
   * resumen, y no es un bug.
   */
  total: string;
  neto: string;
  iva: string;
  cantidad: string;
  /** Comprado a crédito EN ESTE PERÍODO. No es la deuda que queda hoy. */
  impago: string;
  impago_cantidad: string;
}

/**
 * Totales por categoría del período, separando lo que ya está en el IVA
 * compras de lo que no.
 *
 * Esa separación es el punto: los gastos CON comprobante fiscal el estudio ya
 * los baja de ARCA; los que NO son los que el comercio tiene que mandar. Un
 * listado que los mezcla le devuelve al comercio el trabajo de separarlos.
 */
export async function getExpenseTotals(
  desde: string,
  hasta: string,
  soloFueraDeArca = false
): Promise<TotalPorCategoria[]> {
  const { tenantId } = ctx();
  return db.execute<TotalPorCategoria>(
    // ⚠️ LIMITACIÓN DECLARADA — esta función NO es "plata que salió".
    //
    // Los otros tres lectores (getExpenseSummary, getResumenContable y el
    // gráfico de ingresos vs gastos) suman los pagos a proveedores al mes en
    // que se pagaron, que es el criterio que eligió el owner. Acá no se puede:
    // esta consulta agrupa POR CATEGORÍA y un pago a proveedor no tiene
    // categoría — se le paga al proveedor, no a una factura. Imputar el pago a
    // comprobantes (PEPS o lo que fuere) sería inventar un dato que nadie cargó.
    //
    // Así que lo que este listado informa es DEVENGADO: qué se gastó en cada
    // rubro en el período, pagado o no. `total` = lo pagado de una, `impago` =
    // lo comprado a crédito EN ESTE PERÍODO (no lo que sigue debiéndose hoy:
    // para eso está el reporte de acreedores, que sale del libro).
    //
    // Es una vista legítima, pero es otra pregunta que la del resumen: los dos
    // números no tienen por qué coincidir, y no es un bug cuando no coinciden.
    sql`SELECT categoria,
               sum(total) FILTER (WHERE ${GASTO_PAGADO_SQL})::text AS total,
               sum(neto)  FILTER (WHERE ${GASTO_PAGADO_SQL})::text AS neto,
               sum(iva)   FILTER (WHERE ${GASTO_PAGADO_SQL})::text AS iva,
               count(*)   FILTER (WHERE ${GASTO_PAGADO_SQL})::text AS cantidad,
               COALESCE(sum(total) FILTER (WHERE NOT ${GASTO_PAGADO_SQL}), 0)::text AS impago,
               count(*) FILTER (WHERE NOT ${GASTO_PAGADO_SQL})::text AS impago_cantidad
        FROM expenses
        WHERE tenant_id = ${tenantId}
          AND fecha >= ${desde}::date AND fecha < ${hasta}::date
          AND ${GASTO_VIGENTE_SQL}
          ${soloFueraDeArca ? sql`AND en_iva_compras = false` : sql``}
        GROUP BY categoria
        -- ORDER BY sum(total), NO 'ORDER BY 2'. La columna 2 es el total ya
        -- casteado a TEXT, y ordenar texto compara caracter por caracter:
        -- '95000' sale antes que '400000' porque '9' > '4'. Se veia en
        -- pantalla — Honorarios arriba de Alquiler — y el numero de cada fila
        -- estaba bien, asi que no habia nada que delatara el error salvo
        -- mirar el orden.
        ORDER BY sum(total) DESC`
  );
}

/**
 * El último día de un período, dado su `hasta` EXCLUSIVO ('AAAA-MM-DD').
 *
 * Es sólo el default de `getExpenseSummary` para quien no pase la fecha de
 * corte. La regla buena —que además acota a hoy— es `fechaDeLaFoto`, y es la
 * que usan las pantallas; acá no se puede importar porque vive en `domain` y
 * arrastraría Decimal al lugar equivocado.
 */
function ultimoDiaDe(hastaExclusivo: string): string {
  const d = new Date(`${hastaExclusivo}T00:00:00Z`);
  return new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10);
}

export interface ResumenGastos {
  [k: string]: string;
  /**
   * Plata que SALIÓ en el período: los gastos pagados de una + lo que se les
   * pagó a proveedores por compras a cuenta corriente (de cualquier mes).
   */
  total: string;
  /**
   * Cantidad de GASTOS pagados de una. A propósito NO cuenta los pagos a
   * proveedores: un pago puede saldar tres facturas o media, así que sumarlo
   * acá rompería cualquier promedio por gasto que la pantalla derive.
   */
  cantidad: string;
  /**
   * Lo que se le DEBE a proveedores al cierre del rango — una foto, no un flujo.
   * Sale del libro, misma regla que el reporte de acreedores: una deuda saldada
   * deja de figurar.
   */
  deuda_al_cierre: string;
  /** Cuántos PROVEEDORES quedan con saldo a favor suyo (no cuántos gastos). */
  acreedores_al_cierre: string;
  /** Los que el estudio YA baja de ARCA. */
  arca_total: string;
  arca_cantidad: string;
  /** IVA computable: sale sólo de los de arriba. */
  arca_credito: string;
  /** Los que el comercio tiene que MANDAR. Es lo que va en el export. */
  fuera_total: string;
  fuera_cantidad: string;
}

/**
 * Totales del período en UNA consulta.
 *
 * Existe para que la pantalla NO sume plata en el navegador. Sumar los totales
 * por categoría con `+=` sobre strings arrastra el error de punto flotante y
 * además pasa desapercibido: con importes redondos da bien, y el número roto
 * recién aparece con centavos de verdad (CLAUDE.md §9.8 — ya pasó una vez con
 * el KPI "Por cobrar" de Clientes).
 */
export async function getExpenseSummary(
  desde: string,
  hasta: string,
  /**
   * Día de corte de la deuda (INCLUSIVO). La pantalla lo saca de
   * `fechaDeLaFoto`, que devuelve el último día del período **acotado a hoy**:
   * en el mes en curso, "lo que se debe hoy" y no una etiqueta con fecha
   * futura. Viaja como parámetro para que la tarjeta y este KPI no puedan
   * mostrar dos días distintos — ya pasó, y eran dos números correctos
   * contradiciéndose.
   *
   * El default mantiene el comportamiento viejo para quien no lo pase.
   */
  alCierre?: string
): Promise<ResumenGastos> {
  const corte = alCierre ?? ultimoDiaDe(hasta);
  const { tenantId } = ctx();
  const [fila] = await db.execute<ResumenGastos>(
    // `total` = plata que salió, y eso son DOS cosas: el gasto que se pagó de
    // una, MÁS lo que se le pagó a un proveedor este mes por una compra que
    // pudo ser de cualquier mes (decisión del owner 2026-09-17).
    //
    // El primer intento sólo tenía la resta —excluir lo comprado a crédito— y
    // nunca lo volvía a sumar al pagarse: el gasto desaparecía de todos los
    // meses. Test: "lo que se paga en agosto de una compra de julio".
    //
    // `deuda_al_cierre` es una FOTO al cierre del rango, sacada del LIBRO, no
    // "los gastos que nacieron a crédito": `medio_pago` no cambia cuando se
    // paga, así que esa cuenta seguía informando una deuda ya saldada.
    //
    // OJO con `arca_credito`: el IVA de una compra a crédito se computa por
    // DEVENGADO —la fecha de la factura, esté paga o no— así que sigue entrando
    // entero. Eso NO es una decisión nuestra: es criterio del estudio, y está
    // preguntado como A-29. Si la contadora dice lo contrario, se cambia acá.
    sql`SELECT (coalesce(sum(total) FILTER (WHERE ${GASTO_PAGADO_SQL}), 0)
                + ${pagosAProveedoresSql(tenantId, desde, hasta)})::text       AS total,
               count(*) FILTER (WHERE ${GASTO_PAGADO_SQL})::text                AS cantidad,
               ${deudaAProveedoresSql(tenantId, corte)}::text                   AS deuda_al_cierre,
               ${cantidadAcreedoresSql(tenantId, corte)}::text                  AS acreedores_al_cierre,
               coalesce(sum(total) FILTER (WHERE en_iva_compras), 0)::text AS arca_total,
               count(*)   FILTER (WHERE en_iva_compras)::text              AS arca_cantidad,
               coalesce(sum(iva)   FILTER (WHERE en_iva_compras), 0)::text AS arca_credito,
               coalesce(sum(total) FILTER (WHERE NOT en_iva_compras), 0)::text AS fuera_total,
               count(*)   FILTER (WHERE NOT en_iva_compras)::text          AS fuera_cantidad
        FROM expenses
        WHERE tenant_id = ${tenantId}
          AND fecha >= ${desde}::date AND fecha < ${hasta}::date
          AND ${GASTO_VIGENTE_SQL}`
  );
  const cero: ResumenGastos = {
    total: '0',
    cantidad: '0',
    deuda_al_cierre: '0',
    acreedores_al_cierre: '0',
    arca_total: '0',
    arca_cantidad: '0',
    arca_credito: '0',
    fuera_total: '0',
    fuera_cantidad: '0',
  };
  return fila ?? cero;
}

/**
 * CSV de gastos para el estudio.
 *
 * El caso que motiva todo esto es el de los que NO entran al IVA compras
 * (`soloFueraDeArca`): los otros el estudio ya los baja de ARCA, y mandarlos
 * de nuevo le hace revisar dos veces lo mismo.
 *
 * Lleva el CUIT del proveedor: la contadora lo pide explícitamente en el
 * detalle, y es la columna más fácil de dejar afuera.
 */
export function armarCsvGastos(gastos: Expense[]): string {
  return csvArmar(
    [
      'Fecha',
      'Categoría',
      'Proveedor',
      'CUIT',
      'Comprobante',
      'Neto',
      'IVA',
      'Total',
      'Medio de pago',
      'En IVA compras',
      'Detalle',
    ],
    gastos.map((g) => [
      g.fecha,
      csvTxt(g.categoria),
      csvTxt(g.payee_name ?? ''),
      csvTxt(g.payee_doc ?? ''),
      csvTxt(
        [g.comprobante_tipo, g.comprobante_numero].filter(Boolean).join(' ')
      ),
      csvNum(g.neto),
      csvNum(g.iva),
      csvNum(g.total),
      csvTxt(g.medio_pago),
      g.en_iva_compras ? 'Sí' : 'No',
      csvTxt(g.descripcion ?? ''),
    ])
  );
}

export interface ProveedorDelPeriodo {
  [k: string]: string;
  /** Razón social. Si difiere entre gastos del mismo proveedor, van las dos. */
  nombre: string;
  /** CUIT. Vacío si no se cargó; si hay más de uno, van todos separados por " / ". */
  cuit: string;
  /** Cuántos CUIT distintos se agruparon. > 1 = hay algo para revisar. */
  cuits: string;
  comprobantes: string;
  total: string;
}

/**
 * Proveedores del período: razón social, CUIT e importe.
 *
 * ── ES MEDIO ITEM DE LA CARTA, NO EL ITEM ENTERO ──────────────────────────
 * La contadora pide "detalle de proveedores **y/o acreedores** a la fecha de
 * cierre". Son dos cosas:
 *   - PROVEEDORES: a quién se le pagó. Es esto.
 *   - ACREEDORES al cierre: lo que se DEBE y todavía no se pagó. Eso Pandora
 *     no lo sabe: todo gasto nace pagado (tiene `medio_pago`), y la cuenta
 *     corriente de proveedores está diferida.
 *
 * Por eso el CSV lo dice adentro (ver `armarCsvProveedores`). Un archivo que la
 * contadora lea como "no hay saldos pendientes" cuando Pandora simplemente no
 * puede saberlo es peor que no mandarle nada.
 *
 * ── COMO SE AGRUPA ────────────────────────────────────────────────────────
 * Por `tercero_id` si el gasto lo tiene, y si no por el nombre normalizado: el
 * mismo proveedor puede estar una vez elegido del catálogo y otra escrito a
 * mano. Agrupar sólo por nombre juntaría dos proveedores distintos que se
 * llaman parecido.
 *
 * Cuando el grupo trae más de un CUIT (un tipeo, o la ficha del catálogo más
 * una entrada suelta), se muestran TODOS en vez de elegir uno: un CUIT
 * equivocado al lado del nombre correcto es exactamente lo que nadie revisa.
 *
 * Los gastos sin proveedor cargado NO se descartan: van juntos en una fila
 * "(sin proveedor indicado)". Si se cayeran, la suma del listado daría menos
 * que el total del período y nadie sabría por qué.
 *
 * Cubre TODO el período, con factura o sin ella: el ítem 9 no es sobre IVA
 * compras (a diferencia de `getExpenseTotals`, que sí ofrece ese recorte).
 */
export async function getProveedoresDelPeriodo(
  desde: string,
  hasta: string
): Promise<ProveedorDelPeriodo[]> {
  const { tenantId } = ctx();
  return db.execute<ProveedorDelPeriodo>(
    sql`SELECT coalesce(string_agg(DISTINCT payee_name, ' / '), '(sin proveedor indicado)') AS nombre,
               coalesce(string_agg(DISTINCT payee_doc, ' / '), '')                          AS cuit,
               count(DISTINCT payee_doc)::text                                              AS cuits,
               count(*)::text                                                               AS comprobantes,
               sum(total)::text                                                             AS total
        FROM expenses
        WHERE tenant_id = ${tenantId}
          AND fecha >= ${desde}::date AND fecha < ${hasta}::date
          AND ${GASTO_VIGENTE_SQL}
        GROUP BY coalesce(tercero_id::text, lower(trim(payee_name)))
        ORDER BY sum(total) DESC`
  );
}

/**
 * CSV de proveedores para el ítem 9 de la carta.
 *
 * Lleva una nota AL FINAL DEL ARCHIVO, no sólo en la pantalla: la pantalla la
 * lee una vez quien exporta; el archivo es el que llega al estudio, se guarda y
 * se abre tres semanas después. La advertencia tiene que sobrevivir ahí.
 */
export function armarCsvProveedores(
  filas: ProveedorDelPeriodo[],
  periodoEtiqueta: string
): string {
  const tabla = csvArmar(
    ['Proveedor', 'CUIT', 'Comprobantes', 'Total pagado'],
    filas.map((p) => [
      csvTxt(p.nombre),
      csvTxt(Number(p.cuits) > 1 ? `${p.cuit} (revisar: ${p.cuits} CUIT)` : p.cuit),
      p.comprobantes,
      csvNum(p.total),
    ])
  );

  // OJO: esta nota decía "en este sistema todo gasto se registra ya pagado".
  // Dejó de ser cierto con la migration 0039 (ADR-0028), y un archivo que
  // afirma eso le está diciendo al estudio que no hace falta pedir la lista de
  // acreedores — justo cuando esa lista existe y sale al lado.
  const nota =
    `Gastos PAGADOS en el período (${periodoEtiqueta}). ` +
    'NO incluye lo que se les debe: para eso está el archivo de acreedores al ' +
    'cierre, que sale del mismo menú.';
  return `${tabla}\r\n${csvTxt(nota)}\r\n`;
}

/**
 * IVA crédito fiscal del período: sólo de los gastos que están en el IVA
 * compras.
 *
 * Un gasto sin comprobante fiscal NO da crédito, por más IVA que tenga adentro
 * el precio. Computarlo seria declarar un crédito que no existe.
 */
export async function getIvaCredito(
  desde: string,
  hasta: string
): Promise<{ credito: string; comprobantes: number }> {
  const { tenantId } = ctx();
  const [fila] = await db.execute<{ credito: string; comprobantes: number }>(
    sql`SELECT coalesce(sum(iva), 0)::text AS credito,
               count(*)::int               AS comprobantes
        FROM expenses
        WHERE tenant_id = ${tenantId}
          AND en_iva_compras = true
          AND fecha >= ${desde}::date AND fecha < ${hasta}::date
          AND ${GASTO_VIGENTE_SQL}`
  );
  return {
    credito: fila?.credito ?? '0',
    comprobantes: fila?.comprobantes ?? 0,
  };
}
