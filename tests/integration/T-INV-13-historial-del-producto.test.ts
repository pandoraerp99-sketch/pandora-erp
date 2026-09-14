/**
 * T-INV-13 — El historial de movimientos de un producto.
 *
 * Es donde se ve el rastro de un ajuste después de cerrarlo. Lo que se protege:
 *
 *  1. El orden y la fecha son los del día en que PASÓ (`fecha`, migration 0037),
 *     no los de carga. Y cuando difieren se muestran las dos: si no, un
 *     comprobante de julio cargado ayer aparece "en julio" y el comerciante,
 *     que sabe que lo tipeó ayer, desconfía de la pantalla.
 *  2. Cada fila dice DE DÓNDE salió en palabras: la venta, el comprobante, el
 *     motivo del ajuste, y quién.
 *  3. Otro comercio no ve nada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { sales } from '@/lib/db/schema/sales';
import { expenses } from '@/lib/db/schema/expenses';
import { expense_items } from '@/lib/db/schema/expense_items';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { recordStockMovement } from '@/lib/inventory';
import { listProductMovements } from '@/lib/inventory/queries';
import { registerExpense } from '@/lib/services/expenses/expense.service';
import { adjustStock } from '@/lib/services/products';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';

describe('T-INV-13 — Historial de movimientos del producto', () => {
  const tenant = crypto.randomUUID();
  const otroTenant = crypto.randomUUID();
  const user = crypto.randomUUID();
  const yerba = crypto.randomUUID();
  const HOY = diaDelComercio();

  const conCtx = <T>(fn: () => Promise<T>, tid = tenant) =>
    withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tid,
        actor_user_id: user,
        actor_type: 'user',
      },
      fn
    );

  const crearCompany = (id: string, n: number) =>
    db.insert(companies).values({
      id,
      name: `T-INV-13 Co ${n}`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });

  beforeAll(async () => {
    await crearCompany(tenant, 1);
    await crearCompany(otroTenant, 2);
    await db.insert(users).values({
      id: user,
      email: `t-inv-13-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Agus Test',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenant,
      user_id: user,
      role: 'owner',
    });
    await db.insert(products).values({
      id: yerba,
      tenant_id: tenant,
      name: 'Yerba 1kg',
      unit_type: 'unidad',
      price: '3000.0000',
      tax_rate: '21.00',
      stock_current: '0.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });

    // (1) Una compra con comprobante de julio, cargada HOY.
    await conCtx(() =>
      registerExpense({
        fecha: '2026-07-20',
        categoria: 'mercaderia',
        total: '20000',
        medio_pago: 'transferencia',
        payee_name: 'Distribuidora Austral',
        comprobante_tipo: 'FC A',
        comprobante_numero: '0003-00001234',
        items: [{ product_id: yerba, qty: '10', unit_cost: '2000' }],
      })
    );

    // (2) Una venta, a una clienta con nombre.
    const [venta] = await db
      .insert(sales)
      .values({
        tenant_id: tenant,
        correlation_id: generateCorrelationId(),
        cashier_user_id: user,
        commercial_status: 'terminada',
        subtotal: '2479.34',
        tax_amount: '520.66',
        total: '3000.00',
        customer_name_snapshot: 'María Pérez',
      })
      .returning({ id: sales.id });
    await conCtx(() =>
      recordStockMovement({
        product_id: yerba,
        type: 'sale',
        qty: '1',
        related_sale_id: venta!.id,
        skip_audit: true,
      })
    );

    // (3) Una rotura.
    await conCtx(() =>
      adjustStock({ product_id: yerba, delta: '-2', motivo: 'rotura', detalle: 'se cayó' })
    );
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenant));
      await tx.delete(expense_items).where(eq(expense_items.tenant_id, tenant));
      await tx.delete(expenses).where(eq(expenses.tenant_id, tenant));
      await tx.delete(sales).where(eq(sales.tenant_id, tenant));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenant));
      await tx.delete(products).where(eq(products.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(eq(companies.id, tenant));
      await tx.delete(companies).where(eq(companies.id, otroTenant));
    });
  });

  it('🔴 ordena por el día en que PASÓ: la compra de julio va última aunque se cargó hoy', async () => {
    const h = await conCtx(() => listProductMovements(yerba));
    expect(h.movimientos.map((m) => m.type)).toEqual(['loss', 'sale', 'purchase']);
  });

  it('🔴 la compra muestra la fecha del comprobante Y el día en que se cargó', async () => {
    const h = await conCtx(() => listProductMovements(yerba));
    const compra = h.movimientos.find((m) => m.type === 'purchase')!;
    expect(compra.fecha).toBe('2026-07-20');
    expect(compra.cargado).toBe(HOY);
    // Y dice de qué papel salió.
    expect(compra.origen).toBe('FC A 0003-00001234 · Distribuidora Austral');
    expect(compra.direction).toBe('in');
    expect(compra.qty).toBe('10.0000');
  });

  it('la venta dice a quién (el "Venta" ya lo dice la etiqueta del tipo)', async () => {
    const h = await conCtx(() => listProductMovements(yerba));
    const venta = h.movimientos.find((m) => m.type === 'sale')!;
    // Visto en la pantalla: con el origen repitiendo el tipo, las filas decían
    // "Venta Venta" y "Compra Compra".
    expect(venta.origen).toBe('María Pérez');
    expect(venta.fecha).toBe(HOY);
    expect(venta.cargado).toBe(HOY);
  });

  it('una venta sin cliente o una compra sin papeles no inventan un origen', async () => {
    const [v2] = await db
      .insert(sales)
      .values({
        tenant_id: tenant,
        correlation_id: generateCorrelationId(),
        cashier_user_id: user,
        commercial_status: 'terminada',
        subtotal: '2479.34',
        tax_amount: '520.66',
        total: '3000.00',
      })
      .returning({ id: sales.id });
    await conCtx(() =>
      recordStockMovement({
        product_id: yerba,
        type: 'sale',
        qty: '1',
        related_sale_id: v2!.id,
        skip_audit: true,
      })
    );
    await conCtx(() =>
      registerExpense({
        fecha: '2026-06-01',
        categoria: 'mercaderia',
        total: '2000',
        medio_pago: 'transferencia',
        items: [{ product_id: yerba, qty: '1', unit_cost: '2000' }],
      })
    );

    const h = await conCtx(() => listProductMovements(yerba));
    const ventaSinCliente = h.movimientos.find((m) => m.type === 'sale' && m.origen === null);
    expect(ventaSinCliente).toBeDefined();
    // Una compra sin comprobante NO es "nada que decir": que falte el papel es
    // un dato para quien mira el historial.
    const compraSinPapel = h.movimientos.find((m) => m.fecha === '2026-06-01')!;
    expect(compraSinPapel.origen).toBe('sin comprobante');

    // 🔴 El orden, con un caso que SÍ discrimina. Esta compra de junio es la
    // ÚLTIMA que se cargó: ordenando por carga iría primera. Ordenando por el
    // día en que pasó, va última. (El test de orden de arriba no alcanzaba: su
    // compra de julio se carga primero, así que los dos órdenes coinciden — lo
    // encontró scripts/mutar-ajuste-stock.sh.)
    expect(h.movimientos.at(-1)?.fecha).toBe('2026-06-01');
    expect(h.movimientos[0]?.fecha).not.toBe('2026-06-01');
  });

  it('el ajuste dice su motivo, su detalle y quién lo hizo', async () => {
    const h = await conCtx(() => listProductMovements(yerba));
    const rotura = h.movimientos.find((m) => m.type === 'loss')!;
    expect(rotura.motivo).toBe('rotura');
    expect(rotura.origen).toBe('Rotura · se cayó');
    expect(rotura.quien).toBe('Agus Test');
    expect(rotura.direction).toBe('out');
  });

  it('🔴 otro comercio no ve el historial de este producto', async () => {
    const h = await conCtx(() => listProductMovements(yerba), otroTenant);
    expect(h.movimientos).toHaveLength(0);
  });

  it('dice cuántos hay en total, aunque muestre menos', async () => {
    const h = await conCtx(() => listProductMovements(yerba, { limit: 2 }));
    expect(h.movimientos).toHaveLength(2);
    // 3 del beforeAll + la venta sin cliente y la compra sin papel de arriba.
    expect(h.total).toBe(5);
  });
});
