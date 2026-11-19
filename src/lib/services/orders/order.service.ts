/**
 * Pedidos (encargos) con seña — ADR-0029, migration 0043.
 *
 * Reglas que este service hace cumplir (y que la pantalla sólo refleja):
 *
 * 1. **Toda mutación arranca con `exigirQueOpereElComercio()`** (H-01).
 * 2. **Todo cobro entra por una caja ABIERTA** del punto de venta, sea el
 *    medio que sea. Si no hay caja abierta, el cobro no se registra y el alta
 *    con seña falla entera: un pedido "con seña" cuya seña no quedó en ningún
 *    lado es peor que un error claro.
 * 3. **No se cobra de más.** Saldo a favor del cliente no está modelado.
 * 4. **Editar no puede dejar el total por debajo de lo ya cobrado.**
 * 5. **Cancelar con cobros está bloqueado** hasta definir cómo sale la seña
 *    de la caja (ADR-0029 §Pendientes). Un "retiro" genérico haría el arqueo
 *    inexplicable, por la misma razón que dio el ADR-0027.
 * 6. **Entregar exige saldo cero.** "Cobrar saldo y entregar" hace las dos
 *    cosas en una transacción.
 * 7. **Entregar NO convierte el pedido en venta** (no descuenta stock ni
 *    emite comprobante). Es la tanda siguiente; ver ADR-0029.
 *
 * Concurrencia: cada mutación toma la fila del pedido FOR UPDATE antes de
 * leer lo cobrado, así dos cobros simultáneos no pueden pasar los dos el
 * chequeo de saldo. La caja se lee FOR SHARE: el cierre la toma FOR UPDATE,
 * así que un cobro no se cuela en una caja que se está cerrando.
 *
 * Doble click / reintento: alta, cobro y entrega van por `withIdempotency`
 * (reserve-first, releaseOnError porque todo es transaccional).
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { db } from '../../db/client.js';
import {
  orders,
  order_items,
  order_payments,
  ORDER_PAYMENT_METHODS,
  type OrderPaymentMethod,
  type OrderStatus,
} from '../../db/schema/orders.js';
import { customers } from '../../db/schema/customers.js';
import { products } from '../../db/schema/products.js';
import { cash_sessions } from '../../db/schema/cash_sessions.js';
import { requireTracingContext } from '../../tracing/context.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { exigirQueOpereElComercio } from '../../auth/autorizacion.js';
import { withIdempotency } from '../../idempotency/idempotency.js';
import { isValidUuid } from '../../tracing/ids.js';
import {
  estaVivo,
  puedePasar,
  tipoDeCobro,
  totalDeLinea,
  totalDelPedido,
} from '../../domain/pedidos.js';

/** F0: un único punto de venta, igual que /pos y /caja. */
export const SALE_POINT_PEDIDOS = 1;

const MAX_LINEAS = 50;
const MAX_DESCRIPCION = 200;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class OrderError extends DomainError {
  constructor(code: string, messageEs: string, status = 422) {
    super(code, messageEs, status);
  }
}

function ctx() {
  const c = requireTracingContext();
  if (!c.tenant_id) {
    throw new CrossTenantAccessError('desconocido', null, 'order.service (sin tenant)');
  }
  return { tenantId: c.tenant_id, userId: c.actor_user_id ?? null, correlationId: c.correlation_id };
}

