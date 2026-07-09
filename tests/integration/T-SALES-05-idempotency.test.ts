/**
 * T-SALES-05 — finalizeSale + idempotency wiring (ADR-0010 en el punto de cobro).
 * Sprint 5 Sales+MP context — cierre no-fiscal.
 *
 * **Por qué CRÍTICO:**
 *
 * El backend de venta estaba probado (T-SALES-01..04) pero `finalizeSale` no
 * tenía protección de idempotencia. Un doble-click en "Cobrar" o un retry de
 * red concurrente = doble cobro + doble decremento de stock. El primitivo
 * `withIdempotency` (reserve-first, ADR-0010) estaba construido pero SIN
 * cablear al punto de cobro. Este test valida empíricamente el cableado:
 *
 *   IDEM-01 replay secuencial   → 2da llamada misma key devuelve cobrada
 *                                  cacheada, SIN doble efecto.
 *   IDEM-02 dedup concurrente   → 2 finalize paralelos misma key → efecto
 *                                  exactamente 1 vez (el duplicado NO cobra).
 *   IDEM-03 key reuse           → misma key + params distintos → rechazo
 *                                  (IdempotencyKeyReuseError) ANTES del cobro.
 *   IDEM-04 sin key             → backward compat: funciona, sin idempotency_log.
 *
 * Cada test con su propio seed/cleanup (lección advisor T-CASH-05/06). Cleanup
 * en session_replication_role='replica' (desactiva FK + triggers immutables).
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
import { audit_log } from '@/lib/db/schema/audit';
import { idempotency_log } from '@/lib/db/schema/idempotency_log';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  createDraftSale,
  addItemToSale,
  finalizeSale,
} from '@/lib/services/sales/sale.service';
import {
  FiscalIntegrityError,
  IdempotencyInProgressError,
  IdempotencyKeyReuseError,
} from '@/lib/multi_tenant/errors';

describe('T-SALES-05 — finalizeSale idempotency wiring', () => {
  let tenantId: string;
  let userId: string;
  let productId: string;

  const withCtx = async <T,>(
    tenant_id: string,
    actor_user_id: string,
    fn: () => Promise<T>
  ): Promise<T> =>
    withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id,
        actor_user_id,
        actor_type: 'user',
      },
      fn
    );

  const seedBaseScenario = async (initialStock: string): Promise<void> => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    productId = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-SALES-05 Test Co',
      legal_name: 'T-SALES-05 Test Co SRL',
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
      full_name: 'Cashier T-SALES-05',
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
      name: 'Producto venta T-SALES-05',
      unit_type: 'unidad',
      price: '100.0000',
      cost: '60.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: initialStock,
      stock_minimum: '1.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });
  };

  const cleanupScenario = async (): Promise<void> => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(idempotency_log).where(eq(idempotency_log.tenant_id, tenantId));
      await tx.delete(sale_payments).where(eq(sale_payments.tenant_id, tenantId));
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  };

  // Helper: draft + addItem(qty) → devuelve sale_id listo para finalizar.
  const draftWithItem = async (qty: string): Promise<string> => {
    const sale = await withCtx(tenantId, userId, () => createDraftSale(userId));
    await withCtx(tenantId, userId, () =>
      addItemToSale({ sale_id: sale.id, product_id: productId, quantity: qty })
    );
    return sale.id;
  };

  beforeEach(async () => {
    await seedBaseScenario('10.0000');
  });

  afterEach(async () => {
    await cleanupScenario();
  });

  it('IDEM-01 replay secuencial: misma key 2 veces → cobrada cacheada, SIN doble efecto', async () => {
    const saleId = await draftWithItem('3.0000'); // 3 * 100 * 1.21 = 363
    const key = crypto.randomUUID();
    const input = {
      sale_id: saleId,
      payments: [{ method: 'efectivo' as const, amount: '363.0000' }],
      require_fiscal_invoice: false,
      idempotency_key: key,
    };

    const r1 = await withCtx(tenantId, userId, () => finalizeSale(input));
    expect(r1.sale.commercial_status).toBe('cobrada');

    // 2da llamada IDÉNTICA → replay (NO re-ejecuta el cobro).
    const r2 = await withCtx(tenantId, userId, () => finalizeSale(input));
    expect(r2.sale.commercial_status).toBe('cobrada');
    expect(r2.sale.id).toBe(saleId);

    // ── Efectos exactamente 1 vez ──
    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.related_sale_id, saleId));
    expect(movements).toHaveLength(1);

    const productAfter = await db
      .select({ stock: products.stock_current })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(productAfter[0]?.stock).toBe('7.0000'); // 10 - 3, NO 10 - 6

    const payments = await db
      .select({ id: sale_payments.id })
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, saleId));
    expect(payments).toHaveLength(1);

    const completed = await db
      .select({ id: audit_log.id })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'sale.completed')
        )
      );
    expect(completed).toHaveLength(1);

    // ── idempotency_log: 1 row completed ──
    const idem = await db
      .select({ status: idempotency_log.status, operation: idempotency_log.operation })
      .from(idempotency_log)
      .where(
        and(
          eq(idempotency_log.tenant_id, tenantId),
          eq(idempotency_log.idempotency_key, key)
        )
      );
    expect(idem).toHaveLength(1);
    expect(idem[0]?.status).toBe('completed');
    expect(idem[0]?.operation).toBe('sale.finalize');
  });

  it('IDEM-02 dedup concurrente: 2 finalize paralelos misma key → efecto 1 sola vez', async () => {
    const saleId = await draftWithItem('1.0000'); // 1 * 100 * 1.21 = 121
    const key = crypto.randomUUID();
    const input = {
      sale_id: saleId,
      payments: [{ method: 'efectivo' as const, amount: '121.0000' }],
      require_fiscal_invoice: false,
      idempotency_key: key,
    };

    const call = () => withCtx(tenantId, userId, () => finalizeSale(input));
    const results = await Promise.allSettled([call(), call()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Al menos 1 fulfilled (el ganador, cobrada). El otro: rechazado
    // (IdempotencyInProgressError si vio 'pending') o fulfilled-replayed
    // (si el ganador terminó antes del INSERT del duplicado). Ambos
    // interleavings son válidos — lo que NO puede pasar es doble efecto.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
        IdempotencyInProgressError
      );
    }
    for (const r of fulfilled) {
      expect(
        (r as PromiseFulfilledResult<{ sale: { commercial_status: string } }>)
          .value.sale.commercial_status
      ).toBe('cobrada');
    }

    // ── Efecto exactamente 1 vez (la invariante dura) ──
    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.related_sale_id, saleId));
    expect(movements).toHaveLength(1);

    const productAfter = await db
      .select({ stock: products.stock_current })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(productAfter[0]?.stock).toBe('9.0000'); // 10 - 1

    const payments = await db
      .select({ id: sale_payments.id })
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, saleId));
    expect(payments).toHaveLength(1);

    const completed = await db
      .select({ id: audit_log.id })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'sale.completed')
        )
      );
    expect(completed).toHaveLength(1);
  });

  it('IDEM-03 key reuse: misma key + params distintos → IdempotencyKeyReuseError, SIN 2do cobro', async () => {
    const saleId = await draftWithItem('3.0000'); // 363
    const key = crypto.randomUUID();

    await withCtx(tenantId, userId, () =>
      finalizeSale({
        sale_id: saleId,
        payments: [{ method: 'efectivo' as const, amount: '363.0000' }],
        require_fiscal_invoice: false,
        idempotency_key: key,
      })
    );

    // Misma key, monto distinto → request_hash distinto → reuse detectado.
    let caught: unknown;
    try {
      await withCtx(tenantId, userId, () =>
        finalizeSale({
          sale_id: saleId,
          payments: [{ method: 'efectivo' as const, amount: '999.0000' }],
          require_fiscal_invoice: false,
          idempotency_key: key,
        })
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IdempotencyKeyReuseError);

    // Sin 2do efecto: stock sigue 7, 1 movimiento, 1 pago.
    const productAfter = await db
      .select({ stock: products.stock_current })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(productAfter[0]?.stock).toBe('7.0000');

    const movements = await db
      .select({ id: stock_movements.id })
      .from(stock_movements)
      .where(eq(stock_movements.related_sale_id, saleId));
    expect(movements).toHaveLength(1);

    const payments = await db
      .select({ id: sale_payments.id })
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, saleId));
    expect(payments).toHaveLength(1);
  });

  it('IDEM-05 retry tras error: finalize falla (oversell) → misma key NO queda envenenada → retry cobra', async () => {
    // Stock 1, cart qty 2 → el 1er finalize tira oversell (FiscalIntegrityError).
    // finalizeSaleCore es transaccional → rollback limpio + releaseOnError libera
    // la key. El cajero repone stock y reintenta con la MISMA key → cobra.
    await cleanupScenario();
    await seedBaseScenario('1.0000');
    const saleId = await draftWithItem('2.0000'); // qty 2 > stock 1
    const key = crypto.randomUUID();
    const input = {
      sale_id: saleId,
      payments: [{ method: 'efectivo' as const, amount: '242.0000' }], // 2 * 100 * 1.21
      require_fiscal_invoice: false,
      idempotency_key: key,
    };

    // 1er intento → oversell.
    let caught: unknown;
    try {
      await withCtx(tenantId, userId, () => finalizeSale(input));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FiscalIntegrityError);

    // La key fue LIBERADA (no envenenada) — sin esto el retry daría InProgress.
    const afterFail = await db
      .select({ id: idempotency_log.id })
      .from(idempotency_log)
      .where(
        and(
          eq(idempotency_log.tenant_id, tenantId),
          eq(idempotency_log.idempotency_key, key)
        )
      );
    expect(afterFail).toHaveLength(0);

    // Reponer stock y reintentar con la MISMA key → ahora cobra.
    await db
      .update(products)
      .set({ stock_current: '5.0000' })
      .where(eq(products.id, productId));

    const r = await withCtx(tenantId, userId, () => finalizeSale(input));
    expect(r.sale.commercial_status).toBe('cobrada');

    // Efecto exactamente 1 vez tras el retry exitoso: stock 5 - 2 = 3.
    const productAfter = await db
      .select({ stock: products.stock_current })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(productAfter[0]?.stock).toBe('3.0000');

    const movements = await db
      .select({ id: stock_movements.id })
      .from(stock_movements)
      .where(eq(stock_movements.related_sale_id, saleId));
    expect(movements).toHaveLength(1);

    const idem = await db
      .select({ status: idempotency_log.status })
      .from(idempotency_log)
      .where(
        and(
          eq(idempotency_log.tenant_id, tenantId),
          eq(idempotency_log.idempotency_key, key)
        )
      );
    expect(idem).toHaveLength(1);
    expect(idem[0]?.status).toBe('completed');
  });

  it('IDEM-04 backward compat: finalize SIN key funciona y NO crea idempotency_log', async () => {
    const saleId = await draftWithItem('3.0000');

    const r = await withCtx(tenantId, userId, () =>
      finalizeSale({
        sale_id: saleId,
        payments: [{ method: 'efectivo' as const, amount: '363.0000' }],
        require_fiscal_invoice: false,
      })
    );
    expect(r.sale.commercial_status).toBe('cobrada');

    const idem = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(idempotency_log)
      .where(eq(idempotency_log.tenant_id, tenantId));
    expect(idem[0]?.count).toBe(0);
  });
});
