/**
 * T-INV-04 — SELECT FOR UPDATE oversell concurrente.
 * Sprint 3 ROADMAP Inventory — el test más crítico del módulo.
 *
 * **Por qué es CRÍTICO:**
 * `recordStockMovement` usa SELECT FOR UPDATE en `prepareStockMovementValues`
 * wrapper (`runInTx`) para serializar concurrencia y prevenir oversell.
 * Sin verificación empírica de este comportamiento, "oversell prevention"
 * es un claim NO PROBADO.
 *
 * **Escenario real:**
 * Dos cajeros venden simultáneamente el último item del stock.
 *   T1: BEGIN; SELECT stock_current=1 FOR UPDATE; ...
 *   T2: BEGIN; SELECT stock_current FOR UPDATE → BLOQUEA
 *   T1: UPDATE stock_current=0; COMMIT;
 *   T2: SELECT stock_current=0 (relectura post-unlock) → isOversell(0, 1, 'out') = true → throw OversellError
 *
 * **Lo que validamos:**
 * - Exactamente 1 venta succeeds (1 stock_movement insertado)
 * - Exactamente 1 venta rechazada con OversellError
 * - Stock final = 0 (NO negativo)
 * - El stock_movement insertado es de uno solo de los dos sales (no ambos)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { sales } from '@/lib/db/schema/sales';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { recordStockMovement, OversellError } from '@/lib/inventory/stock';

describe('T-INV-04 — SELECT FOR UPDATE oversell concurrente', () => {
  // Genero UUIDs únicos por suite — aislamiento contra otros tests
  // integration que corran en la misma DB sin truncate global.
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const saleAId = crypto.randomUUID();
  const saleBId = crypto.randomUUID();

  beforeAll(async () => {
    // ── Seed company ──
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-INV-04 Test Co',
      legal_name: 'T-INV-04 Test Co SRL',
      // CUIT formato `^[0-9]{11}$` (CHECK constraint companies)
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });

    // ── Seed user ──
    await db.insert(users).values({
      id: userId,
      email: `t-inv-04-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier Test',
      is_support: false,
    });

    // ── Link user ↔ company ──
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });

    // ── Seed product con stock_current = 1.0000 ──
    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Producto único T-INV-04',
      unit_type: 'unidad',
      price: '100.0000',
      cost: '50.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: '1.0000', // ← solo UN item disponible
      stock_minimum: null,
      stock_tracking_enabled: true,
      is_active: true,
    });

    // ── Seed 2 ventas (containers para los movimientos) ──
    const correlationA = generateCorrelationId();
    const correlationB = generateCorrelationId();
    await db.insert(sales).values([
      {
        id: saleAId,
        tenant_id: tenantId,
        correlation_id: correlationA,
        cashier_user_id: userId,
        commercial_status: 'cobrando',
        fiscal_status: 'not_required',
      },
      {
        id: saleBId,
        tenant_id: tenantId,
        correlation_id: correlationB,
        cashier_user_id: userId,
        commercial_status: 'cobrando',
        fiscal_status: 'not_required',
      },
    ]);
  });

  afterAll(async () => {
    // Cleanup en orden inverso de FK dependencies.
    //
    // **Por qué session_replication_role='replica':** el trigger
    // `stock_movements_immutable` (migration 0005, ADR append-only) bloquea
    // DELETE/UPDATE/TRUNCATE en stock_movements. Es el comportamiento correcto
    // en runtime, pero rompe cleanup de tests integration. PG provee un escape
    // hatch: `SET LOCAL session_replication_role = 'replica'` desactiva
    // triggers user-level SOLO para esta sesión (no afecta otras).
    //
    // **Bonus:** el solo hecho de que el cleanup falle sin este trick
    // VALIDA empíricamente que el trigger funciona (T-INV-05 ya parcialmente
    // cubierto). El test dedicado de trigger immutability tiene su propio
    // archivo y NO usa este escape hatch.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('2 ventas concurrentes del último item → exactamente 1 OK + 1 OversellError; stock final 0; 1 movement', async () => {
    // Helper: envuelve recordStockMovement en tracing context.
    const sellOne = (saleId: string) =>
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        () =>
          recordStockMovement({
            product_id: productId,
            type: 'sale',
            qty: 1,
            related_sale_id: saleId,
            skip_audit: true, // Sales context emite 'sale.completed' (no aplica acá)
          })
      );

    // Lanzar las 2 ventas en paralelo. Promise.allSettled → no Promise.all
    // porque sabemos que una va a rechazar.
    const results = await Promise.allSettled([sellOne(saleAId), sellOne(saleBId)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // ── Assert: exactamente 1 + 1 ──
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // ── Assert: el rechazo ES OversellError (no otro error) ──
    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection).toBeInstanceOf(OversellError);
    if (rejection instanceof OversellError) {
      expect(rejection.product_id).toBe(productId);
      expect(rejection.available).toBe('0.0000'); // stock visible post-unlock = 0
      expect(rejection.requested).toBe('1.0000');
    }

    // ── Assert: stock final = 0 (no negativo) ──
    const productAfter = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(productAfter[0]?.stock_current).toBe('0.0000');

    // ── Assert: exactamente 1 stock_movement (de la venta ganadora) ──
    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.product_id, productId));
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe('sale');
    expect(movements[0]?.qty).toBe('1.0000');
    // El movement vincula al sale ganador (uno de los dos, no sabemos cuál a priori)
    expect([saleAId, saleBId]).toContain(movements[0]?.related_sale_id);
  });
});