/** "$5.000" o "$3.950,62", como la pantalla: el mensaje llega tal cual al usuario. */
const plata = (d: Decimal) => {
  const [ent, dec] = d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).abs().toFixed(2).split('.') as [string, string];
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${d.isNegative() ? '−' : ''}$${miles}${dec === '00' ? '' : ',' + dec}`;
};

// ── Entrada ─────────────────────────────────────────────────────────────────

export interface OrderLineInput {
  product_id?: string | null;
  description: string;
  quantity: string;
  unit_price: string;
}

export interface OrderInput {
  customer_id?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  /** 'AAAA-MM-DD' (día del comercio) o null. */
  pickup_date?: string | null;
  notes?: string | null;
  price_freezes: boolean;
  items: OrderLineInput[];
}

export interface PaymentInput {
  amount: string;
  method: OrderPaymentMethod;
}

interface LineaNormalizada {
  product_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  line_total: string;
}

function decimalPositivo(raw: string, campo: string, decimales: number, permitirCero = false): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(String(raw).trim());
  } catch {
    throw new OrderError('invalid_number', `${campo}: no es un número`);
  }
  if (!d.isFinite() || (permitirCero ? d.lt(0) : d.lte(0))) {
    throw new OrderError('invalid_number', `${campo} tiene que ser mayor a cero`);
  }
  if (d.decimalPlaces() > decimales) {
    throw new OrderError('invalid_number', `${campo}: como mucho ${decimales} decimales`);
  }
  if (d.gt('9999999999')) {
    throw new OrderError('invalid_number', `${campo}: el número es demasiado grande`);
  }
  return d;
}

function normalizarLineas(items: OrderLineInput[]): LineaNormalizada[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderError('no_items', 'El pedido necesita al menos un ítem');
  }
  if (items.length > MAX_LINEAS) {
    throw new OrderError('too_many_items', `Un pedido admite hasta ${MAX_LINEAS} ítems`);
  }
  return items.map((it, i) => {
    const n = i + 1;
    const description = (it.description ?? '').trim();
    if (description.length === 0) {
      throw new OrderError('item_sin_descripcion', `Ítem ${n}: decí qué se encarga`);
    }
    if (description.length > MAX_DESCRIPCION) {
      throw new OrderError('item_descripcion_larga', `Ítem ${n}: la descripción es muy larga`);
    }
    const product_id = it.product_id ? String(it.product_id) : null;
    if (product_id !== null && !isValidUuid(product_id)) {
      throw new OrderError('invalid_product', `Ítem ${n}: el producto no es válido`);
    }
    const quantity = decimalPositivo(it.quantity, `Ítem ${n}, cantidad`, 3);
    const unit_price = decimalPositivo(it.unit_price, `Ítem ${n}, precio`, 2, true);
    const line_total = totalDeLinea({
      quantity: quantity.toString(),
      unit_price: unit_price.toString(),
    });
    return {
      product_id,
      description,
      quantity: quantity.toFixed(4),
      unit_price: unit_price.toFixed(4),
      line_total: line_total.toFixed(4),
    };
  });
}

function normalizarEncabezado(input: OrderInput) {
  const customer_id = input.customer_id ? String(input.customer_id) : null;
  if (customer_id !== null && !isValidUuid(customer_id)) {
    throw new OrderError('invalid_customer', 'El cliente no es válido');
  }
  const pickup = input.pickup_date ? String(input.pickup_date) : null;
  if (pickup !== null && !/^\d{4}-\d{2}-\d{2}$/.test(pickup)) {
    throw new OrderError('invalid_date', 'La fecha de retiro no es válida');
  }
  const notes = (input.notes ?? '').trim();
  const phone = (input.customer_phone ?? '').trim();
  return {
    customer_id,
    customer_name: (input.customer_name ?? '').trim(),
    customer_phone: phone.length > 0 ? phone.slice(0, 40) : null,
    pickup_date: pickup,
    notes: notes.length > 0 ? notes.slice(0, 1000) : null,
    price_freezes: input.price_freezes === true,
  };
}

function validarMedio(method: string): OrderPaymentMethod {
  if (!(ORDER_PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new OrderError('invalid_method', 'Ese medio de pago no está disponible para pedidos');
  }
  return method as OrderPaymentMethod;
}

function hashDe(op: string, payload: unknown): string {
  return createHash('sha256').update(op + JSON.stringify(payload), 'utf8').digest('hex');
}

function exigirKey(key: string) {
  if (!isValidUuid(key)) {
    throw new OrderError('invalid_idempotency_key', 'Falta la clave de la operación');
  }
}

// ── Piezas dentro de la transacción ─────────────────────────────────────────

/** El cliente del libro tiene que ser de este comercio; completa el snapshot. */
async function resolverCliente(
  tx: Tx,
  tenantId: string,
  enc: ReturnType<typeof normalizarEncabezado>
) {
  if (enc.customer_id === null) {
    if (enc.customer_name.length === 0) {
      throw new OrderError('sin_cliente', 'Decí a nombre de quién es el pedido');
    }
    return enc;
  }
  const [c] = await tx
    .select({ name: customers.name, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.tenant_id, tenantId), eq(customers.id, enc.customer_id)))
    .limit(1);
  if (!c) throw new OrderError('customer_not_found', 'Ese cliente no existe');
  return {
    ...enc,
    customer_name: enc.customer_name.length > 0 ? enc.customer_name : c.name,
    customer_phone: enc.customer_phone ?? c.phone ?? null,
  };
}

/** Los productos referidos tienen que ser de este comercio. */
async function verificarProductos(tx: Tx, tenantId: string, lineas: LineaNormalizada[]) {
  const ids = [...new Set(lineas.map((l) => l.product_id).filter((x): x is string => x !== null))];
  if (ids.length === 0) return;
  const encontrados = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenant_id, tenantId), inArray(products.id, ids)));
  if (encontrados.length !== ids.length) {
    throw new OrderError('product_not_found', 'Uno de los productos del pedido no existe');
  }
}

async function cajaAbierta(tx: Tx, tenantId: string): Promise<string> {
  const [s] = await tx
    .select({ id: cash_sessions.id })
    .from(cash_sessions)
    .where(
      and(
        eq(cash_sessions.tenant_id, tenantId),
        eq(cash_sessions.sale_point, SALE_POINT_PEDIDOS),
        isNull(cash_sessions.closed_at)
      )
    )
    .limit(1)
    .for('share');
  if (!s) {
    throw new OrderError(
      'no_open_cash',
      'Para cobrar hace falta una caja abierta. Abrí la caja y volvé a intentar.'
    );
  }
  return s.id;
}

async function bloquearPedido(tx: Tx, tenantId: string, orderId: string) {
  if (!isValidUuid(orderId)) throw new OrderError('invalid_order', 'Pedido no válido');
  const [o] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.tenant_id, tenantId), eq(orders.id, orderId)))
    .limit(1)
    .for('update');
  if (!o) throw new OrderError('order_not_found', 'Ese pedido no existe', 404);
  return o;
}

async function cobradoDe(tx: Tx, tenantId: string, orderId: string): Promise<Decimal> {
  const [r] = await tx
    .select({ total: sql<string>`COALESCE(SUM(${order_payments.amount}), 0)` })
    .from(order_payments)
    .where(and(eq(order_payments.tenant_id, tenantId), eq(order_payments.order_id, orderId)));
  return new Decimal(r?.total ?? '0');
}

async function insertarLineas(tx: Tx, tenantId: string, orderId: string, lineas: LineaNormalizada[]) {
  await tx.insert(order_items).values(
    lineas.map((l, i) => ({
      tenant_id: tenantId,
      order_id: orderId,
      position: i + 1,
      product_id: l.product_id,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      line_total: l.line_total,
    }))
  );
}

/** Inserta un cobro. Quien llama ya validó importe ≤ saldo con el pedido bloqueado. */
async function insertarCobro(
  tx: Tx,
  o: { id: string; number: number; total: string },
  tenantId: string,
  userId: string | null,
  pago: { amount: Decimal; method: OrderPaymentMethod },
  cobradoAntes: Decimal
) {
  if (!userId) {
    throw new OrderError('no_actor', 'Un cobro necesita un usuario identificado');
  }
  const sesionId = await cajaAbierta(tx, tenantId);
  const kind = tipoDeCobro(cobradoAntes, pago.amount, new Decimal(o.total));
  const [fila] = await tx
    .insert(order_payments)
    .values({
      tenant_id: tenantId,
      order_id: o.id,
      kind,
      method: pago.method,
      amount: pago.amount.toFixed(4),
      cash_session_id: sesionId,
      created_by: userId,
    })
    .returning({ id: order_payments.id });
  if (!fila) throw new Error('insert de order_payments no devolvió fila');

  // EVENT-TAXONOMY v2.4.0. Plata que entra a la caja FUERA de una venta: si el
  // arqueo no cierra, este es el evento a mirar.
  await writeAuditLog(
    {
      event_name: 'order.payment.received',
      payload: {
        order_id: o.id,
        number: o.number,
        payment_id: fila.id,
        kind,
        method: pago.method,
        amount: pago.amount.toFixed(4),
        cash_session_id: sesionId,
        cobrado_antes: cobradoAntes.toFixed(4),
        saldo_despues: new Decimal(o.total).minus(cobradoAntes).minus(pago.amount).toFixed(4),
      },
      pii_level: 'internal',
      severity: 'info',
    },
    tx
  );
  return { payment_id: fila.id, kind, cash_session_id: sesionId };
}

function validarImporte(raw: string): Decimal {
  return decimalPositivo(raw, 'El importe', 2);
}

// ── Alta ────────────────────────────────────────────────────────────────────

export interface CreatedOrder {
  order_id: string;
  number: number;
}

/**
 * Toma un pedido, opcionalmente con la seña. Todo o nada: si la seña no se
 * puede registrar (no hay caja abierta, importe mayor al total), el pedido
 * tampoco queda.
 */
export async function createOrder(
  input: OrderInput,
  sena: PaymentInput | null,
  idempotencyKey: string
): Promise<CreatedOrder> {
  await exigirQueOpereElComercio();
  const { tenantId, userId, correlationId } = ctx();
  exigirKey(idempotencyKey);

  const enc0 = normalizarEncabezado(input);
  const lineas = normalizarLineas(input.items);
  const total = totalDelPedido(lineas);
  if (total.lte(0)) {
    throw new OrderError('total_cero', 'El total del pedido tiene que ser mayor a cero');
  }
  const pago = sena
    ? { amount: validarImporte(sena.amount), method: validarMedio(sena.method) }
    : null;
  if (pago && pago.amount.gt(total)) {
    throw new OrderError(
      'sena_mayor_al_total',
      `La seña (${plata(pago.amount)}) no puede superar el total (${plata(total)})`
    );
  }

  const { result } = await withIdempotency<CreatedOrder>(
    {
      tenantId,
      key: idempotencyKey,
      operation: 'order.create',
      requestHash: hashDe('order.create', { enc0, lineas, sena }),
      releaseOnError: true,
    },
    () =>
      db.transaction(async (tx) => {
        const enc = await resolverCliente(tx, tenantId, enc0);
        await verificarProductos(tx, tenantId, lineas);

        // Correlativo por comercio. El advisory lock serializa SOLO las altas
        // de este tenant; el UNIQUE (tenant_id, number) es la red.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${'pandora.orders.number:' + tenantId}, 0))`
        );
        const [n] = await tx
          .select({ next: sql<number>`COALESCE(MAX(${orders.number}), 0) + 1` })
          .from(orders)
          .where(eq(orders.tenant_id, tenantId));
        const number = Number(n?.next ?? 1);

        const [o] = await tx
          .insert(orders)
          .values({
            tenant_id: tenantId,
            number,
            customer_id: enc.customer_id,
            customer_name: enc.customer_name,
            customer_phone: enc.customer_phone,
            pickup_date: enc.pickup_date,
            notes: enc.notes,
            price_freezes: enc.price_freezes,
            total: total.toFixed(4),
            created_by: userId,
            correlation_id: correlationId ?? null,
          })
          .returning({ id: orders.id, number: orders.number, total: orders.total });
        if (!o) throw new Error('insert de orders no devolvió fila');

        await insertarLineas(tx, tenantId, o.id, lineas);

        await writeAuditLog(
          {
            event_name: 'order.created',
            payload: {
              order_id: o.id,
              number,
              total: total.toFixed(4),
              items: lineas.length,
              customer_id: enc.customer_id,
              pickup_date: enc.pickup_date,
              price_freezes: enc.price_freezes,
              con_sena: pago !== null,
            },
            pii_level: 'internal',
            severity: 'info',
          },
          tx
        );

        if (pago) {
          await insertarCobro(tx, o, tenantId, userId, pago, new Decimal(0));
        }
        return { order_id: o.id, number };
      })
  );
  return result;
}

