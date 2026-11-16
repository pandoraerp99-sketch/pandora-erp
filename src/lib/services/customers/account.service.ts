/**
 * Cuenta corriente de clientes — ADR-0027.
 *
 * Tres operaciones y una consulta:
 *   registerChargeFromSale  — la venta a cuenta genera la deuda
 *   settleAccount           — el cliente paga (efectivo => entra a la caja)
 *   adjustAccount           — correccion con motivo obligatorio
 *   getAccountBalance       — saldo CALCULADO, nunca guardado
 *
 * Todo con Decimal: es plata (CLAUDE.md 9.8, prohibido Number en ese camino).
 */
import { and, eq, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '../../db/client.js';
import {
  customer_account_movements,
  type CustomerAccountMovement,
} from '../../db/schema/customer_account.js';
import { customers } from '../../db/schema/customers.js';
import { cash_movements } from '../../db/schema/cash_movements.js';
import { cash_sessions } from '../../db/schema/cash_sessions.js';
import { requireTracingContext } from '../../tracing/context.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { logger } from '../../observability/logger.js';
import { exigirQueOpereElComercio } from '../../auth/autorizacion.js';

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function ctx() {
  const c = requireTracingContext();
  if (!c.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'account.service (sin tenant en el context)'
    );
  }
  return { tenantId: c.tenant_id, userId: c.actor_user_id };
}

export class AccountError extends DomainError {
  constructor(code: string, messageEs: string, status = 422) {
    super(code, messageEs, status);
  }
}

/** Medios con los que un cliente puede cancelar su cuenta. */
export const SETTLEMENT_METHODS = [
  'efectivo',
  'debito',
  'credito',
  'transferencia',
] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

/**
 * Saldo del cliente. **Calculado**, no guardado.
 *   saldo = charges - payments + ajustes(con signo)
 * Positivo = el cliente DEBE. Cero o negativo = esta al dia / a favor.
 */
export async function getAccountBalance(
  customerId: string,
  txOrDb: DbOrTx = db
): Promise<Decimal> {
  const { tenantId } = ctx();
  const filas = await txOrDb.execute<{ saldo: string }>(
    sql`SELECT COALESCE(SUM(
          CASE
            WHEN type = 'charge' THEN amount
            WHEN type = 'payment' THEN -amount
            ELSE amount
          END
        ), 0)::text AS saldo
        FROM customer_account_movements
        WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}`
  );
  return new Decimal(filas[0]?.saldo ?? '0');
}

/** Saldos de varios clientes de una, para la lista (evita N+1). */
export async function getBalancesByCustomer(): Promise<Map<string, Decimal>> {
  const { tenantId } = ctx();
  const filas = await db.execute<{ customer_id: string; saldo: string }>(
    sql`SELECT customer_id::text,
               SUM(CASE
                     WHEN type = 'charge' THEN amount
                     WHEN type = 'payment' THEN -amount
                     ELSE amount
                   END)::text AS saldo
        FROM customer_account_movements
        WHERE tenant_id = ${tenantId}
        GROUP BY customer_id`
  );
  return new Map(filas.map((f) => [f.customer_id, new Decimal(f.saldo)]));
}

export interface DeudaConEdad {
  saldo: Decimal;
  /** Días desde el cargo más viejo que TODAVÍA no está pagado. null si no debe. */
  dias: number | null;
}

/**
 * Saldo + **antigüedad** de la deuda, por cliente.
 *
 * La antigüedad no es "días desde el último movimiento": es la del cargo más
 * viejo que sigue sin cubrir. Se imputan los pagos a los cargos **del más
 * viejo al más nuevo** (FIFO), que es como lo piensa el comerciante — "me
 * paga y le voy bajando lo de antes" — y como se lleva una cuenta corriente.
 *
 * Sin FIFO el número mentiría en el caso que más importa: alguien que debe de
 * hace medio año y hace un pago chico hoy aparecería como deuda "de hoy", que
 * es justo el cliente al que hay que ir a ver.
 *
 * Los ajustes cuentan como cargo, con su propia fecha.
 *
 * Trae el libro entero del comercio y calcula en TS. Es correcto para el
 * volumen de F0 (un comercio de barrio no tiene cientos de miles de
 * movimientos); si algún día pesa, se pasa a una window function en SQL.
 */
