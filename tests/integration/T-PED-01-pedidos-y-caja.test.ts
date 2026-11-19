/**
 * T-PED-01 — pedidos con seña: el detalle cierra con el total, la seña llega
 * al arqueo, y ni un doble click ni un reintento duplican plata (ADR-0029).
 *
 * Entra por el camino real (service → closeCashSession), no por funciones
 * sueltas: lo que importa es que el cajero, al cerrar, cuente lo mismo que
 * dice la pantalla.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { orders, order_items, order_payments } from '@/lib/db/schema/orders';
import { idempotency_log } from '@/lib/db/schema/idempotency_log';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  closeCashSession,
  computeCashBreakdown,
  openCashSession,
} from '@/lib/cash/sessions';
import {
  changeOrderStatus,
  createOrder,
  deliverOrder,
  getOrderDetail,
  listOrderPaymentsForSession,
  listOrders,
  registerOrderPayment,
  updateOrder,
  type OrderInput,
} from '@/lib/services/orders/order.service';

const INICIAL = '10000.00';

async function crearComercio(etiqueta: string) {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await db.insert(companies).values({
    id: tenantId,
    name: `T-PED-01 ${etiqueta}`,
    legal_name: `T-PED-01 ${etiqueta} SRL`,
    cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
    tax_regime: 'responsable_inscripto',
    merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
    merchant_special_regime: null,
    afip_environment: 'homologacion',
    afip_sale_point: '0001',
    demo_status: 'trial',
  });
  await db.insert(users).values({
    id: userId,
    email: `t-ped01-${userId.slice(0, 8)}@test.local`,
    full_name: `Cajera ${etiqueta}`,
    is_support: false,
  });
  await db.insert(company_users).values({
    id: crypto.randomUUID(),
    company_id: tenantId,
    user_id: userId,
    role: 'owner',
  });
  return { tenantId, userId };
}

async function borrarComercio(tenantId: string, userId: string) {
  await db.transaction(async (tx) => {
    // replica: saltea los triggers append-only SÓLO para limpiar fixtures.
    await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
    await tx.delete(order_payments).where(eq(order_payments.tenant_id, tenantId));
    await tx.delete(order_items).where(eq(order_items.tenant_id, tenantId));
    await tx.delete(orders).where(eq(orders.tenant_id, tenantId));
    await tx.delete(idempotency_log).where(eq(idempotency_log.tenant_id, tenantId));
    await tx.execute(
      sql`DELETE FROM cash_movements WHERE cash_session_id IN (
            SELECT id FROM cash_sessions WHERE tenant_id = ${tenantId})`
    );
    await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tenantId));
    await tx.delete(products).where(eq(products.tenant_id, tenantId));
    await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
    await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
    await tx.delete(users).where(eq(users.id, userId));
    await tx.delete(companies).where(eq(companies.id, tenantId));
  });
}

describe('T-PED-01 — pedidos con seña y caja', () => {
  let A: { tenantId: string; userId: string };
  let B: { tenantId: string; userId: string };

  const como = <T,>(c: { tenantId: string; userId: string }, fn: () => Promise<T>) =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: c.tenantId,
          actor_user_id: c.userId,
          actor_type: 'user',
          actor_role: 'owner',
        },
        fn
      )
    );
  const enA = <T,>(fn: () => Promise<T>) => como(A, fn);

  /** Tafeta: 3,2 m × $1.234,57 = $3.950,624 → $3.950,62 (HALF_EVEN) + un ítem libre. */
  const pedidoBase = (): OrderInput => ({
    customer_name: 'García SRL',
    customer_phone: '2901 555-1234',
    pickup_date: '2026-11-25',
    notes: 'tono bordó',
    price_freezes: true,
    items: [
      { description: 'Tafeta roja — bordó', quantity: '3.2', unit_price: '1234.57' },
      { description: 'Ruedo a mano', quantity: '1', unit_price: '100' },
    ],
  });

  const abrirCaja = () => enA(() => openCashSession({ sale_point: 1, initial_amount: INICIAL }));

  beforeEach(async () => {
    A = await crearComercio('A');
    B = await crearComercio('B');
  });

  afterEach(async () => {
    await borrarComercio(A.tenantId, A.userId);
    await borrarComercio(B.tenantId, B.userId);
  });

  it('el total cierra con el detalle (redondeo por línea) y el número es correlativo', async () => {
    const p1 = await enA(() => createOrder(pedidoBase(), null, crypto.randomUUID()));
    const p2 = await enA(() => createOrder(pedidoBase(), null, crypto.randomUUID()));
    expect(p1.number).toBe(1);
    expect(p2.number).toBe(2);

    const [o] = await db.select().from(orders).where(eq(orders.id, p1.order_id));
    expect(o!.total).toBe('4050.6200');
    expect(o!.status).toBe('tomado');
    expect(o!.price_freezes).toBe(true);

    const lineas = await db.select().from(order_items).where(eq(order_items.order_id, p1.order_id));
    expect(lineas.map((l) => l.line_total).sort()).toEqual(['100.0000', '3950.6200']);
    const suma = await db.execute<{ s: string }>(
      sql`SELECT SUM(line_total)::text AS s FROM order_items WHERE order_id = ${p1.order_id}`
    );
    expect(suma[0]!.s).toBe('4050.6200');

    const ev = await db
      .select()
      .from(audit_log)
      .where(and(eq(audit_log.tenant_id, A.tenantId), eq(audit_log.event_name, 'order.created')));
    expect(ev.length).toBe(2);
  });

  it('la seña en EFECTIVO entra al esperado y el cierre da cero', async () => {
    const caja = await abrirCaja();
    const p = await enA(() =>
      createOrder(pedidoBase(), { amount: '1500', method: 'efectivo' }, crypto.randomUUID())
    );

    const pagos = await db.select().from(order_payments).where(eq(order_payments.order_id, p.order_id));
    expect(pagos.length).toBe(1);
    expect(pagos[0]!.kind).toBe('sena');
    expect(pagos[0]!.cash_session_id).toBe(caja.id);

    const desglose = await computeCashBreakdown(db, caja.id, A.tenantId, INICIAL);
    expect(desglose.orderPayments).toBe('1500.0000');
    expect(desglose.expected).toBe('11500.0000');

    // El cajero cuenta inicial + seña. Si la fórmula no sumara la seña,
    // esto daría un sobrante de $1.500 que nadie sabría explicar.
    const cierre = await enA(() =>
      closeCashSession({ session_id: caja.id, counted_amount: '11500.00' })
    );
    expect(Number(cierre.descuadre)).toBe(0);
  });

  it('la seña con DÉBITO figura en la caja pero no en el cajón', async () => {
    const caja = await abrirCaja();
    await enA(() => createOrder(pedidoBase(), { amount: '800', method: 'debito' }, crypto.randomUUID()));

    const desglose = await computeCashBreakdown(db, caja.id, A.tenantId, INICIAL);
    expect(desglose.orderPayments).toBe('0.0000');
    expect(desglose.expected).toBe('10000.0000');

    const enCaja = await enA(() => listOrderPaymentsForSession(caja.id));
    expect(enCaja.length).toBe(1);
    expect(enCaja[0]!.method).toBe('debito');
    expect(enCaja[0]!.number).toBe(1);
  });

  it('sin caja abierta, el alta con seña falla ENTERA (no queda el pedido)', async () => {
    await expect(
      enA(() => createOrder(pedidoBase(), { amount: '500', method: 'efectivo' }, crypto.randomUUID()))
    ).rejects.toThrow(/caja abierta/i);
    const quedaron = await db.select().from(orders).where(eq(orders.tenant_id, A.tenantId));
    expect(quedaron.length).toBe(0);
  });

  it('doble click en Guardar: misma clave, UN pedido y UNA seña', async () => {
    await abrirCaja();
    const key = crypto.randomUUID();
    const sena = { amount: '1000', method: 'efectivo' as const };
    const r = await Promise.allSettled([
      enA(() => createOrder(pedidoBase(), sena, key)),
      enA(() => createOrder(pedidoBase(), sena, key)),
    ]);
    expect(r.some((x) => x.status === 'fulfilled')).toBe(true);
    // Reintento posterior con la misma clave: devuelve el mismo pedido.
    const replay = await enA(() => createOrder(pedidoBase(), sena, key));
    const ok = r.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<{ order_id: string }>;
    expect(replay.order_id).toBe(ok.value.order_id);

    expect((await db.select().from(orders).where(eq(orders.tenant_id, A.tenantId))).length).toBe(1);
    expect(
      (await db.select().from(order_payments).where(eq(order_payments.tenant_id, A.tenantId))).length
    ).toBe(1);
  });

  it('dos cobros simultáneos que juntos superan el saldo: entra UNO', async () => {
    await abrirCaja();
    const p = await enA(() => createOrder(pedidoBase(), null, crypto.randomUUID()));
    // saldo 4050,62 → dos cobros de 3000 no pueden entrar los dos.
    const r = await Promise.allSettled([
      enA(() => registerOrderPayment(p.order_id, { amount: '3000', method: 'efectivo' }, crypto.randomUUID())),
      enA(() => registerOrderPayment(p.order_id, { amount: '3000', method: 'efectivo' }, crypto.randomUUID())),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1);
    const rechazo = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(String(rechazo.reason)).toMatch(/supera lo que falta cobrar/);
  });

  it('cobro de más rechazado; el que completa es "saldo"; entregar con saldo cero', async () => {
    await abrirCaja();
    const p = await enA(() =>
      createOrder(pedidoBase(), { amount: '1000', method: 'efectivo' }, crypto.randomUUID())
    );
    await expect(
      enA(() => registerOrderPayment(p.order_id, { amount: '3050.63', method: 'efectivo' }, crypto.randomUUID()))
    ).rejects.toThrow(/supera/);

    const r = await enA(() =>
      registerOrderPayment(p.order_id, { amount: '3050.62', method: 'transferencia' }, crypto.randomUUID())
    );
    expect(r.kind).toBe('saldo');

    await enA(() => changeOrderStatus(p.order_id, 'entregado'));
    const d = await enA(() => getOrderDetail(p.order_id));
    expect(d!.order.status).toBe('entregado');
    expect(d!.payments.map((x) => x.kind)).toEqual(['sena', 'saldo']);
  });

  it('"Cobrar saldo y entregar": cobra lo que falta, entrega, y el reintento no cobra dos veces', async () => {
    const caja = await abrirCaja();
    const p = await enA(() =>
      createOrder(pedidoBase(), { amount: '50.62', method: 'efectivo' }, crypto.randomUUID())
    );
    // Sin medio no se puede: falta plata.
    await expect(enA(() => deliverOrder(p.order_id, null, crypto.randomUUID()))).rejects.toThrow(/medio/);

    const key = crypto.randomUUID();
    const r1 = await enA(() => deliverOrder(p.order_id, 'efectivo', key));
    const r2 = await enA(() => deliverOrder(p.order_id, 'efectivo', key));
    expect(r1.cobrado).toBe('4000.0000');
    expect(r2).toEqual(r1);

    const pagos = await db.select().from(order_payments).where(eq(order_payments.order_id, p.order_id));
    expect(pagos.length).toBe(2);
    const [o] = await db.select().from(orders).where(eq(orders.id, p.order_id));
    expect(o!.status).toBe('entregado');
    expect(o!.delivered_at).not.toBeNull();

    const desglose = await computeCashBreakdown(db, caja.id, A.tenantId, INICIAL);
    expect(desglose.orderPayments).toBe('4050.6200');

    // Entregado es terminal.
    await expect(enA(() => changeOrderStatus(p.order_id, 'listo'))).rejects.toThrow(/no está permitido/);
    await expect(
      enA(() => registerOrderPayment(p.order_id, { amount: '1', method: 'efectivo' }, crypto.randomUUID()))
    ).rejects.toThrow(/ya no recibe cobros/);
  });

  it('editar: reemplaza las líneas, recalcula, y no deja el total debajo de lo cobrado', async () => {
    await abrirCaja();
    const p = await enA(() =>
      createOrder(pedidoBase(), { amount: '2000', method: 'efectivo' }, crypto.randomUUID())
    );
    const chico = { ...pedidoBase(), items: [{ description: 'Ruedo', quantity: '1', unit_price: '1999.99' }] };
    await expect(enA(() => updateOrder(p.order_id, chico))).rejects.toThrow(/por debajo de lo ya cobrado/);

    const nuevo = {
      ...pedidoBase(),
      pickup_date: '2026-12-01',
      items: [{ description: 'Tafeta roja — bordó', quantity: '5', unit_price: '1234.57' }],
    };
    await enA(() => updateOrder(p.order_id, nuevo));
    const d = await enA(() => getOrderDetail(p.order_id));
    expect(d!.order.total).toBe('6172.8500');
    expect(d!.items.length).toBe(1);
    expect(d!.order.pickup_date).toBe('2026-12-01');

    const ev = await db
      .select()
      .from(audit_log)
      .where(and(eq(audit_log.tenant_id, A.tenantId), eq(audit_log.event_name, 'order.updated')));
    expect(ev.length).toBe(1);
    expect((ev[0]!.payload as { total_antes: string }).total_antes).toBe('4050.6200');
  });

  it('cancelar: con cobros se bloquea; sin cobros queda cancelado con fecha', async () => {
    await abrirCaja();
    const conSena = await enA(() =>
      createOrder(pedidoBase(), { amount: '100', method: 'efectivo' }, crypto.randomUUID())
    );
    await expect(enA(() => changeOrderStatus(conSena.order_id, 'cancelado'))).rejects.toThrow(
      /cobrados/
    );

    const sinSena = await enA(() => createOrder(pedidoBase(), null, crypto.randomUUID()));
    await enA(() => changeOrderStatus(sinSena.order_id, 'cancelado'));
    // Doble click: pedir el mismo estado es un no-op, no un error.
    await enA(() => changeOrderStatus(sinSena.order_id, 'cancelado'));
    const [o] = await db.select().from(orders).where(eq(orders.id, sinSena.order_id));
    expect(o!.status).toBe('cancelado');
    expect(o!.cancelled_at).not.toBeNull();
  });

  it('un cobro no se puede borrar ni editar (append-only en la base)', async () => {
    await abrirCaja();
    const p = await enA(() =>
      createOrder(pedidoBase(), { amount: '100', method: 'efectivo' }, crypto.randomUUID())
    );
    await expect(
      db.delete(order_payments).where(eq(order_payments.order_id, p.order_id))
    ).rejects.toThrow();
    await expect(
      db.update(order_payments).set({ amount: '1' }).where(eq(order_payments.order_id, p.order_id))
    ).rejects.toThrow();
    await expect(db.delete(orders).where(eq(orders.id, p.order_id))).rejects.toThrow();
  });

  it('aislamiento: otro comercio no ve, no cobra y no usa los productos de A', async () => {
    await abrirCaja();
    const p = await enA(() => createOrder(pedidoBase(), null, crypto.randomUUID()));

    expect(await como(B, () => getOrderDetail(p.order_id))).toBeNull();
    expect((await como(B, () => listOrders())).length).toBe(0);
    await expect(
      como(B, () => registerOrderPayment(p.order_id, { amount: '1', method: 'efectivo' }, crypto.randomUUID()))
    ).rejects.toThrow(/no existe/);
    await expect(como(B, () => changeOrderStatus(p.order_id, 'cancelado'))).rejects.toThrow(/no existe/);

    const [prodA] = await db
      .insert(products)
      .values({ tenant_id: A.tenantId, name: 'Hilo', price: '500' })
      .returning({ id: products.id });
    const conProductoAjeno = {
      ...pedidoBase(),
      items: [{ product_id: prodA!.id, description: 'Hilo', quantity: '1', unit_price: '500' }],
    };
    await expect(
      como(B, () => createOrder(conProductoAjeno, null, crypto.randomUUID()))
    ).rejects.toThrow(/no existe/);
  });

  it('validación de entrada: sin ítems, cantidad cero, seña mayor al total', async () => {
    await abrirCaja();
    await expect(
      enA(() => createOrder({ ...pedidoBase(), items: [] }, null, crypto.randomUUID()))
    ).rejects.toThrow(/al menos un ítem/);
    await expect(
      enA(() =>
        createOrder(
          { ...pedidoBase(), items: [{ description: 'x', quantity: '0', unit_price: '10' }] },
          null,
          crypto.randomUUID()
        )
      )
    ).rejects.toThrow(/mayor a cero/);
    await expect(
      enA(() => createOrder(pedidoBase(), { amount: '9999', method: 'efectivo' }, crypto.randomUUID()))
    ).rejects.toThrow(/no puede superar el total/);
    await expect(
      enA(() => createOrder({ ...pedidoBase(), customer_name: '  ' }, null, crypto.randomUUID()))
    ).rejects.toThrow(/a nombre de quién/);
  });
});