// ── Edición ─────────────────────────────────────────────────────────────────

/**
 * Edita encabezado e ítems de un pedido vivo. Las líneas se reemplazan
 * enteras; el antes y el después quedan en `order.updated`.
 */
export async function updateOrder(orderId: string, input: OrderInput): Promise<void> {
  await exigirQueOpereElComercio();
  const { tenantId } = ctx();
  const enc0 = normalizarEncabezado(input);
  const lineas = normalizarLineas(input.items);
  const total = totalDelPedido(lineas);
  if (total.lte(0)) {
    throw new OrderError('total_cero', 'El total del pedido tiene que ser mayor a cero');
  }

  await db.transaction(async (tx) => {
    const o = await bloquearPedido(tx, tenantId, orderId);
    if (!estaVivo(o.status as OrderStatus)) {
      throw new OrderError('order_closed', 'Un pedido entregado o cancelado ya no se edita');
    }
    const cobrado = await cobradoDe(tx, tenantId, o.id);
    if (total.lt(cobrado)) {
      throw new OrderError(
        'total_menor_a_cobrado',
        `El nuevo total (${plata(total)}) queda por debajo de lo ya cobrado (${plata(cobrado)})`
      );
    }
    const enc = await resolverCliente(tx, tenantId, enc0);
    await verificarProductos(tx, tenantId, lineas);

    const antes = await tx
      .select({
        description: order_items.description,
        quantity: order_items.quantity,
        unit_price: order_items.unit_price,
      })
      .from(order_items)
      .where(and(eq(order_items.tenant_id, tenantId), eq(order_items.order_id, o.id)))
      .orderBy(asc(order_items.position));

    await tx
      .delete(order_items)
      .where(and(eq(order_items.tenant_id, tenantId), eq(order_items.order_id, o.id)));
    await insertarLineas(tx, tenantId, o.id, lineas);

    await tx
      .update(orders)
      .set({
        customer_id: enc.customer_id,
        customer_name: enc.customer_name,
        customer_phone: enc.customer_phone,
        pickup_date: enc.pickup_date,
        notes: enc.notes,
        price_freezes: enc.price_freezes,
        total: total.toFixed(4),
        updated_at: sql`now()`,
      })
      .where(and(eq(orders.tenant_id, tenantId), eq(orders.id, o.id)));

    await writeAuditLog(
      {
        event_name: 'order.updated',
        payload: {
          order_id: o.id,
          number: o.number,
          total_antes: o.total,
          total_despues: total.toFixed(4),
          items_antes: antes,
          items_despues: lineas.map(({ description, quantity, unit_price }) => ({
            description,
            quantity,
            unit_price,
          })),
          pickup_date_antes: o.pickup_date,
          pickup_date_despues: enc.pickup_date,
          price_freezes_antes: o.price_freezes,
          price_freezes_despues: enc.price_freezes,
        },
        pii_level: 'internal',
        severity: 'info',
      },
      tx
    );
  });
}

