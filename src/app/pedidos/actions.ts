'use server';

/**
 * Server actions de /pedidos. Validan la FORMA del input con zod (frontera,
 * CLAUDE.md §15.3) y delegan todo lo demás en order.service, que es el que
 * decide: rol, caja abierta, saldo, transiciones, idempotencia.
 *
 * Errores: un DomainError trae un mensaje pensado para la pantalla y pasa
 * tal cual. Cualquier otro error se loguea entero y a la pantalla llega un
 * texto genérico: nunca el SQL de Drizzle ni un stack.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { DomainError } from '@/lib/multi_tenant/errors';
import { logger } from '@/lib/observability/logger';
import {
  changeOrderStatus,
  createOrder,
  deliverOrder,
  getOrderDetail,
  registerOrderPayment,
  updateOrder,
  type OrderDetail,
} from '@/lib/services/orders/order.service';
import { ORDER_PAYMENT_METHODS, ORDER_STATUSES } from '@/lib/db/schema/orders';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

async function runAction<T>(nombre: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await withServerActionTracing(fn, { requireAuth: true });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DomainError) {
      return { ok: false, error: e.messageEs, code: e.code };
    }
    if (e instanceof z.ZodError) {
      return { ok: false, error: 'Revisá los datos del pedido: hay un campo con un valor inválido.', code: 'invalid_input' };
    }
    logger.error({ err: e, action: nombre }, 'pedidos: error inesperado');
    return {
      ok: false,
      error: 'No se pudo guardar. No se registró nada: probá de nuevo en un momento.',
      code: 'unexpected',
    };
  }
}

const numero = z.string().trim().min(1).max(24);
const uuid = z.string().uuid();

const lineaSchema = z.object({
  product_id: uuid.nullable().optional(),
  description: z.string().max(200),
  quantity: numero,
  unit_price: numero,
});

const pedidoSchema = z.object({
  customer_id: uuid.nullable().optional(),
  customer_name: z.string().max(120),
  customer_phone: z.string().max(40).nullable().optional(),
  pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  price_freezes: z.boolean(),
  items: z.array(lineaSchema).min(1).max(50),
});

const pagoSchema = z.object({
  amount: numero,
  method: z.enum(ORDER_PAYMENT_METHODS),
});

export type PedidoForm = z.infer<typeof pedidoSchema>;
export type PagoForm = z.infer<typeof pagoSchema>;

export async function crearPedidoAction(
  input: PedidoForm,
  sena: PagoForm | null,
  idempotencyKey: string
): Promise<ActionResult<{ order_id: string; number: number }>> {
  return runAction('crearPedido', async () => {
    const pedido = pedidoSchema.parse(input);
    const pago = sena === null ? null : pagoSchema.parse(sena);
    const r = await createOrder(pedido, pago, uuid.parse(idempotencyKey));
    revalidatePath('/pedidos');
    revalidatePath('/caja');
    return r;
  });
}

export async function editarPedidoAction(
  orderId: string,
  input: PedidoForm
): Promise<ActionResult<null>> {
  return runAction('editarPedido', async () => {
    await updateOrder(uuid.parse(orderId), pedidoSchema.parse(input));
    revalidatePath('/pedidos');
    return null;
  });
}

export async function cambiarEstadoAction(
  orderId: string,
  estado: string
): Promise<ActionResult<null>> {
  return runAction('cambiarEstado', async () => {
    await changeOrderStatus(uuid.parse(orderId), z.enum(ORDER_STATUSES).parse(estado));
    revalidatePath('/pedidos');
    return null;
  });
}

export async function cobrarPedidoAction(
  orderId: string,
  pago: PagoForm,
  idempotencyKey: string
): Promise<ActionResult<{ kind: string }>> {
  return runAction('cobrarPedido', async () => {
    const r = await registerOrderPayment(
      uuid.parse(orderId),
      pagoSchema.parse(pago),
      uuid.parse(idempotencyKey)
    );
    revalidatePath('/pedidos');
    revalidatePath('/caja');
    return { kind: r.kind };
  });
}

export async function entregarPedidoAction(
  orderId: string,
  method: string | null,
  idempotencyKey: string
): Promise<ActionResult<{ cobrado: string }>> {
  return runAction('entregarPedido', async () => {
    const medio = method === null ? null : z.enum(ORDER_PAYMENT_METHODS).parse(method);
    const r = await deliverOrder(uuid.parse(orderId), medio, uuid.parse(idempotencyKey));
    revalidatePath('/pedidos');
    revalidatePath('/caja');
    return r;
  });
}

/** Fechas como ISO: el resultado cruza al cliente serializado. */
export type DetalleDTO = Omit<OrderDetail, 'order' | 'payments'> & {
  order: Omit<OrderDetail['order'], 'created_at' | 'delivered_at'> & {
    created_at: string;
    delivered_at: string | null;
  };
  payments: Array<Omit<OrderDetail['payments'][number], 'created_at'> & { created_at: string }>;
};

export async function detallePedidoAction(orderId: string): Promise<ActionResult<DetalleDTO | null>> {
  return runAction('detallePedido', async () => {
    const d = await getOrderDetail(uuid.parse(orderId));
    if (!d) return null;
    return {
      ...d,
      order: {
        ...d.order,
        created_at: d.order.created_at.toISOString(),
        delivered_at: d.order.delivered_at ? d.order.delivered_at.toISOString() : null,
      },
      payments: d.payments.map((p) => ({ ...p, created_at: p.created_at.toISOString() })),
    };
  });
}
