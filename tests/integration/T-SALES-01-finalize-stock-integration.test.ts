/**
 * T-SALES-01 — finalizeSale + integración stock_movements (refactor Bloque 2).
 * Sprint 5 ROADMAP Sales+MP context.
 *
 * **Por qué CRÍTICO post-refactor Bloque 2:**
 *
 * El refactor de finalizeSale (commit ce71f6d) reemplazó UPDATE products
 * directo por `recordStockMovement(skip_audit:true)` de Inventory public API.
 * Sin tests integration el refactor pasa typecheck + unit pero NO valida
 * empíricamente que:
 *
 *   1. finalizeSale crea N rows en stock_movements (uno por sale_item)
 *   2. stock_movements.related_sale_id apunta al sale correcto
 *   3. stock_movements.type='sale' + qty correcta + tenant_id correcto
 *   4. audit `sale.completed` payload incluye stock_movement_ids[] (NUEVO Sprint 5)
 *   5. NO se emite `stock.movement_recorded` audit (skip_audit:true respeta J1)
 *   6. Concurrent finalizeSale del último item respeta SELECT FOR UPDATE
 *      (gemelo conceptual T-INV-04 pero desde Sales side)
 *   7. Cross-tenant: tenant B no puede finalizar venta de tenant A
 *
 * **Estructura: 3 tests independientes** — cada uno con su propio seed/cleanup
 * (no compartimos state entre tests, lección advisor T-CASH-05+06).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { sales, sale_items } from '@/lib/db/schema/sales';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  createDraftSale,
  addItemToSale,
  finalizeSale,
} from '@/lib/services/sales/sale.service';
import {
  FiscalIntegrityError,
  NotFoundError,
} from '@/lib/multi_tenant/errors';

describe('T-SALES-01 — finalizeSale + stock_movements integration', () => {
  // Cada test crea sus propios IDs para aislamiento total.
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

  // ── Setup base: 1 tenant + 1 user + 1 producto con stock ───────
  const seedBaseScenario = async (initialStock: string): Promise<void> => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    productId = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-SALES-01 Test Co',
      legal_name: 'T-SALES-01 Test Co SRL',
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
      email: `t-sales-01-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier T-SALES-01',
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
      name: 'Producto venta T-SALES-01',
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

  // Cleanup por test — session_replication_role bypassa trigger immutable
  // stock_movements (acumulan en cada test).
  const cleanupScenario = async (): Promise<void> => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  };

  beforeEach(async () => {
    // Default stock=10. Tests específicos lo sobreescriben con su propio seed.
    await seedBaseScenario('10.0000');
  });

  afterEach(async () => {
    await cleanupScenario();
  });

  it('happy path: createDraft + addItem(qty=3) + finalize → 1 stock_movement + sale.completed con stock_movement_ids[]', async () => {
    // ── createDraft ──
    const sale = await withCtx(tenantId, userId, () => createDraftSale(userId));
    expect(sale.tenant_id).toBe(tenantId);
    expect(sale.commercial_status).toBe('draft');
    expect(sale.fiscal_status).toBe('not_required');

    // ── addItem qty=3 ──
    await withCtx(tenantId, userId, () =>
      addItemToSale({
        sale_id: sale.id,
        product_id: productId,
        quantity: '3.0000',
      })
    );

    // ── finalize ──
    const result = await withCtx(tenantId, userId, () =>
      finalizeSale({
        sale_id: sale.id,
        payment_method: 'efectivo',
        require_fiscal_invoice: false,
      })
    );
    expect(result.sale.commercial_status).toBe('cobrada');
    expect(result.items).toHaveLength(1);

    // ── stock_movement creado ──
    const movements = await db
      .select()
      .from(stock_movements)
      .where(
        and(
          eq(stock_movements.tenant_id, tenantId),
          eq(stock_movements.related_sale_id, sale.id)
        )
      );
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe('sale');
    expect(movements[0]?.qty).toBe('3.0000');
    expect(movements[0]?.product_id).toBe(productId);

    // ── stock_current decrementado de 10 a 7 ──
    const productAfter = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(productAfter[0]?.stock_current).toBe('7.0000');

    // ── sale.completed audit con stock_movement_ids[] ──
    const completedAudits = await db
      .select({ payload: audit_log.payload })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'sale.completed')
        )
      );
    expect(completedAudits).toHaveLength(1);
    const payload = completedAudits[0]?.payload as {
      sale_id: string;
      stock_movement_ids: string[];
    };
    expect(payload.sale_id).toBe(sale.id);
    expect(payload.stock_movement_ids).toBeDefined();
    expect(payload.stock_movement_ids).toHaveLength(1);
    expect(payload.stock_movement_ids[0]).toBe(String(movements[0]?.id));

    // ── NO audit `stock.movement_recorded` (skip_audit:true respeta J1) ──
    const stockAudits = await db
      .select({ id: audit_log.id })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'stock.movement_recorded')
        )
      );
    expect(stockAudits).toHaveLength(0);
  });

  it('concurrent oversell: 2 finalizeSale paralelos del último item → 1 OK + 1 FiscalIntegrityError', async () => {
    // Override seed: stock=1 (último item)
    await cleanupScenario();
    await seedBaseScenario('1.0000');

    // Crear 2 drafts independientes, cada uno con 1 item qty=1
    const sale1 = await withCtx(tenantId, userId, () => createDraftSale(userId));
    await withCtx(tenantId, userId, () =>
      addItemToSale({
        sale_id: sale1.id,
        product_id: productId,
        quantity: '1.0000',
      })
    );

    const sale2 = await withCtx(tenantId, userId, () => createDraftSale(userId));
    await withCtx(tenantId, userId, () =>
      addItemToSale({
        sale_id: sale2.id,
        product_id: productId,
        quantity: '1.0000',
      })
    );

    // Lanzar ambos finalize en paralelo. Promise.allSettled — sabemos que uno
    // va a rechazar por stock insuficiente.
    const finalize = (saleId: string) =>
      withCtx(tenantId, userId, () =>
        finalizeSale({
          sale_id: saleId,
          payment_method: 'efectivo',
          require_fiscal_invoice: false,
        })
      );

    const results = await Promise.allSettled([finalize(sale1.id), finalize(sale2.id)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // ── 1 fulfilled + 1 rejected ──
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // ── el rejection es FiscalIntegrityError (mapeo de OversellError) ──
    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection).toBeInstanceOf(FiscalIntegrityError);
    if (rejection instanceof FiscalIntegrityError) {
      expect(rejection.message).toMatch(/Stock insuficiente/);
    }

    // ── exactly 1 stock_movement (de la sale ganadora) ──
    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.tenant_id, tenantId));
    expect(movements).toHaveLength(1);
    expect(movements[0]?.qty).toBe('1.0000');
    expect([sale1.id, sale2.id]).toContain(movements[0]?.related_sale_id);

    // ── stock final = 0 (NO negativo) ──
    const productAfter = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(productAfter[0]?.stock_current).toBe('0.0000');

    // ── exactly 1 sale.completed audit ──
    const completedAudits = await db
      .select({ id: audit_log.id })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'sale.completed')
        )
      );
    expect(completedAudits).toHaveLength(1);
  });

  it('cross-tenant: tenant B intenta finalizar sale de tenant A → NotFoundError', async () => {
    // Crear segundo tenant
    const tenantBId = crypto.randomUUID();
    const userBId = crypto.randomUUID();
    await db.insert(companies).values({
      id: tenantBId,
      name: 'T-SALES-01 Tenant B',
      legal_name: 'T-SALES-01 Tenant B SRL',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userBId,
      email: `t-sales-01-b-${tenantBId.slice(0, 8)}@test.local`,
      full_name: 'Cashier B',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantBId,
      user_id: userBId,
      role: 'cashier',
    });

    try {
      // Tenant A crea draft + addItem
      const sale = await withCtx(tenantId, userId, () => createDraftSale(userId));
      await withCtx(tenantId, userId, () =>
        addItemToSale({
          sale_id: sale.id,
          product_id: productId,
          quantity: '1.0000',
        })
      );

      // Tenant B intenta finalizar — debe rechazar (NotFoundError)
      let caught: unknown;
      try {
        await withCtx(tenantBId, userBId, () =>
          finalizeSale({
            sale_id: sale.id,
            payment_method: 'efectivo',
            require_fiscal_invoice: false,
          })
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NotFoundError);

      // Sanity: la sale de A SIGUE en in_progress (no fue tocada por B)
      const stillInProgress = await db
        .select({ commercial_status: sales.commercial_status })
        .from(sales)
        .where(eq(sales.id, sale.id))
        .limit(1);
      expect(stillInProgress[0]?.commercial_status).toBe('in_progress');

      // Sanity: stock NO cambió (sigue 10)
      const productUntouched = await db
        .select({ stock_current: products.stock_current })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      expect(productUntouched[0]?.stock_current).toBe('10.0000');

      // Sanity: 0 stock_movements de B intentando finalizar
      const movementsCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(stock_movements)
        .where(eq(stock_movements.tenant_id, tenantBId));
      expect(movementsCount[0]?.count).toBe(0);
    } finally {
      // Cleanup tenant B (cleanupScenario solo limpia tenantId)
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
        await tx
          .delete(company_users)
          .where(eq(company_users.company_id, tenantBId));
        await tx.delete(users).where(eq(users.id, userBId));
        await tx.delete(companies).where(eq(companies.id, tenantBId));
      });
    }
  });
});