// ── Estado ──────────────────────────────────────────────────────────────────

async function auditarCambioDeEstado(
  tx: Tx,
  o: { id: string; number: number },
  desde: string,
  hacia: OrderStatus
) {
  await writeAuditLog(
    {
      event_name: 'order.status_changed',
      payload: { order_id: o.id, number: o.number, desde, hacia },
      pii_level: 'internal',
      severity: 'info',
    },
    tx
  );
}

/**
 * Cambia el estado. Pedir el estado en el que ya está es un no-op (doble
 * click). Entregar con saldo pendiente no se puede por acá: va por
 * `deliverOrder`, que cobra y entrega junto.
 */
export async function changeOrderStatus(orderId: string, hacia: OrderStatus): Promise<void> {
  await exigirQueOpereElComercio();
  const { tenantId } = ctx();

  await db.transaction(async (tx) => {
    const o = await bloquearPedido(tx, tenantId, orderId);
    const desde = o.status as OrderStatus;
    if (desde === hacia) return;
    if (!puedePasar(desde, hacia)) {
      throw new OrderError('invalid_transition', 'Ese cambio de estado no está permitido');
    }
    const cobrado = await cobradoDe(tx, tenantId, o.id);
    if (hacia === 'cancelado' && cobrado.gt(0)) {
      throw new OrderError(
        'cancel_con_cobros',
        `Este pedido tiene ${plata(cobrado)} cobrados. Devolver una seña todavía no está ` +
          'disponible: cancelarlo dejaría esa plata en la caja sin explicación.'
      );
    }
    if (hacia === 'entregado') {
      const saldo = new Decimal(o.total).minus(cobrado);
      if (saldo.gt(0)) {
        throw new OrderError(
          'saldo_pendiente',
          `Falta cobrar ${plata(saldo)}. Usá "Cobrar saldo y entregar".`
        );
      }
    }
    await tx
      .update(orders)
      .set({
        status: hacia,
        updated_at: sql`now()`,
        delivered_at: hacia === 'entregado' ? sql`now()` : null,
        cancelled_at: hacia === 'cancelado' ? sql`now()` : null,
      })
      .where(and(eq(orders.tenant_id, tenantId), eq(orders.id, o.id)));
    await auditarCambioDeEstado(tx, o, desde, hacia);
  });
}

