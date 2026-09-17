/**
 * Cuenta corriente de PROVEEDORES — ítem 9 del pedido de la contadora.
 *
 * Espejo de `customers/account.service.ts`: allá el cliente nos debe, acá le
 * debemos al proveedor. Mismas cuatro operaciones, misma forma, porque es el
 * mismo problema visto del otro lado del mostrador.
 *
 *   registerChargeFromExpense — la compra a crédito genera la deuda
 *   settleSupplier            — le pagamos (efectivo => sale de la caja)
 *   adjustSupplier            — corrección con motivo obligatorio
 *   getSupplierBalance        — saldo CALCULADO, nunca guardado
 *
 * Todo con Decimal: es plata (CLAUDE.md §9.8).
 */
import { and, eq, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '../../db/client.js';
import {
  supplier_account_movements,
  CARGO_VIGENTE_SQL,
  SALDO_PROVEEDOR_SQL,
  type SupplierAccountMovement,
  type SupplierPaymentMethod,
} from '../../db/schema/supplier_account.js';
import { cash_movements } from '../../db/schema/cash_movements.js';
import { cash_sessions } from '../../db/schema/cash_sessions.js';
import { requireTracingContext } from '../../tracing/context.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { logger } from '../../observability/logger.js';

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function ctx() {
  const c = requireTracingContext();
  if (!c.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'supplier-account.service (sin tenant en el context)'
    );
  }
  return { tenantId: c.tenant_id, userId: c.actor_user_id };
}

export class SupplierAccountError extends DomainError {
  constructor(code: string, messageEs: string, status = 422) {
    super(code, messageEs, status);
  }
}

/**
 * Lo que le debemos a un proveedor. **Calculado**, no guardado.
 *   saldo = charges − payments + ajustes(con signo)
 * Positivo = le DEBEMOS. Cero o negativo = al día / le pagamos de más.
 *
 * `hasta` corta por la fecha DEL HECHO, no por la de carga: es lo que permite
 * responder "cuánto se debía al 31/07" sin que importe cuándo se cargó.
 */
export async function getSupplierBalance(
  terceroId: string,
  hasta?: string,
  txOrDb: DbOrTx = db
): Promise<Decimal> {
  const { tenantId } = ctx();
  const filas = await txOrDb.execute<{ saldo: string }>(
    sql`SELECT COALESCE(${SALDO_PROVEEDOR_SQL}, 0)::text AS saldo
        FROM supplier_account_movements
        WHERE tenant_id = ${tenantId}
          AND tercero_id = ${terceroId}
          AND ${CARGO_VIGENTE_SQL}
          ${hasta === undefined ? sql`` : sql`AND fecha <= ${hasta}::date`}`
  );
  return new Decimal(filas[0]?.saldo ?? '0');
}

/** Saldos de todos los proveedores de una, para la lista (evita N+1). */
export async function getBalancesBySupplier(
  hasta?: string
): Promise<Map<string, Decimal>> {
  const { tenantId } = ctx();
  const filas = await db.execute<{ tercero_id: string; saldo: string }>(
    sql`SELECT tercero_id::text,
               ${SALDO_PROVEEDOR_SQL}::text AS saldo
        FROM supplier_account_movements
        WHERE tenant_id = ${tenantId}
          AND ${CARGO_VIGENTE_SQL}
          ${hasta === undefined ? sql`` : sql`AND fecha <= ${hasta}::date`}
        GROUP BY tercero_id`
  );
  return new Map(filas.map((f) => [f.tercero_id, new Decimal(f.saldo)]));
}

/**
 * La compra a crédito genera la deuda.
 *
 * Se llama DENTRO de la transacción que registra el gasto: si el gasto queda
 * pero la deuda no, el proveedor desaparece del listado de acreedores y nadie
 * se entera hasta que reclama.
 *
 * La `fecha` es la DEL GASTO, no la de hoy — los gastos se cargan atrasados
 * todo el tiempo, y el corte al cierre depende de esta fecha.
 */
export async function registerChargeFromExpense(
  input: {
    tercero_id: string;
    expense_id: string;
    amount: string;
    fecha: string;
  },
  tx: DbOrTx
): Promise<SupplierAccountMovement> {
  const { tenantId, userId } = ctx();
  const monto = new Decimal(input.amount);
  if (!monto.isFinite() || monto.lte(0)) {
    throw new SupplierAccountError(
      'invalid_amount',
      'El importe de la deuda tiene que ser mayor a cero'
    );
  }

  const [fila] = await tx
    .insert(supplier_account_movements)
    .values({
      tenant_id: tenantId,
      tercero_id: input.tercero_id,
      type: 'charge',
      amount: monto.toFixed(4),
      fecha: input.fecha,
      expense_id: input.expense_id,
      created_by: userId,
    })
    .returning();

  if (!fila) throw new Error('Insert de cargo a proveedor no devolvio fila');
  return fila;
}