export async function getDebtorsWithAge(): Promise<Map<string, DeudaConEdad>> {
  const { tenantId } = ctx();
  const filas = await db.execute<{
    customer_id: string;
    type: string;
    amount: string;
    created_at: string;
  }>(
    sql`SELECT customer_id::text, type, amount::text, created_at::text
        FROM customer_account_movements
        WHERE tenant_id = ${tenantId}
        ORDER BY customer_id, created_at ASC`
  );

  const porCliente = new Map<
    string,
    { cargos: { monto: Decimal; fecha: string }[]; pagos: Decimal }
  >();

  for (const f of filas) {
    let acc = porCliente.get(f.customer_id);
    if (!acc) {
      acc = { cargos: [], pagos: new Decimal(0) };
      porCliente.set(f.customer_id, acc);
    }
    const monto = new Decimal(f.amount);
    if (f.type === 'payment') acc.pagos = acc.pagos.plus(monto);
    else acc.cargos.push({ monto, fecha: f.created_at });
  }

  const ahora = Date.now();
  const salida = new Map<string, DeudaConEdad>();

  for (const [customerId, { cargos, pagos }] of porCliente) {
    const totalCargos = cargos.reduce((a, c) => a.plus(c.monto), new Decimal(0));
    const saldo = totalCargos.minus(pagos);

    if (saldo.lte(0)) {
      salida.set(customerId, { saldo, dias: null });
      continue;
    }

    // Imputación FIFO: se va gastando el pago contra los cargos más viejos.
    let restante = pagos;
    let masViejoImpago: string | null = null;
    for (const cargo of cargos) {
      if (restante.gte(cargo.monto)) {
        restante = restante.minus(cargo.monto);
        continue;
      }
      masViejoImpago = cargo.fecha;
      break;
    }

    salida.set(customerId, {
      saldo,
      dias:
        masViejoImpago === null
          ? null
          : Math.max(
              0,
              Math.floor((ahora - new Date(masViejoImpago).getTime()) / 86400000)
            ),
    });
  }

  return salida;
}

/**
 * Cargo por una venta fiada. Lo llama `finalizeSale` cuando hay un pago con
 * method='cuenta_corriente'.
 *
 * Corre DENTRO de la transaccion de la venta: si la venta se cae, la deuda no
 * queda colgada.
 */
export async function registerChargeFromSale(
  input: { customer_id: string; sale_id: string; amount: string },
  tx: DbOrTx
): Promise<void> {
  const { tenantId, userId } = ctx();

  // El cliente tiene que ser de ESTE comercio. El filtro por tenant es la
  // defensa: uno ajeno simplemente no aparece.
  const [cliente] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenant_id, tenantId), eq(customers.id, input.customer_id)))
    .limit(1);
  if (!cliente) {
    throw new AccountError(
      'customer_not_found',
      'No se puede fiar a un cliente que no existe en este comercio'
    );
  }

  await tx.insert(customer_account_movements).values({
    tenant_id: tenantId,
    customer_id: input.customer_id,
    type: 'charge',
    amount: input.amount,
    sale_id: input.sale_id,
    created_by: userId,
  });

  logger.info(
    { customer_id: input.customer_id, sale_id: input.sale_id, amount: input.amount },
    'account.charge'
  );
}

export interface SettleInput {
  customer_id: string;
  amount: string;
  method: SettlementMethod;
  /** Obligatorio si method='efectivo': es plata que entra al cajon. */
  cash_session_id?: string;
}

/**
 * El cliente paga (total o parcialmente) su cuenta.
 *
 * **El efectivo entra a la caja.** Genera ADEMAS un `cash_movements` de tipo
 * `customer_payment` ligado a la sesion abierta, que el cierre suma. Los otros
 * medios NO tocan la caja: si todo cobro fuera al cajon, el arqueo contaria
 * plata que nunca entro.
 *
 * Se permite pagar de mas (queda saldo a favor) pero NO pagar sobre una cuenta
 * en cero: eso casi siempre es un error de tipeo, y el libro no deberia
 * ensuciarse con movimientos que nadie puede explicar despues.
 */