// ── Cobros ──────────────────────────────────────────────────────────────────

export interface RegisteredPayment {
  payment_id: string;
  kind: string;
}

/** Cobro a cuenta (o el saldo) de un pedido vivo. */
export async function registerOrderPayment(
  orderId: string,
  input: PaymentInput,
  idempotencyKey: string
): Promise<RegisteredPayment> {
  await exigirQueOpereElComercio();
  const { tenantId, userId } = ctx();
  exigirKey(idempotencyKey);
  const amount = validarImporte(input.amount);
  const method = validarMedio(input.method);

  const { result } = await withIdempotency<RegisteredPayment>(
    {
      tenantId,
      key: idempotencyKey,
      operation: 'order.payment',
      requestHash: hashDe('order.payment', { orderId, amount: amount.toFixed(2), method }),
      releaseOnError: true,
    },
    () =>
      db.transaction(async (tx) => {
        const o = await bloquearPedido(tx, tenantId, orderId);
        if (!estaVivo(o.status as OrderStatus)) {
          throw new OrderError('order_closed', 'Un pedido entregado o cancelado ya no recibe cobros');
        }
        const cobrado = await cobradoDe(tx, tenantId, o.id);
        const saldo = new Decimal(o.total).minus(cobrado);
        if (saldo.lte(0)) {
          throw new OrderError('sin_saldo', 'Este pedido ya está pagado');
        }
        if (amount.gt(saldo)) {
          throw new OrderError(
            'cobro_mayor_al_saldo',
            `El importe (${plata(amount)}) supera lo que falta cobrar (${plata(saldo)})`
          );
        }
        const r = await insertarCobro(tx, o, tenantId, userId, { amount, method }, cobrado);
        return { payment_id: r.payment_id, kind: r.kind };
      })
  );
  return result;
}