export interface SettleSupplierInput {
  tercero_id: string;
  amount: string;
  method: SupplierPaymentMethod;
  /** Fecha del pago. Por defecto hoy, pero se paga atrasado igual que se carga. */
  fecha: string;
  /** Obligatorio si method='efectivo': es plata que sale del cajón. */
  cash_session_id?: string;
}

/**
 * Le pagamos al proveedor (total o parcialmente).
 *
 * **El efectivo SALE de la caja.** Genera además un `cash_movements` de tipo
 * `provider_payment` ligado a la sesión abierta — tipo que ya existía y que el
 * cierre ya RESTA del efectivo esperado. Los otros medios no tocan la caja.
 *
 * Se permite pagar de más (queda saldo a favor: una seña, un anticipo) pero
 * NO pagar sobre una cuenta en cero, que casi siempre es un error de tipeo.
 */
export async function settleSupplier(
  input: SettleSupplierInput
): Promise<SupplierAccountMovement> {
  const { tenantId, userId } = ctx();
  const monto = new Decimal(input.amount);

  if (!monto.isFinite() || monto.lte(0)) {
    throw new SupplierAccountError(
      'invalid_amount',
      'El importe tiene que ser mayor a cero'
    );
  }
  if (input.method === 'efectivo' && input.cash_session_id === undefined) {
    throw new SupplierAccountError(
      'cash_needs_session',
      'Un pago en efectivo necesita una caja abierta: es plata que sale del cajón'
    );
  }

  return db.transaction(async (tx) => {
    const saldo = await getSupplierBalance(input.tercero_id, undefined, tx);
    if (saldo.lte(0)) {
      throw new SupplierAccountError(
        'no_debt',
        'A este proveedor no se le debe nada: no hay nada que pagar'
      );
    }

    let cashMovementId: bigint | null = null;

    if (input.method === 'efectivo') {
      if (!userId) {
        throw new SupplierAccountError(
          'no_actor',
          'Un pago en efectivo necesita un usuario identificado'
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
      if (!sesion) {
        throw new SupplierAccountError('session_not_found', 'No existe esa caja');
      }
      if (sesion.closed_at !== null) {
        throw new SupplierAccountError(
          'session_closed',
          'La caja ya está cerrada: no se puede registrar plata en una caja cerrada'
        );
      }

      const [mov] = await tx
        .insert(cash_movements)
        .values({
          cash_session_id: input.cash_session_id!,
          type: 'provider_payment',
          amount: monto.toFixed(4),
          reason: 'Pago de cuenta corriente de proveedor',
          created_by: userId,
        })
        .returning({ id: cash_movements.id });
      cashMovementId = mov?.id ?? null;
    }

    const [fila] = await tx
      .insert(supplier_account_movements)
      .values({
        tenant_id: tenantId,
        tercero_id: input.tercero_id,
        type: 'payment',
        amount: monto.toFixed(4),
        fecha: input.fecha,
        payment_method: input.method,
        cash_movement_id: cashMovementId,
        created_by: userId,
      })
      .returning();

    if (!fila) throw new Error('Insert de pago a proveedor no devolvio fila');

    await writeAuditLog(
      {
        event_name: 'supplier.account.settled',
        payload: {
          movement_id: fila.id,
          tercero_id: input.tercero_id,
          amount: monto.toFixed(4),
          method: input.method,
          fecha: input.fecha,
          saldo_antes: saldo.toFixed(4),
          cash_session_id: input.method === 'efectivo' ? input.cash_session_id! : null,
          cash_movement_id: cashMovementId === null ? null : String(cashMovementId),
        },
        pii_level: 'internal',
        severity: 'info',
      },
      tx
    );

    logger.info(
      {
        tercero_id: input.tercero_id,
        amount: monto.toFixed(4),
        method: input.method,
        cash_movement_id: cashMovementId,
      },
      'supplier.account.settled'
    );

    return fila;
  });
}

/**
 * Ajuste con motivo OBLIGATORIO. **Siempre SUMA a lo que debemos.**
 *
 * Sirve para lo que aparece de verdad: un interés por pagar tarde, un flete
 * que el proveedor facturó aparte, una diferencia a favor del proveedor.
 *
 * **Una nota de crédito del proveedor NO se registra por acá.** Es el espejo
 * de la NC, que es F1+, y tiene tratamiento fiscal propio. Cuando exista, va
 * con su operación y su comprobante, no colgada de un ajuste genérico.
 */
export async function adjustSupplier(input: {
  tercero_id: string;
  amount: string;
  fecha: string;
  reason: string;
}): Promise<SupplierAccountMovement> {
  const { tenantId, userId } = ctx();
  const monto = new Decimal(input.amount);
  if (!monto.isFinite() || monto.lte(0)) {
    throw new SupplierAccountError(
      'invalid_amount',
      'El importe tiene que ser mayor a cero'
    );
  }
  const motivo = input.reason.trim();
  if (motivo.length < 3) {
    throw new SupplierAccountError(
      'reason_required',
      'Un ajuste sin motivo no se puede auditar: escribí por qué'
    );
  }

  return db.transaction(async (tx) => {
    const saldo = await getSupplierBalance(input.tercero_id, undefined, tx);

    const [fila] = await tx
      .insert(supplier_account_movements)
      .values({
        tenant_id: tenantId,
        tercero_id: input.tercero_id,
        type: 'adjustment',
        amount: monto.toFixed(4),
        fecha: input.fecha,
        reason: motivo,
        created_by: userId,
      })
      .returning();

    if (!fila) throw new Error('Insert de ajuste a proveedor no devolvio fila');

    await writeAuditLog(
      {
        event_name: 'supplier.account.adjusted',
        payload: {
          movement_id: fila.id,
          tercero_id: input.tercero_id,
          amount: monto.toFixed(4),
          fecha: input.fecha,
          reason: motivo,
          saldo_antes: saldo.toFixed(4),
        },
        pii_level: 'internal',
        severity: 'info',
      },
      tx
    );

    return fila;
  });
}

/**
 * Si se anulara este gasto, ¿quedaría plata pagada sin deuda que la respalde?
 *
 * Se usa para BLOQUEAR la anulación o corrección de un gasto a cuenta corriente
 * (fail-closed, decisión del owner 2026-09-17). La alternativa —dejar anular y
 * arrastrar los pagos— deja movimientos apuntando a un comprobante que dejó de
 * estar vigente, y el saldo pasa a depender de caminar la cadena de
 * `corrects_id`. Primero se deshace el pago, con su motivo, y después se anula.
 *
 * ── POR QUÉ ESTA PREGUNTA Y NO "¿TIENE PAGOS?" ────────────────────────────
 * Los pagos NO se atan a una factura: se le paga AL PROVEEDOR. La primera
 * versión preguntaba si ese proveedor había tenido CUALQUIER pago o ajuste
 * después de que naciera este cargo — y eso bloquea de más, justo en el caso
 * que más importa: cargaste dos veces la misma factura, le pagaste otra, y ya
 * no podés borrar el duplicado nunca más. Es el mismo agujero que ya apareció
 * una vez con los gastos ("un gasto de más no se podía deshacer por ningún
 * camino"), y el mensaje encima daba un remedio equivocado: revertir un pago
 * que era de OTRA factura.
 *
 * La pregunta correcta no necesita imputar pagos a comprobantes: alcanza con
 * mirar el saldo. Si al sacar este cargo el proveedor queda en negativo, esa
 * plata pagada no tiene contra qué ir. Si queda en cero o positivo, los pagos
 * los absorben las otras facturas y anular es seguro.
 *
 * ⚠️ Caso declarado: si el proveedor YA tenía saldo a favor nuestro (una seña
 * previa), anular vuelve a dejarlo en negativo y esto bloquea, aunque ese
 * anticipo sea anterior y legítimo. Se deja fail-closed a propósito — en ese
 * caso el camino es registrar el ajuste, que queda auditado.
 */
export async function anularDejariaPagosSinRespaldo(
  expenseId: string,
  txOrDb: DbOrTx = db
): Promise<boolean> {
  const { tenantId } = ctx();
  const filas = await txOrDb.execute<{ queda_negativo: boolean }>(
    // El cargo de ESTE gasto se excluye de la suma: eso es exactamente "el
    // saldo como quedaría si lo anulamos".
    sql`SELECT coalesce(
          (SELECT ${SALDO_PROVEEDOR_SQL}
             FROM supplier_account_movements
            WHERE supplier_account_movements.tenant_id = ${tenantId}
              AND supplier_account_movements.tercero_id = (
                SELECT c.tercero_id
                  FROM supplier_account_movements c
                 WHERE c.tenant_id = ${tenantId}
                   AND c.expense_id = ${expenseId}
                   AND c.type = 'charge'
                 LIMIT 1
              )
              AND (
                supplier_account_movements.expense_id IS DISTINCT FROM ${expenseId}::uuid
                OR supplier_account_movements.type <> 'charge'
              )
              AND ${CARGO_VIGENTE_SQL}
          ) < 0, false) AS queda_negativo`
  );
  return filas[0]?.queda_negativo ?? false;
}

/** Movimientos de un proveedor, del más nuevo al más viejo. */
export async function listSupplierMovements(
  terceroId: string
): Promise<SupplierAccountMovement[]> {
  const { tenantId } = ctx();
  return db
    .select()
    .from(supplier_account_movements)
    .where(
      and(
        eq(supplier_account_movements.tenant_id, tenantId),
        eq(supplier_account_movements.tercero_id, terceroId)
      )
    )
    .orderBy(sql`fecha DESC, created_at DESC`);
}