export async function settleAccount(
  input: SettleInput
): Promise<CustomerAccountMovement> {
  await exigirQueOpereElComercio();
  const { tenantId, userId } = ctx();
  const monto = new Decimal(input.amount);

  if (!monto.isFinite() || monto.lte(0)) {
    throw new AccountError('invalid_amount', 'El importe tiene que ser mayor a cero');
  }
  if (input.method === 'efectivo' && input.cash_session_id === undefined) {
    throw new AccountError(
      'cash_needs_session',
      'Un cobro en efectivo necesita una caja abierta: es plata que entra al cajón'
    );
  }

  return db.transaction(async (tx) => {
    const saldo = await getAccountBalance(input.customer_id, tx);
    if (saldo.lte(0)) {
      throw new AccountError(
        'no_debt',
        'Este cliente no tiene deuda: no hay nada que cobrar'
      );
    }

    let cashMovementId: bigint | null = null;

    if (input.method === 'efectivo') {
      // Un movimiento de caja SIEMPRE tiene autor: es plata, y el arqueo tiene
      // que poder decir quien la registro.
      if (!userId) {
        throw new AccountError(
          'no_actor',
          'Un cobro en efectivo necesita un usuario identificado'
        );
      }
      // La sesion tiene que existir, ser de este comercio y estar ABIERTA.
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
        throw new AccountError('session_not_found', 'No existe esa caja');
      }
      if (sesion.closed_at !== null) {
        throw new AccountError(
          'session_closed',
          'La caja ya está cerrada: no se puede registrar plata en una caja cerrada'
        );
      }

      const [mov] = await tx
        .insert(cash_movements)
        .values({
          cash_session_id: input.cash_session_id!,
          type: 'customer_payment',
          amount: monto.toFixed(4),
          reason: 'Cobro de cuenta corriente',
          created_by: userId,
        })
        .returning({ id: cash_movements.id });
      cashMovementId = mov?.id ?? null;
    }

    const [fila] = await tx
      .insert(customer_account_movements)
      .values({
        tenant_id: tenantId,
        customer_id: input.customer_id,
        type: 'payment',
        amount: monto.toFixed(4),
        payment_method: input.method,
        cash_movement_id: cashMovementId,
        created_by: userId,
      })
      .returning();

    if (!fila) throw new Error('Insert de cobro no devolvio fila');

    // EVENT-TAXONOMY v2.1.0. Un cobro en efectivo es plata que entra al cajón
    // FUERA de una venta: si el arqueo no cierra, este es el movimiento a
    // mirar. El `cash_movement_id` es lo que lo cruza con la caja.
    await writeAuditLog(
      {
        event_name: 'customer.account.settled',
        payload: {
          movement_id: fila.id,
          customer_id: input.customer_id,
          amount: monto.toFixed(4),
          method: input.method,
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
        customer_id: input.customer_id,
        amount: monto.toFixed(4),
        method: input.method,
        cash_movement_id: cashMovementId,
      },
      'account.settled'
    );

    return fila;
  });
}

/**
 * Ajuste con motivo OBLIGATORIO. **Siempre SUMA a la deuda.**
 *
 * En la base el importe es siempre positivo y el signo lo da el `type`; el
 * saldo trata `adjustment` como un cargo. Sirve para lo que aparece de verdad:
 * una diferencia a favor del comercio, un cargo que se olvido de anotar.
 *
 * **Condonar deuda NO se hace por aca.** Perdonarle el saldo a un cliente es
 * una decision con implicancias (es un gasto del comercio, y la contadora
 * tiene que decir como se registra). Cuando aparezca, va con su propia
 * operacion y su propio movimiento, no colgada de un ajuste generico.
 */
export async function adjustAccount(input: {
  customer_id: string;
  amount: string;
  reason: string;
}): Promise<CustomerAccountMovement> {
  await exigirQueOpereElComercio();
  const { tenantId, userId } = ctx();
  const monto = new Decimal(input.amount);
  if (!monto.isFinite() || monto.lte(0)) {
    throw new AccountError('invalid_amount', 'El importe tiene que ser mayor a cero');
  }
  if (input.reason.trim().length < 3) {
    throw new AccountError(
      'reason_required',
      'Un ajuste sin motivo no se puede auditar después'
    );
  }

  return db.transaction(async (tx) => {
    // El cliente tiene que ser de ESTE comercio. La FK `customer_id →
    // customers(id)` no ata el tenant: sin este chequeo, un id ajeno entraba
    // con el tenant de uno y el cliente del otro. Mismo filtro que
    // `registerChargeFromSale`.
    const [cliente] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenant_id, tenantId), eq(customers.id, input.customer_id)))
      .limit(1);
    if (!cliente) {
      throw new AccountError(
        'customer_not_found',
        'No existe ese cliente en este comercio'
      );
    }

    const saldoAntes = await getAccountBalance(input.customer_id, tx);

    const [fila] = await tx
      .insert(customer_account_movements)
      .values({
        tenant_id: tenantId,
        customer_id: input.customer_id,
        type: 'adjustment',
        amount: monto.toFixed(4),
        reason: input.reason.trim(),
        created_by: userId,
      })
      .returning();

    if (!fila) throw new Error('Insert de ajuste no devolvio fila');

    // EVENT-TAXONOMY v2.1.0 — warning: le suma deuda a un cliente A MANO. Es
    // lo que se discute cuando alguien dice "yo no debía eso"; el saldo previo
    // deja ver de dónde a dónde se lo llevó.
    await writeAuditLog(
      {
        event_name: 'customer.account.adjusted',
        payload: {
          movement_id: fila.id,
          customer_id: input.customer_id,
          amount: monto.toFixed(4),
          reason: fila.reason,
          saldo_antes: saldoAntes.toFixed(4),
        },
        pii_level: 'internal',
        severity: 'warning',
      },
      tx
    );

    return fila;
  });
}

/** Movimientos del cliente, del mas nuevo al mas viejo. */
export async function listAccountMovements(
  customerId: string,
  limit = 100
): Promise<CustomerAccountMovement[]> {
  const { tenantId } = ctx();
  return db
    .select()
    .from(customer_account_movements)
    .where(
      and(
        eq(customer_account_movements.tenant_id, tenantId),
        eq(customer_account_movements.customer_id, customerId)
      )
    )
    .orderBy(sql`created_at DESC`)
    .limit(Math.min(limit, 200));
}
