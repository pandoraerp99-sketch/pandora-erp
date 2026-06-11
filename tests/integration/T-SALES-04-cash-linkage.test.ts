/**
 * T-SALES-04 — Sales↔Cash linkage + closeCashSession auto-compute.
 * Sprint 5 ROADMAP Bloque 3d (2026-06-09).
 *
 * **Por qué CRÍTICO:**
 *
 * Bloques 3a/3b/3c introdujeron 3 cambios estructurales:
 *   3a → sales.sale_point para que finalizeSale lookup cash_session correcta
 *   3b → payments[] array + INSERT sale_payments + linkea cash_session_id
 *        cuando hay payment efectivo y existe session activa
 *   3c → closeCashSession.expected_amount opcional + auto-compute desde
 *        sale_payments(efectivo) + cash_movements(deposit/withdraw/provider_payment)
 *
 * T-SALES-04 valida empíricamente el flow end-to-end Sales↔Cash:
 *   - Abrir cash_session, hacer ventas con efectivo → sales linkean cash_session_id
 *   - Multi-pago (efectivo + tarjeta) → solo el efectivo afecta la caja
 *   - Sin cash_session abierta → sales acepta efectivo igual, queda sin link
 *   - closeCashSession sin expected_amount → auto-compute correcto desde activity
 *
 * **Patrón:** sigue T-SALES-01 y T-CASH-08 (seed/cleanup por test, sin shared state).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
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
import { registerCashMovement } from '@/lib/cash/movements';

describe('T-SALES-04 — Sales↔Cash linkage + closeCashSession auto-compute', () => {
  let tenantId: string;
  let userId: string;
  let productId: string;

  const withCtx = async <T,>(fn: () => Promise<T>): Promise<T> =>
    withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      fn
    );

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    productId = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-SALES-04 Test Co',
      legal_name: 'T-SALES-04 Test Co SRL',
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
      email: `t-sales-04-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier T-SALES-04',
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
      name: 'Producto T-SALES-04',
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
          sql`${cash_movements.cash_session_id} IN (
            SELECT id FROM cash_sessions WHERE tenant_id = ${tenantId}
          )`
        );
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('happy linkage: cash_session abierta + venta cash → sales+sale_payments linkean cash_session_id; audit incluye payments granulares + sale_payment_ids + cash_session_id', async () => {
    // ── Abrir cash_session sp=1 con initial=1000 ──
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );
    expect(session.sale_point).toBe(1);
    expect(session.initial_amount).toBe('1000.0000');

    // ── Crear venta en sp=1 + addItem(qty=3) ──
    const sale = await withCtx(() => createDraftSale(userId, 1));
    expect(sale.sale_point).toBe(1);

    await withCtx(() =>
      addItemToSale({
        sale_id: sale.id,
        product_id: productId,
        quantity: '3.0000',
      })
    );

    // ── Finalizar con efectivo (qty=3 * 100 * 1.21 = 363) ──
    const result = await withCtx(() =>
      finalizeSale({
        sale_id: sale.id,
        payments: [{ method: 'efectivo', amount: '363.0000' }],
        require_fiscal_invoice: false,
      })
    );

    // ── Sale linkea cash_session_id ──
    expect(result.sale.cash_session_id).toBe(session.id);
    expect(result.sale.payment_method).toBe('efectivo');
    expect(result.sale.commercial_status).toBe('cobrada');

    // ── sale_payments tiene 1 row con cash_session_id linkeado ──
    const payments = await db
      .select()
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, sale.id));
    expect(payments).toHaveLength(1);
    expect(payments[0]?.method).toBe('efectivo');
    expect(payments[0]?.amount).toBe('363.0000');
    expect(payments[0]?.cash_session_id).toBe(session.id);
    expect(payments[0]?.mp_payment_external_id).toBeNull();

    // ── Audit sale.completed payload tiene cash_session_id + sale_payment_ids + payments ──
    const auditRows = await db
      .select({ payload: audit_log.payload })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'sale.completed')
        )
      );
    expect(auditRows).toHaveLength(1);
    const payload = auditRows[0]?.payload as {
      cash_session_id: string;
      sale_payment_ids: string[];
      payments: Array<{ method: string; amount: string; mp_payment_external_id: string | null }>;
    };
    expect(payload.cash_session_id).toBe(session.id);
    expect(payload.sale_payment_ids).toHaveLength(1);
    expect(payload.sale_payment_ids[0]).toBe(payments[0]?.id);
    expect(payload.payments).toEqual([
      { method: 'efectivo', amount: '363.0000', mp_payment_external_id: null },
    ]);
  });

  it('multi-pago efectivo+tarjeta: sales.payment_method=mixto; solo efectivo linkea cash_session_id', async () => {
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '500.0000' })
    );

    const sale = await withCtx(() => createDraftSale(userId, 1));
    await withCtx(() =>
      addItemToSale({
        sale_id: sale.id,
        product_id: productId,
        quantity: '5.0000',
      })
    );

    // qty=5 * 100 * 1.21 = 605. Pago 300 cash + 305 tarjeta.
    const result = await withCtx(() =>
      finalizeSale({
        sale_id: sale.id,
        payments: [
          { method: 'efectivo', amount: '300.0000' },
          { method: 'tarjeta', amount: '305.0000' },
        ],
        require_fiscal_invoice: false,
      })
    );

    // ── sales.payment_method denormalizado = 'mixto' ──
    expect(result.sale.payment_method).toBe('mixto');
    // ── sales.cash_session_id linkea (porque hay efectivo) ──
    expect(result.sale.cash_session_id).toBe(session.id);

    // ── sale_payments tiene 2 rows; solo efectivo linkea cash_session_id ──
    const payments = await db
      .select()
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, sale.id))
      .orderBy(sale_payments.method);
    expect(payments).toHaveLength(2);

    const cashPayment = payments.find((p) => p.method === 'efectivo');
    const cardPayment = payments.find((p) => p.method === 'tarjeta');
    expect(cashPayment?.amount).toBe('300.0000');
    expect(cashPayment?.cash_session_id).toBe(session.id);
    expect(cardPayment?.amount).toBe('305.0000');
    expect(cardPayment?.cash_session_id).toBeNull();

    // ── sales.payment_breakdown JSON contiene ambos ──
    const breakdown = result.sale.payment_breakdown!;
    expect(breakdown).toMatch(/efectivo/);
    expect(breakdown).toMatch(/tarjeta/);
  });

  it('sin cash_session abierta: finalize con efectivo igual finaliza pero cash_session_id=null en sales y sale_payments', async () => {
    // NO abrimos cash_session
    const sale = await withCtx(() => createDraftSale(userId, 1));
    await withCtx(() =>
      addItemToSale({
        sale_id: sale.id,
        product_id: productId,
        quantity: '2.0000',
      })
    );

    // qty=2 * 100 * 1.21 = 242
    const result = await withCtx(() =>
      finalizeSale({
        sale_id: sale.id,
        payments: [{ method: 'efectivo', amount: '242.0000' }],
        require_fiscal_invoice: false,
      })
    );

    // ── Venta finaliza igual con cash_session_id=null ──
    expect(result.sale.commercial_status).toBe('cobrada');
    expect(result.sale.cash_session_id).toBeNull();

    // ── sale_payments existe pero sin cash_session_id ──
    const payments = await db
      .select()
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, sale.id));
    expect(payments).toHaveLength(1);
    expect(payments[0]?.method).toBe('efectivo');
    expect(payments[0]?.cash_session_id).toBeNull();
  });

  it('closeCashSession sin expected_amount → auto-compute desde initial + cash_payments + movements', async () => {
    // ── Setup: initial=1000, deposit=100, withdraw=50, venta cash 363 ──
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );

    await withCtx(() =>
      registerCashMovement({
        cash_session_id: session.id,
        type: 'deposit',
        amount: '100.0000',
        reason: 'cambio adicional',
      })
    );
    await withCtx(() =>
      registerCashMovement({
        cash_session_id: session.id,
        type: 'withdraw',
        amount: '50.0000',
        reason: 'gasto operativo',
      })
    );

    // Venta con efectivo 363
    const sale = await withCtx(() => createDraftSale(userId, 1));
    await withCtx(() =>
      addItemToSale({
        sale_id: sale.id,
        product_id: productId,
        quantity: '3.0000',
      })
    );
    await withCtx(() =>
      finalizeSale({
        sale_id: sale.id,
        payments: [{ method: 'efectivo', amount: '363.0000' }],
        require_fiscal_invoice: false,
      })
    );

    // ── Cerrar SIN expected_amount → auto-compute ──
    // expected = 1000 + 363 (cash sale) + 100 (deposit) - 50 (withdraw) = 1413
    // Cajero cuenta físicamente 1413 → descuadre 0
    const closeResult = await withCtx(() =>
      closeCashSession({
        session_id: session.id,
        counted_amount: '1413.0000',
        // expected_amount NO se pasa — auto-compute
      })
    );

    expect(closeResult.session.expected_amount).toBe('1413.0000');
    expect(closeResult.session.final_amount).toBe('1413.0000');
    expect(closeResult.descuadre).toBe('0.0000');
    expect(closeResult.descuadre_sign).toBe('zero');
    expect(closeResult.session.discrepancy_reason).toBeNull();
  });

  it('closeCashSession auto-compute: provider_payment también resta; tarjeta NO afecta caja', async () => {
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '500.0000' })
    );

    // 1 provider_payment $200 (resta caja)
    await withCtx(() =>
      registerCashMovement({
        cash_session_id: session.id,
        type: 'provider_payment',
        amount: '200.0000',
        reason: 'pago al proveedor de gaseosas',
      })
    );

    // Venta multi-pago efectivo+tarjeta — solo efectivo afecta caja
    const sale = await withCtx(() => createDraftSale(userId, 1));
    await withCtx(() =>
      addItemToSale({
        sale_id: sale.id,
        product_id: productId,
        quantity: '5.0000',
      })
    );
    await withCtx(() =>
      finalizeSale({
        sale_id: sale.id,
        payments: [
          { method: 'efectivo', amount: '200.0000' },
          { method: 'tarjeta', amount: '405.0000' },
        ],
        require_fiscal_invoice: false,
      })
    );

    // expected = 500 + 200 (cash sale) - 200 (provider_payment) = 500
    // Tarjeta 405 NO entra en cálculo (no afecta caja física).
    const closeResult = await withCtx(() =>
      closeCashSession({
        session_id: session.id,
        counted_amount: '500.0000',
      })
    );

    expect(closeResult.session.expected_amount).toBe('500.0000');
    expect(closeResult.descuadre).toBe('0.0000');
    expect(closeResult.descuadre_sign).toBe('zero');
  });

  it('expected_amount override explícito: si caller lo pasa, NO se hace auto-compute', async () => {
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );

    // Venta cash 363 — el auto-compute daría 1363
    const sale = await withCtx(() => createDraftSale(userId, 1));
    await withCtx(() =>
      addItemToSale({
        sale_id: sale.id,
        product_id: productId,
        quantity: '3.0000',
      })
    );
    await withCtx(() =>
      finalizeSale({
        sale_id: sale.id,
        payments: [{ method: 'efectivo', amount: '363.0000' }],
        require_fiscal_invoice: false,
      })
    );

    // Caller pasa expected_amount override = 1500 (no es 1363 ni 1413)
    // El service debe respetar ese valor.
    const closeResult = await withCtx(() =>
      closeCashSession({
        session_id: session.id,
        counted_amount: '1363.0000',
        expected_amount: '1500.0000', // override manual del cajero
        discrepancy_reason: 'cajero cree que vino $1500 inicial pero schema dice 1000',
      })
    );

    expect(closeResult.session.expected_amount).toBe('1500.0000');
    // descuadre = counted - expected = 1363 - 1500 = -137
    expect(closeResult.descuadre).toBe('-137.0000');
    expect(closeResult.descuadre_sign).toBe('negative');
  });
});