/**
 * "Cobrar saldo y entregar": cobra lo que falte (si falta algo) y marca el
 * pedido entregado, en una sola transacción. Si el saldo ya es cero, el medio
 * no hace falta.
 */
export async function deliverOrder(
  orderId: string,
  method: OrderPaymentMethod | null,
  idempotencyKey: string
): Promise<{ cobrado: string }> {
  await exigirQueOpereElComercio();
  const { tenantId, userId } = ctx();
  exigirKey(idempotencyKey);
  const medio = method === null ? null : validarMedio(method);

  const { result } = await withIdempotency<{ cobrado: string }>(
    {
      tenantId,
      key: idempotencyKey,
      operation: 'order.deliver',
      requestHash: hashDe('order.deliver', { orderId, medio }),
      releaseOnError: true,
    },
    () =>
      db.transaction(async (tx) => {
        const o = await bloquearPedido(tx, tenantId, orderId);
        const desde = o.status as OrderStatus;
        if (!puedePasar(desde, 'entregado')) {
          throw new OrderError('order_closed', 'Este pedido ya está cerrado');
        }
        const cobrado = await cobradoDe(tx, tenantId, o.id);
        const saldo = new Decimal(o.total).minus(cobrado);
        if (saldo.gt(0)) {
          if (medio === null) {
            throw new OrderError('falta_medio', `Falta cobrar ${plata(saldo)}: elegí el medio de pago`);
          }
          await insertarCobro(tx, o, tenantId, userId, { amount: saldo, method: medio }, cobrado);
        }
        await tx
          .update(orders)
          .set({ status: 'entregado', delivered_at: sql`now()`, updated_at: sql`now()` })
          .where(and(eq(orders.tenant_id, tenantId), eq(orders.id, o.id)));
        await auditarCambioDeEstado(tx, o, desde, 'entregado');
        return { cobrado: Decimal.max(saldo, 0).toFixed(4) };
      })
  );
  return result;
}

// Las lecturas viven en order.queries.ts (separadas por tamaño, no por capa).
export {
  listOrders,
  getOrderDetail,
  listOrderPaymentsForSession,
  type OrderListRow,
  type OrderDetail,
  type CobroDePedidoEnCaja,
} from './order.queries.js';
