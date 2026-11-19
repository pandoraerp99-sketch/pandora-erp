/**
 * Pedidos — lecturas (ADR-0029). Separadas de order.service.ts por tamaño.
 * Todas filtran por el tenant del contexto adentro del WHERE.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { orders, order_items, order_payments, type OrderStatus } from '../../db/schema/orders.js';
import { users } from '../../db/schema/users.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';
import { isValidUuid } from '../../tracing/ids.js';

function ctx() {
  const c = requireTracingContext();
  if (!c.tenant_id) {
    throw new CrossTenantAccessError('desconocido', null, 'order.queries (sin tenant)');
  }
  return { tenantId: c.tenant_id };
}

// ── Lecturas ────────────────────────────────────────────────────────────────

export interface OrderListRow {
  id: string;
  number: number;
  created_at: Date;
  delivered_at: Date | null;
  customer_id: string | null;
  customer_name: string;
  status: OrderStatus;
  total: string;
  cobrado: string;
  /** Importe del cobro de tipo 'sena', si lo hubo. La columna "Seña" muestra ESTE, no lo cobrado. */
  sena: string | null;
  pickup_date: string | null;
  price_freezes: boolean;
  primer_item: string | null;
  cantidad_items: number;
  tomado_por: string | null;
}

/** El libro de pedidos, más nuevos primero. */
export async function listOrders(limit = 500): Promise<OrderListRow[]> {
  return consultarPedidos(limit, null);
}

async function consultarPedidos(limit: number, soloId: string | null): Promise<OrderListRow[]> {
  const { tenantId } = ctx();
  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      created_at: orders.created_at,
      delivered_at: orders.delivered_at,
      customer_id: orders.customer_id,
      customer_name: orders.customer_name,
      status: orders.status,
      total: orders.total,
      pickup_date: orders.pickup_date,
      price_freezes: orders.price_freezes,
      cobrado: sql<string>`COALESCE((SELECT SUM(p.amount) FROM order_payments p
        WHERE p.order_id = ${orders.id} AND p.tenant_id = ${orders.tenant_id}), 0)`,
      sena: sql<string | null>`(SELECT p.amount::text FROM order_payments p
        WHERE p.order_id = ${orders.id} AND p.tenant_id = ${orders.tenant_id} AND p.kind = 'sena'
        ORDER BY p.created_at LIMIT 1)`,
      primer_item: sql<string | null>`(SELECT i.description FROM order_items i
        WHERE i.order_id = ${orders.id} AND i.tenant_id = ${orders.tenant_id}
        ORDER BY i.position LIMIT 1)`,
      cantidad_items: sql<number>`(SELECT COUNT(*)::int FROM order_items i
        WHERE i.order_id = ${orders.id} AND i.tenant_id = ${orders.tenant_id})`,
      tomado_por: sql<string | null>`COALESCE(${users.full_name}, ${users.email})`,
    })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.created_by))
    .where(
      soloId === null
        ? eq(orders.tenant_id, tenantId)
        : and(eq(orders.tenant_id, tenantId), eq(orders.id, soloId))
    )
    .orderBy(desc(orders.created_at))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    status: r.status as OrderStatus,
    cobrado: String(r.cobrado),
    cantidad_items: Number(r.cantidad_items),
  }));
}

export interface OrderDetail {
  order: OrderListRow & { customer_phone: string | null; notes: string | null };
  items: Array<{
    product_id: string | null;
    description: string;
    quantity: string;
    unit_price: string;
    line_total: string;
  }>;
  payments: Array<{
    id: string;
    kind: string;
    method: string;
    amount: string;
    created_at: Date;
    por: string | null;
  }>;
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const { tenantId } = ctx();
  if (!isValidUuid(orderId)) return null;
  const lista = await db
    .select({ id: orders.id, phone: orders.customer_phone, notes: orders.notes })
    .from(orders)
    .where(and(eq(orders.tenant_id, tenantId), eq(orders.id, orderId)))
    .limit(1);
  const head = lista[0];
  if (!head) return null;
  const [row] = await consultarPedidos(1, orderId);
  if (!row) return null;

  const items = await db
    .select({
      product_id: order_items.product_id,
      description: order_items.description,
      quantity: order_items.quantity,
      unit_price: order_items.unit_price,
      line_total: order_items.line_total,
    })
    .from(order_items)
    .where(and(eq(order_items.tenant_id, tenantId), eq(order_items.order_id, orderId)))
    .orderBy(asc(order_items.position));

  const payments = await db
    .select({
      id: order_payments.id,
      kind: order_payments.kind,
      method: order_payments.method,
      amount: order_payments.amount,
      created_at: order_payments.created_at,
      por: sql<string | null>`COALESCE(${users.full_name}, ${users.email})`,
    })
    .from(order_payments)
    .leftJoin(users, eq(users.id, order_payments.created_by))
    .where(and(eq(order_payments.tenant_id, tenantId), eq(order_payments.order_id, orderId)))
    .orderBy(asc(order_payments.created_at));

  return {
    order: { ...row, customer_phone: head.phone, notes: head.notes },
    items,
    payments,
  };
}

export interface CobroDePedidoEnCaja {
  id: string;
  order_id: string;
  number: number;
  customer_name: string;
  kind: string;
  method: string;
  amount: string;
  created_at: Date;
}

/** Los cobros de pedidos que entraron por una sesión de caja (para /caja). */
export async function listOrderPaymentsForSession(
  sessionId: string
): Promise<CobroDePedidoEnCaja[]> {
  const { tenantId } = ctx();
  if (!isValidUuid(sessionId)) return [];
  return db
    .select({
      id: order_payments.id,
      order_id: order_payments.order_id,
      number: orders.number,
      customer_name: orders.customer_name,
      kind: order_payments.kind,
      method: order_payments.method,
      amount: order_payments.amount,
      created_at: order_payments.created_at,
    })
    .from(order_payments)
    .innerJoin(
      orders,
      and(eq(orders.id, order_payments.order_id), eq(orders.tenant_id, order_payments.tenant_id))
    )
    .where(
      and(eq(order_payments.tenant_id, tenantId), eq(order_payments.cash_session_id, sessionId))
    )
    .orderBy(asc(order_payments.created_at));
}
