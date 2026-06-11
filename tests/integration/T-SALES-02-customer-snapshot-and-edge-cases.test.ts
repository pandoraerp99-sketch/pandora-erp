/**
 * T-SALES-02 + edge cases post-refactor Bloque 2 — Sales context defenses.
 * Sprint 5 Bloque 4 (2026-06-11).
 *
 * **Por qué este archivo:**
 *
 * El refactor Bloque 2 (finalizeSale → recordStockMovement con skip_audit:true)
 * introdujo 3 edge cases que el advisor 2026-06-04 identificó como sin
 * cobertura. Plus el bug del setSaleCustomer guard que detectamos al
 * preparar el Bloque 4 (no bloqueaba 'cobrada').
 *
 * 4 tests independientes (seed/cleanup por test):
 *
 *   1. customer_snapshot inmutable post-finalize:
 *      setSaleCustomer debe rechazar si sale.commercial_status='cobrada'.
 *      Fix aplicado: guard extendido para bloquear cobrada + draft|in_progress|
 *      cobrando son los únicos permitidos. (T-SALES-02 ROADMAP)
 *
 *   2. ProductInactiveError race window:
 *      addItem filtra is_active=true pero entre addItem y finalize alguien
 *      puede desactivar el producto. recordStockMovement throws
 *      ProductInactiveError. Mapeo a FiscalIntegrityError preserva contrato.
 *      (Edge case advisor 06-04 #1)
 *
 *   3. stock_tracking_enabled=false:
 *      Productos sin tracking de stock NO decrementan stock_current pero
 *      SÍ se inserta una row en stock_movements con stock_changed=false.
 *      Cambio de comportamiento vs código pre-refactor — verificamos
 *      empíricamente que el behavior nuevo funciona end-to-end.
 *      (Edge case advisor 06-04 #2)
 *
 *   4. Multi-item partial failure atomicity:
 *      Sale con N items, uno oversells → tx rollback completo, 0 movements
 *      persistidos, 0 sale_payments, sale stays in_progress, stock de
 *      items previos sin tocar. Garantía atomic del refactor Bloque 2.
 *      (Edge case advisor 06-04 #3)
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
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  createDraftSale,
  addItemToSale,
  finalizeSale,
  setSaleCustomer,
} from '@/lib/services/sales/sale.service';
import {
  FiscalIntegrityError,
  StateTransitionError,
} from '@/lib/multi_tenant/errors';

describe('T-SALES-02 + edge cases post-refactor Bloque 2', () => {
  let tenantId: string;
  let userId: string;

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
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-SALES-02 Test Co',
      legal_name: 'T-SALES-02 Test Co SRL',
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
      email: `t-sales-02-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier T-SALES-02',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });
  });

  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(sale_payments).where(eq(sale_payments.tenant_id, tenantId));
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  // ═════════════════════════════════════════════════════════════════
  //  Test 1 — customer_snapshot inmutable post-finalize (T-SALES-02)
  // ═════════════════════════════════════════════════════════════════
  it('customer_snapshot inmutable post-finalize: setSaleCustomer rechaza si commercial_status=cobrada', async () => {
    // Seed producto + venta + addItem + setCustomer ANTES de finalize
    const productId = crypto.randomUUID();
    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Producto Test 1',
      unit_type: 'unidad',
      price: '100.0000',
      cost: '60.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: '10.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });

    const sale = await withCtx(() => createDraftSale(userId));
    await withCtx(() =>
      addItemToSale({ sale_id: sale.id, product_id: productId, quantity: '1.0000' })
    );
    await withCtx(() =>
      setSaleCustomer({
        sale_id: sale.id,
        doc_type: 'DNI',
        doc_number: '40123456',
        name: 'Cliente Original',
        tax_condition: 'consumidor_final',
      })
    );

    // Finalize
    await withCtx(() =>
      finalizeSale({
        sale_id: sale.id,
        payments: [{ method: 'efectivo', amount: '121.0000' }],
        require_fiscal_invoice: false,
      })
    );

    // Intentar setSaleCustomer DESPUÉS de cobrada → debe rechazar
    let caught: unknown;
    try {
      await withCtx(() =>
        setSaleCustomer({
          sale_id: sale.id,
          doc_type: 'CUIT',
          doc_number: '20401234560',
          name: 'Cliente Falsificado Post-Finalize',
          tax_condition: 'responsable_inscripto',
        })
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(StateTransitionError);

    // Verificar que customer_*_snapshot NO cambió
    const persisted = await db
      .select()
      .from(sales)
      .where(eq(sales.id, sale.id))
      .limit(1);
    expect(persisted[0]?.customer_doc_type).toBe('DNI');
    expect(persisted[0]?.customer_doc_number).toBe('40123456');
    expect(persisted[0]?.customer_name_snapshot).toBe('Cliente Original');
    expect(persisted[0]?.commercial_status).toBe('cobrada');
  });

  // ═════════════════════════════════════════════════════════════════
  //  Test 2 — ProductInactiveError race window (edge case advisor #1)
  // ═════════════════════════════════════════════════════════════════
  it('ProductInactiveError race window: producto desactivado entre addItem y finalize → FiscalIntegrityError mapeado; sale stays in_progress; 0 movements', async () => {
    const productId = crypto.randomUUID();
    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Producto Race Window',
      unit_type: 'unidad',
      price: '100.0000',
      cost: '60.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: '10.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });

    const sale = await withCtx(() => createDraftSale(userId));
    await withCtx(() =>
      addItemToSale({ sale_id: sale.id, product_id: productId, quantity: '2.0000' })
    );

    // Race simulation: alguien desactiva el producto ANTES del finalize
    await db
      .update(products)
      .set({ is_active: false })
      .where(eq(products.id, productId));

    // Intentar finalize → debe rechazar con FiscalIntegrityError (mapeo de
    // ProductInactiveError). El mensaje debe nombrar el producto.
    let caught: unknown;
    try {
      await withCtx(() =>
        finalizeSale({
          sale_id: sale.id,
          payments: [{ method: 'efectivo', amount: '242.0000' }],
          require_fiscal_invoice: false,
        })
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(FiscalIntegrityError);
    if (caught instanceof FiscalIntegrityError) {
      expect(caught.message).toMatch(/desactivado/i);
      expect(caught.message).toMatch(/Producto Race Window/);
    }

    // Sale NO debe quedar cobrada (rollback completo)
    const saleAfter = await db
      .select()
      .from(sales)
      .where(eq(sales.id, sale.id))
      .limit(1);
    expect(saleAfter[0]?.commercial_status).toBe('in_progress');
    expect(saleAfter[0]?.finalized_at).toBeNull();

    // 0 stock_movements (tx completo rollback)
    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.related_sale_id, sale.id));
    expect(movements).toHaveLength(0);

    // 0 sale_payments
    const payments = await db
      .select()
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, sale.id));
    expect(payments).toHaveLength(0);

    // 0 sale.completed audit (rollback)
    const audits = await db
      .select({ id: audit_log.id })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'sale.completed')
        )
      );
    expect(audits).toHaveLength(0);
  });

  // ═════════════════════════════════════════════════════════════════
  //  Test 3 — stock_tracking_enabled=false (edge case advisor #2)
  // ═════════════════════════════════════════════════════════════════
  it('stock_tracking_enabled=false: finalize crea movement con stock_changed=false; stock_current intacto', async () => {
    // Producto SIN tracking de stock (ej: servicio, propina, libre)
    const productId = crypto.randomUUID();
    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Servicio sin stock',
      unit_type: 'unidad',
      price: '500.0000',
      cost: '0.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: '0.0000', // sin stock pero ok porque NO se trackea
      stock_tracking_enabled: false,
      is_active: true,
    });

    const sale = await withCtx(() => createDraftSale(userId));
    await withCtx(() =>
      addItemToSale({ sale_id: sale.id, product_id: productId, quantity: '1.0000' })
    );

    // Finalize debe pasar a pesar de stock_current=0 (no se trackea)
    const result = await withCtx(() =>
      finalizeSale({
        sale_id: sale.id,
        payments: [{ method: 'efectivo', amount: '605.0000' }],
        require_fiscal_invoice: false,
      })
    );

    expect(result.sale.commercial_status).toBe('cobrada');

    // Sprint 5 Bloque 2 cambio comportamiento: ahora SÍ se crea row en
    // stock_movements aunque sea sin tracking. recordStockMovement insert
    // stock_changed=false en la row pero la row existe.
    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.related_sale_id, sale.id));
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe('sale');
    expect(movements[0]?.product_id).toBe(productId);

    // stock_current sigue en 0 (no se decrementa)
    const productAfter = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(productAfter[0]?.stock_current).toBe('0.0000');

    // sale.completed audit contiene el stock_movement_id
    const audits = await db
      .select({ payload: audit_log.payload })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'sale.completed')
        )
      );
    expect(audits).toHaveLength(1);
    const payload = audits[0]?.payload as { stock_movement_ids: string[] };
    expect(payload.stock_movement_ids).toHaveLength(1);
    expect(payload.stock_movement_ids[0]).toBe(String(movements[0]?.id));
  });

  // ═════════════════════════════════════════════════════════════════
  //  Test 4 — Multi-item partial failure atomicity (edge case advisor #3)
  // ═════════════════════════════════════════════════════════════════
  it('multi-item partial failure: sale con 3 items, item 2 oversells → tx rollback completo (0 movements, 0 payments, sale in_progress)', async () => {
    // 3 productos: item 1 y 3 con stock OK, item 2 con stock=0
    const productAId = crypto.randomUUID();
    const productBId = crypto.randomUUID();
    const productCId = crypto.randomUUID();
    await db.insert(products).values([
      {
        id: productAId,
        tenant_id: tenantId,
        name: 'Producto A (stock OK)',
        unit_type: 'unidad',
        price: '100.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        stock_current: '10.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        id: productBId,
        tenant_id: tenantId,
        name: 'Producto B (stock=0)',
        unit_type: 'unidad',
        price: '200.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        stock_current: '0.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        id: productCId,
        tenant_id: tenantId,
        name: 'Producto C (stock OK)',
        unit_type: 'unidad',
        price: '300.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        stock_current: '10.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
    ]);

    const sale = await withCtx(() => createDraftSale(userId));
    await withCtx(() =>
      addItemToSale({ sale_id: sale.id, product_id: productAId, quantity: '1.0000' })
    );
    await withCtx(() =>
      addItemToSale({ sale_id: sale.id, product_id: productBId, quantity: '1.0000' })
    );
    await withCtx(() =>
      addItemToSale({ sale_id: sale.id, product_id: productCId, quantity: '1.0000' })
    );

    // Finalize → item 2 (B) oversells → debe rollback TODO
    // Total esperado si pasara: (100+200+300) * 1.21 = 726
    let caught: unknown;
    try {
      await withCtx(() =>
        finalizeSale({
          sale_id: sale.id,
          payments: [{ method: 'efectivo', amount: '726.0000' }],
          require_fiscal_invoice: false,
        })
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(FiscalIntegrityError);
    if (caught instanceof FiscalIntegrityError) {
      expect(caught.message).toMatch(/Stock insuficiente/);
      expect(caught.message).toMatch(/Producto B/);
    }

    // Sale stays in_progress
    const saleAfter = await db
      .select()
      .from(sales)
      .where(eq(sales.id, sale.id))
      .limit(1);
    expect(saleAfter[0]?.commercial_status).toBe('in_progress');
    expect(saleAfter[0]?.finalized_at).toBeNull();
    expect(saleAfter[0]?.cash_session_id).toBeNull();

    // 0 stock_movements: la atomicidad debe haber revertido el de A también
    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.related_sale_id, sale.id));
    expect(movements).toHaveLength(0);

    // Stock de A y C sin tocar
    const productA = await db
      .select()
      .from(products)
      .where(eq(products.id, productAId))
      .limit(1);
    expect(productA[0]?.stock_current).toBe('10.0000');
    const productC = await db
      .select()
      .from(products)
      .where(eq(products.id, productCId))
      .limit(1);
    expect(productC[0]?.stock_current).toBe('10.0000');

    // 0 sale_payments + 0 sale.completed audit
    const payments = await db
      .select()
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, sale.id));
    expect(payments).toHaveLength(0);

    const audits = await db
      .select({ id: audit_log.id })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'sale.completed')
        )
      );
    expect(audits).toHaveLength(0);
  });
});
