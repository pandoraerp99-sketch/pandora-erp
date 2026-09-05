/**
 * T-SALES-05 — una venta MIXTA se completa de punta a punta.
 *
 * El POS pasó a permitir repartir el cobro entre varios medios (port del
 * spike v20). Antes de este test, nada había ejercido ese camino: se había
 * *leído* que `sale_payments` acepta una fila por pago y que `sale.service`
 * deriva `payment_method='mixto'`, pero **ninguna venta mixta se había creado
 * nunca**. Leer el código no es probarlo.
 *
 * Lo que se fija acá:
 *   1. Dos filas de `sale_payments` con sus medios y montos.
 *   2. `sales.payment_method === 'mixto'` (el denormalizado que se computa en
 *      la CREACIÓN, no sólo en el reclassify).
 *   3. El cierre de caja cuenta SÓLO la parte en efectivo. Si contara la venta
 *      entera por el denormalizado, el arqueo mentiría — y eso es plata.
 *   4. Los montos suman EXACTO el total de la venta.
 *
 * Patrón de seed/cleanup: igual que T-CASH-10 (por test, sin estado compartido).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { sales, sale_items } from '@/lib/db/schema/sales';
import { sale_payments } from '@/lib/db/schema/sale_payments';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  createDraftSale,
  addItemToSale,
  finalizeSale,
} from '@/lib/services/sales/sale.service';
import { openCashSession, closeCashSession } from '@/lib/cash/sessions';

describe('T-SALES-05 — venta con pago mixto', () => {
  let tenantId: string;
  let userId: string;
  let productId: string;

  // `withTracingContext` devuelve `T | Promise<T>` (acepta fn síncronas), así
  // que hay que envolverlo para tipar el await. Los T-CASH-10/11/12 tienen
  // este mismo error sin resolver; acá se hace bien para no propagarlo.
  const withCtx = <T,>(fn: () => Promise<T>): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        fn
      )
    );

  /** Venta de 3 × $100 + IVA 21% = $363. */
  const ventaCon = (payments: Array<{ method: string; amount: string }>) =>
    withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      await addItemToSale({
        sale_id: draft.id,
        product_id: productId,
        quantity: '3.0000',
      });
      return finalizeSale({
        sale_id: draft.id,
        payments,
        require_fiscal_invoice: false,
      });
    });

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    productId = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-SALES-05 Co',
      legal_name: 'T-SALES-05 Co SRL',
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
      email: `t-sales-05-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cajero T-SALES-05',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });
    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Producto T-SALES-05',
      unit_type: 'unidad',
      price: '100.0000',
      cost: '60.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: '100.0000',
      stock_minimum: '5.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });
  });

  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(sale_payments).where(eq(sale_payments.tenant_id, tenantId));
      await tx
        .delete(cash_movements)
        .where(
          sql`${cash_movements.cash_session_id} IN (SELECT id FROM cash_sessions WHERE tenant_id = ${tenantId})`
        );
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tenantId));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('efectivo + débito: 2 filas de pago y el denormalizado queda en "mixto"', async () => {
    const { sale } = await ventaCon([
      { method: 'efectivo', amount: '163.0000' },
      { method: 'debito', amount: '200.0000' },
    ]);

    const filas = await db
      .select()
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, sale.id));

    expect(filas).toHaveLength(2);

    const porMedio = Object.fromEntries(filas.map((f) => [f.method, f.amount]));
    expect(new Decimal(porMedio['efectivo']!).toNumber()).toBe(163);
    expect(new Decimal(porMedio['debito']!).toNumber()).toBe(200);

    // Suman EXACTO el total — el POS recorta lo entregado de más (vuelto).
    const suma = filas.reduce((s, f) => s.plus(f.amount), new Decimal(0));
    expect(suma.toNumber()).toBe(363);

    // El denormalizado se computa en la CREACIÓN, no sólo al reclasificar.
    const [guardada] = await db
      .select({ metodo: sales.payment_method })
      .from(sales)
      .where(eq(sales.id, sale.id));
    expect(guardada?.metodo).toBe('mixto');
  });

  it('el cierre de caja cuenta SÓLO la parte en efectivo de la venta mixta', async () => {
    // Es la pregunta que decide si el multi-medio era seguro de habilitar: si
    // el arqueo tomara la venta entera (por el denormalizado 'mixto'), el
    // cajero vería $200 de más en la caja y el descuadre sería inexplicable.
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );

    await ventaCon([
      { method: 'efectivo', amount: '163.0000' },
      { method: 'debito', amount: '200.0000' },
    ]);

    const cierre = await withCtx(() =>
      closeCashSession({
        session_id: session.id,
        counted_amount: '1163.0000', // apertura 1000 + SÓLO los 163 en efectivo
      })
    );

    // Lo esperado es 1163, NO 1363: los $200 de débito no entran a la caja.
    expect(new Decimal(cierre.session.expected_amount!).toNumber()).toBe(1163);
    // Y por lo tanto no hay descuadre.
    expect(new Decimal(cierre.session.descuadre!).toNumber()).toBe(0);
  });

  it('un solo medio NO queda como "mixto"', async () => {
    // Guarda del caso simple: el multi-medio no debe cambiar el camino normal.
    const { sale } = await ventaCon([{ method: 'efectivo', amount: '363.0000' }]);

    const [guardada] = await db
      .select({ metodo: sales.payment_method })
      .from(sales)
      .where(eq(sales.id, sale.id));

    expect(guardada?.metodo).toBe('efectivo');
  });

  it('tres medios a la vez también funcionan', async () => {
    const { sale } = await ventaCon([
      { method: 'efectivo', amount: '63.0000' },
      { method: 'debito', amount: '150.0000' },
      { method: 'credito', amount: '150.0000' },
    ]);

    const filas = await db
      .select()
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, sale.id));

    expect(filas).toHaveLength(3);
    const suma = filas.reduce((s, f) => s.plus(f.amount), new Decimal(0));
    expect(suma.toNumber()).toBe(363);
  });
});
