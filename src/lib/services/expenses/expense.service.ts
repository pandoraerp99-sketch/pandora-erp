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
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  type Expense,
  type ExpenseCategory,
  type ExpensePaymentMethod,
} from '../../db/schema/expenses.js';
import { terceros } from '../../db/schema/terceros.js';
import { cash_movements } from '../../db/schema/cash_movements.js';
import { cash_sessions } from '../../db/schema/cash_sessions.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { logger } from '../../observability/logger.js';

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

    logger.info(
      {
        expense_id: fila.id,
        categoria: fila.categoria,
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
        lt(expenses.fecha, hasta)
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
          ${soloFueraDeArca ? sql`AND en_iva_compras = false` : sql``}
        GROUP BY categoria
        ORDER BY 2 DESC`
  );
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
          AND fecha >= ${desde}::date AND fecha < ${hasta}::date`
  );
  return {
    credito: fila?.credito ?? '0',
    comprobantes: fila?.comprobantes ?? 0,
  };
}
