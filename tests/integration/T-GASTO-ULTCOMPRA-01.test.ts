/**
 * T-GASTO-ULTCOMPRA-01 — fecha de la última compra de cada producto
 * (`ultimaCompraPorProducto`).
 *
 * La carga de mercadería la usa para anticipar si la factura cambia el costo:
 * una factura más vieja que la última compra suma stock pero no toca el costo.
 * Si esta fecha mintiera, la pantalla anunciaría un costo que el servidor no
 * guarda (o al revés).
 *
 * Lo que se prueba:
 * - devuelve la fecha del comprobante MÁS NUEVO, no la del último cargado;
 * - una compra anulada no cuenta;
 * - un producto nunca comprado no aparece;
 * - otro comercio no ve las compras de éste (CLAUDE.md §7.9 y §18.4);
 * - y la regla coincide con lo que el servidor deja en `products.cost`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses } from '@/lib/db/schema/expenses';
import { expense_items } from '@/lib/db/schema/expense_items';
import { expense_cost_behaviour } from '@/lib/db/schema/expense_cost_behaviour';
import { products } from '@/lib/db/schema/products';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  annulExpense,
  registerExpense,
  ultimaCompraPorProducto,
} from '@/lib/services/expenses/expense.service';

describe('T-GASTO-ULTCOMPRA-01 — última compra por producto', () => {
  let tenantId: string;
  let otro: string;
  let userId: string;
  let cinta: string;
  let tijera: string;
  let cintaOtro: string;
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
      name: `T-ULTCOMPRA Co ${n}`,
      legal_name: `T-ULTCOMPRA Co ${n} SRL`,
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
      price: '1600.0000',
      tax_rate: '21.00',
      stock_current: '0.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });
    return id;
  };

  const comprar = (fecha: string, productId: string, costo: string, tid?: string) =>
    withCtx(
      () =>
        registerExpense({
          fecha,
          categoria: 'mercaderia',
          total: costo,
          medio_pago: 'transferencia',
          payee_name: 'Makor SA',
          comprobante_tipo: 'Factura',
          comprobante_numero: `0007-${String(++nro).padStart(8, '0')}`,
          items: [{ product_id: productId, qty: '1.0000', unit_cost: costo }],
        }),
      tid
    );

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    otro = crypto.randomUUID();
    userId = crypto.randomUUID();
    await crearCompany(tenantId, 1);
    await crearCompany(otro, 2);
    await db.insert(users).values({
      id: userId,
      email: `t-ultcompra-${userId.slice(0, 8)}@test.local`,
      full_name: 'Dueña',
      is_support: false,
    });
    await db.insert(company_users).values([
      { id: crypto.randomUUID(), company_id: tenantId, user_id: userId, role: 'owner' },
      { id: crypto.randomUUID(), company_id: otro, user_id: userId, role: 'owner' },
    ]);
    cinta = await producto('Cinta lurex', tenantId);
    tijera = await producto('Tijera', tenantId);
    cintaOtro = await producto('Cinta lurex', otro);
  });

  afterEach(async () => {
    const ids = [tenantId, otro];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(inArray(stock_movements.tenant_id, ids));
      await tx.delete(expense_items).where(inArray(expense_items.tenant_id, ids));
      await tx.delete(expense_cost_behaviour).where(inArray(expense_cost_behaviour.tenant_id, ids));
      await tx.delete(expenses).where(inArray(expenses.tenant_id, ids));
      await tx.delete(products).where(inArray(products.tenant_id, ids));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, ids));
      await tx.delete(company_users).where(inArray(company_users.company_id, ids));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  it('devuelve la fecha del comprobante más nuevo, aunque se haya cargado antes', async () => {
    await comprar('2026-10-01', cinta, '920.00');
    await comprar('2026-09-15', cinta, '850.00'); // factura vieja cargada después
    const u = await withCtx(() => ultimaCompraPorProducto([cinta, tijera]));
    expect(u).toEqual({ [cinta]: '2026-10-01' });
  });

  it('y coincide con el costo que el servidor deja en el producto', async () => {
    await comprar('2026-10-01', cinta, '920.00');
    await comprar('2026-09-15', cinta, '850.00');
    const [p] = await db
      .select({ cost: products.cost })
      .from(products)
      .where(eq(products.id, cinta));
    // La factura vieja no cambió el costo: es lo que la pantalla anticipa.
    expect(p?.cost).toBe('920.0000');
  });

  it('una compra anulada no cuenta', async () => {
    await comprar('2026-09-15', cinta, '850.00');
    const nueva = await comprar('2026-10-01', cinta, '920.00');
    await withCtx(() =>
      annulExpense({ expense_id: nueva.id, motivo: 'cargada en el comercio equivocado' })
    );
    const u = await withCtx(() => ultimaCompraPorProducto([cinta]));
    expect(u).toEqual({ [cinta]: '2026-09-15' });
  });

  it('otro comercio no ve las compras de éste', async () => {
    await comprar('2026-10-01', cinta, '920.00');
    await comprar('2026-11-01', cintaOtro, '990.00', otro);
    expect(await withCtx(() => ultimaCompraPorProducto([cinta, cintaOtro]))).toEqual({
      [cinta]: '2026-10-01',
    });
    expect(await withCtx(() => ultimaCompraPorProducto([cinta, cintaOtro]), otro)).toEqual({
      [cintaOtro]: '2026-11-01',
    });
  });

  it('sin productos no consulta nada', async () => {
    expect(await withCtx(() => ultimaCompraPorProducto([]))).toEqual({});
  });
});
