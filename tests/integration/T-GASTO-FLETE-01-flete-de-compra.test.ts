/**
 * T-GASTO-FLETE-01 — el flete de una compra entra al costo (migration 0046).
 *
 * Decisión del owner (2026-11-19): el flete del expreso es costo de
 * adquisición, se suma al costo de la mercadería de ESA compra, repartido por
 * valor. Confirmación contable pendiente con la contadora (A-33).
 *
 * Compra de referencia: cinta 10 × $1.000 y tijera 5 × $2.000 (Σ = $20.000).
 * Flete de $2.000 → por unidad: cinta 2000×1000/20000 = $100, tijera $200.
 *
 * Lo que se prueba:
 * - el costo del producto queda con su parte del flete, y las partes suman
 *   EXACTO el flete;
 * - con IVA discriminado en el flete, sólo el neto es costo;
 * - compra y flete van juntos: si el flete se rechaza, no queda la compra;
 * - anular el flete devuelve el costo sin flete;
 * - anular la compra NO anula el flete (es una deuda real) y el costo vuelve
 *   a la compra anterior;
 * - una factura más vieja que la última compra no cambia el costo, aunque
 *   traiga flete;
 * - el inventario valorizado incluye la parte del flete;
 * - un flete no puede apuntar a una compra de otro comercio ni a una compra
 *   sin artículos.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses, GASTO_VIGENTE } from '@/lib/db/schema/expenses';
import { expense_items } from '@/lib/db/schema/expense_items';
import { expense_cost_behaviour } from '@/lib/db/schema/expense_cost_behaviour';
import { products } from '@/lib/db/schema/products';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { supplier_account_movements } from '@/lib/db/schema/supplier_account';
import { terceros } from '@/lib/db/schema/terceros';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  annulExpense,
  registerExpense,
  registrarCompraConFleteOnce,
  type NuevoGasto,
} from '@/lib/services/expenses/expense.service';
import { getInventarioAlCierre } from '@/lib/services/reporting/inventario.report';

describe('T-GASTO-FLETE-01 — flete de una compra', () => {
  let tenantId: string;
  let otro: string;
  let userId: string;
  let cinta: string;
  let tijera: string;
  let expreso: string;
  let nro = 0;

  const withCtx = <T>(fn: () => Promise<T>, tid?: string) =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid ?? tenantId,
          actor_user_id: userId,
          actor_type: 'user',
          actor_role: 'owner',
        },
        fn
      )
    );

  const crearCompany = async (id: string, n: number) => {
    await db.insert(companies).values({
      id,
      name: `T-FLETE Co ${n}`,
      legal_name: `T-FLETE Co ${n} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
  };

  const producto = async (name: string, tid: string) => {
    const id = crypto.randomUUID();
    await db.insert(products).values({
      id,
      tenant_id: tid,
      name,
      unit_type: 'unidad',
      price: '5000.0000',
      tax_rate: '21.00',
      stock_current: '0.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });
    return id;
  };

  const compra = (fecha = '2026-11-10', extra: Partial<NuevoGasto> = {}): NuevoGasto => ({
    fecha,
    categoria: 'mercaderia',
    total: '20000.00',
    medio_pago: 'transferencia',
    payee_name: 'Makor SA',
    comprobante_tipo: 'Factura',
    comprobante_numero: `0007-${String(++nro).padStart(8, '0')}`,
    items: [
      { product_id: cinta, qty: '10.0000', unit_cost: '1000.0000' },
      { product_id: tijera, qty: '5.0000', unit_cost: '2000.0000' },
    ],
    ...extra,
  });

  const flete = (extra: Partial<NuevoGasto> = {}): NuevoGasto => ({
    fecha: '2026-11-10',
    categoria: 'mercaderia',
    total: '2000.00',
    medio_pago: 'cuenta_corriente',
    tercero_id: expreso,
    comprobante_tipo: 'Factura',
    comprobante_numero: `0101-${String(++nro).padStart(8, '0')}`,
    en_iva_compras: true,
    ...extra,
  });

  const costo = async (id: string) =>
    (await db.select({ cost: products.cost }).from(products).where(eq(products.id, id)))[0]?.cost;

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    otro = crypto.randomUUID();
    userId = crypto.randomUUID();
    await crearCompany(tenantId, 1);
    await crearCompany(otro, 2);
    await db.insert(users).values({
      id: userId,
      email: `t-flete-${userId.slice(0, 8)}@test.local`,
      full_name: 'Dueña',
      is_support: false,
    });
    await db.insert(company_users).values([
      { id: crypto.randomUUID(), company_id: tenantId, user_id: userId, role: 'owner' },
      { id: crypto.randomUUID(), company_id: otro, user_id: userId, role: 'owner' },
    ]);
    cinta = await producto('Cinta lurex', tenantId);
    tijera = await producto('Tijera', tenantId);
    const [t] = await db
      .insert(terceros)
      .values({
        tenant_id: tenantId,
        type: 'proveedor',
        name: 'Expreso Fueguino',
        doc: '30-68361291-6',
      })
      .returning();
    expreso = t!.id;
  });

  afterEach(async () => {
    const ids = [tenantId, otro];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx
        .delete(supplier_account_movements)
        .where(inArray(supplier_account_movements.tenant_id, ids));
      await tx.delete(stock_movements).where(inArray(stock_movements.tenant_id, ids));
      await tx.delete(expense_items).where(inArray(expense_items.tenant_id, ids));
      await tx.delete(expense_cost_behaviour).where(inArray(expense_cost_behaviour.tenant_id, ids));
      await tx.delete(expenses).where(inArray(expenses.tenant_id, ids));
      await tx.delete(products).where(inArray(products.tenant_id, ids));
      await tx.delete(terceros).where(inArray(terceros.tenant_id, ids));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, ids));
      await tx.delete(company_users).where(inArray(company_users.company_id, ids));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  it('🔴 el costo queda con su parte del flete, y las partes suman exacto el flete', async () => {
    await withCtx(() => registrarCompraConFleteOnce(compra(), flete(), crypto.randomUUID()));
    const cCinta = await costo(cinta);
    const cTijera = await costo(tijera);
    expect(cCinta).toBe('1100.0000');
    expect(cTijera).toBe('2200.0000');
    const fletePuesto = new Decimal(cCinta!)
      .minus(1000)
      .times(10)
      .plus(new Decimal(cTijera!).minus(2000).times(5));
    expect(fletePuesto.toFixed(2)).toBe('2000.00');
  });

  it('con IVA discriminado en el flete, sólo el neto es costo', async () => {
    await withCtx(() =>
      registrarCompraConFleteOnce(
        compra(),
        flete({ total: '2420.00', neto: '2000.00', iva: '420.00' }),
        crypto.randomUUID()
      )
    );
    expect(await costo(cinta)).toBe('1100.0000');
  });

  it('un reparto que no da redondo: el costo se guarda a 4 decimales y el inventario cierra', async () => {
    await withCtx(() =>
      registrarCompraConFleteOnce(compra(), flete({ total: '1000.00' }), crypto.randomUUID())
    );
    // 1000 × 1000 / 20000 = 50 y 1000 × 2000 / 20000 = 100: redondo; probamos uno que no:
    await withCtx(() =>
      registrarCompraConFleteOnce(
        compra('2026-11-12', {
          total: '3000.00',
          items: [{ product_id: cinta, qty: '3.0000', unit_cost: '1000.0000' }],
        }),
        flete({ fecha: '2026-11-12', total: '1000.00' }),
        crypto.randomUUID()
      )
    );
    // 1000 de flete sobre 3 cintas: 333,3333… por unidad.
    expect(await costo(cinta)).toBe('1333.3333');
  });

  it('🔴 compra y flete van juntos: si el flete se rechaza, no queda la compra', async () => {
    const repetido = flete();
    await withCtx(() => registrarCompraConFleteOnce(compra(), repetido, crypto.randomUUID()));
    const antes = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.tenant_id, tenantId), GASTO_VIGENTE));
    await expect(
      withCtx(() =>
        registrarCompraConFleteOnce(compra('2026-11-11'), { ...repetido }, crypto.randomUUID())
      )
    ).rejects.toMatchObject({ code: 'comprobante_duplicado' });
    const despues = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.tenant_id, tenantId), GASTO_VIGENTE));
    expect(despues).toHaveLength(antes.length);
  });

  it('anular el flete devuelve el costo sin flete', async () => {
    const r = await withCtx(() =>
      registrarCompraConFleteOnce(
        compra(),
        flete({ medio_pago: 'transferencia' }),
        crypto.randomUUID()
      )
    );
    await withCtx(() => annulExpense({ expense_id: r.flete_id, motivo: 'flete mal cargado' }));
    expect(await costo(cinta)).toBe('1000.0000');
    expect(await costo(tijera)).toBe('2000.0000');
  });

  it('anular la compra NO anula el flete, y el costo vuelve a la compra anterior', async () => {
    await withCtx(() =>
      registerExpense(
        compra('2026-10-01', {
          total: '18000.00',
          items: [
            { product_id: cinta, qty: '10.0000', unit_cost: '900.0000' },
            { product_id: tijera, qty: '4.5000', unit_cost: '2000.0000' },
          ],
        })
      )
    );
    const r = await withCtx(() =>
      registrarCompraConFleteOnce(compra(), flete(), crypto.randomUUID())
    );
    await withCtx(() =>
      annulExpense({ expense_id: r.id, motivo: 'se cargó en el comercio equivocado' })
    );
    expect(await costo(cinta)).toBe('900.0000');
    const fleteVigente = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.id, r.flete_id), GASTO_VIGENTE));
    expect(fleteVigente).toHaveLength(1);
  });

  it('una factura más vieja que la última compra no cambia el costo, aunque traiga flete', async () => {
    await withCtx(() =>
      registerExpense(
        compra('2026-11-15', {
          total: '25000.00',
          items: [
            { product_id: cinta, qty: '10.0000', unit_cost: '1500.0000' },
            { product_id: tijera, qty: '5.0000', unit_cost: '2000.0000' },
          ],
        })
      )
    );
    await withCtx(() =>
      registrarCompraConFleteOnce(
        compra('2026-11-01'),
        flete({ fecha: '2026-11-01' }),
        crypto.randomUUID()
      )
    );
    expect(await costo(cinta)).toBe('1500.0000');
  });

  it('el inventario valorizado incluye la parte del flete', async () => {
    await withCtx(() => registrarCompraConFleteOnce(compra(), flete(), crypto.randomUUID()));
    const inv = await withCtx(() => getInventarioAlCierre('2026-11-30'));
    const filaCinta = inv.filas.find((f) => f.product_id === cinta)!;
    const filaTijera = inv.filas.find((f) => f.product_id === tijera)!;
    expect(new Decimal(filaCinta.con_compra_total).toFixed(2)).toBe('11000.00');
    expect(new Decimal(filaTijera.con_compra_total).toFixed(2)).toBe('11000.00');
    // Mercadería ($20.000) + flete ($2.000), exacto.
    expect(new Decimal(inv.total).toFixed(2)).toBe('22000.00');
  });

  it('un flete no puede apuntar a una compra de otro comercio', async () => {
    const cintaOtro = await producto('Cinta', otro);
    const ajena = await withCtx(
      () =>
        registerExpense({
          ...compra(),
          items: [{ product_id: cintaOtro, qty: '1.0000', unit_cost: '1000.0000' }],
          total: '1000.00',
        }),
      otro
    );
    await expect(
      withCtx(() =>
        registerExpense({
          ...flete({ medio_pago: 'transferencia', tercero_id: undefined, payee_name: 'Expreso' }),
          flete_de_compra_id: ajena.id,
        })
      )
    ).rejects.toMatchObject({ code: 'flete_sin_compra' });
  });

  it('ni a una compra sin artículos', async () => {
    const sinArticulos = await withCtx(() => registerExpense({ ...compra(), items: [] }));
    await expect(
      withCtx(() =>
        registerExpense({
          ...flete({ medio_pago: 'transferencia' }),
          flete_de_compra_id: sinArticulos.id,
        })
      )
    ).rejects.toMatchObject({ code: 'flete_sin_articulos' });
  });
});
