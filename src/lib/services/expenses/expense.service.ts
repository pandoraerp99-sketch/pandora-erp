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
  GASTO_VIGENTE,
  GASTO_VIGENTE_SQL,
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  type Expense,
  type ExpenseCategory,
  type ExpensePaymentMethod,
} from '../../db/schema/expenses.js';
import { expense_items } from '../../db/schema/expense_items.js';
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
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { logger } from '../../observability/logger.js';
import { csvArmar, csvNum, csvTxt } from '../reporting/csv.js';

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

  // ── Las líneas de mercadería ──
  const items = input.items ?? [];
  if (items.length > 0 && input.categoria !== 'mercaderia') {
    throw new ExpenseError(
      'items_solo_mercaderia',
      'Sólo un gasto de mercadería lleva detalle de productos'
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

    // ── La mercadería entra al stock, en la MISMA transacción ──
    //
    // Si el gasto se guardara y los movimientos no, el comercio tendría el
    // comprobante cargado y la mercadería invisible — que es exactamente el
    // agujero que este módulo vino a cerrar.
    for (const linea of items) {
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
        product_id: linea.product_id,
        qty: qty.toFixed(4),
        unit_cost: costo.toFixed(4),
        product_name_snapshot: producto.name,
      });

      try {
        await recordStockMovement(
          {
            product_id: linea.product_id,
            type: 'purchase',
            qty: qty.toFixed(4),
            related_expense_id: fila.id,
            // El catálogo de EVENT-TAXONOMY está cerrado y sólo cubre
            // `stock.adjusted_manually`: una compra no es un ajuste manual, así
            // que no emite audit propio. Mismo criterio que `finalizeSale`.
            skip_audit: true,
          },
          tx
        );
      } catch (e) {
        if (e instanceof ProductInactiveError) {
          throw new ExpenseError(
            'producto_inactivo',
            `${producto.name} está dado de baja: reactivalo antes de comprarlo`
          );
        }
        throw e;
      }

      // `products.cost` pasa a ser el costo de la ÚLTIMA compra.
      //
      // Sin esto, `cost` queda a mantenimiento manual y el margen se calcula
      // contra un número que nadie actualiza. Con esto, el bloque de
      // Rentabilidad está midiendo contra lo que realmente se pagó la última
      // vez — y `unit_cost_snapshot` congela ese valor en cada venta, así que
      // el margen histórico no se reescribe cuando el proveedor aumenta.
      await tx
        .update(products)
        .set({ cost: costo.toFixed(4), updated_at: new Date() })
        .where(and(eq(products.tenant_id, tenantId), eq(products.id, linea.product_id)));
    }

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
        await recordStockMovement(
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
            // No es un ajuste manual del comerciante: es la contracara de una
            // anulación. Auditarlo como `stock.adjusted_manually` haría que el
            // audit log mintiera sobre quién movió el stock y por qué.
            skip_audit: true,
          },
          tx
        );
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

      await tx.insert(cash_movements).values({
        cash_session_id: input.cash_session_id,
        type: 'deposit',
        amount: new Decimal(original.total).toFixed(4),
        // El deposit NO se linkea a la fila de anulación: `cash_movement_id` es
        // el 1:1 gasto→egreso, y un ingreso no es el pago de un gasto. El
        // vínculo queda acá, en texto, que es donde lo va a leer una persona.
        reason: `Anulación de gasto · ${original.payee_name ?? original.categoria}`,
        created_by: userId,
      });
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
  total: string;
  neto: string;
  iva: string;
  cantidad: string;
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
    sql`SELECT categoria,
               sum(total)::text AS total,
               sum(neto)::text  AS neto,
               sum(iva)::text   AS iva,
               count(*)::text   AS cantidad
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

export interface ResumenGastos {
  [k: string]: string;
  /** Todo el período. */
  total: string;
  cantidad: string;
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
  hasta: string
): Promise<ResumenGastos> {
  const { tenantId } = ctx();
  const [fila] = await db.execute<ResumenGastos>(
    sql`SELECT coalesce(sum(total), 0)::text AS total,
               count(*)::text                AS cantidad,
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

  const nota =
    `Gastos PAGADOS en el período (${periodoEtiqueta}). ` +
    'NO incluye saldos pendientes de pago: en este sistema todo gasto se ' +
    'registra ya pagado, así que esta lista no es el detalle de acreedores al ' +
    'cierre.';
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
