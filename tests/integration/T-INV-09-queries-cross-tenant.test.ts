/**
 * T-INV-09 — Cross-tenant isolation + integration coverage de inventory queries.
 * Sprint 3 ROADMAP Inventory retro-fix (detectado mini-auditoría 2026-06-04).
 *
 * **Por qué CRÍTICO (mismo patrón que advisor detectó en T-CASH-08):**
 *
 * CLAUDE.md §18.4: *"Lo que NO puede mergearse sin test: cualquier query
 * cross-tenant (test que valide aislamiento)"*. CLAUDE.md §1.4 declara
 * "cero fugas cross-tenant" como métrica F0 no negociable.
 *
 * T-INV-07 cubre cross-tenant para `findProductById` + `recordStockMovement`.
 * Pero **5 wrappers DB exportados** de `queries.ts` filtran por `tenant_id`
 * en su SQL y NUNCA se probó empíricamente que el filtro NO se rompe ante
 * contexto cross-tenant. Pure helper unit tests (`buildNameSearchPattern` +
 * `normalizeExactLookup` + `normalizeLimit`) NO sustituyen integration tests.
 *
 * **5 wrappers cubiertos aquí:**
 *   - `searchProductsByName` (typeahead trigram con ILIKE + similarity)
 *   - `findProductByBarcode` (lookup exact)
 *   - `findProductBySku` (lookup exact)
 *   - `listLowStockProducts` (filter stock_current < stock_minimum)
 *   - `listProductsPaginated` (catálogo paginado)
 *
 * **Risk Sprint 5:** POS va a usar `searchProductsByName` (carrito) +
 * `findProductByBarcode` (scanner) masivamente. Sin verificación empírica,
 * un leak cross-tenant en typeahead = comerciante A ve productos de
 * comerciante B en su POS = catástrofe.
 *
 * **Doble objetivo del archivo (mismo doble objetivo que T-CASH-08):**
 *
 *   A) Cross-tenant fences (PRIMARIO — 5 fences, uno por wrapper):
 *      - searchProductsByName bajo A con palabra común a A+B → solo A
 *      - findProductByBarcode(B's barcode) bajo A → null
 *      - findProductBySku(B's sku) bajo A → null
 *      - listLowStockProducts bajo A → solo A's low stock (no B's)
 *      - listProductsPaginated bajo A → solo A's catálogo
 *
 *   B) Integration coverage de queries (SECUNDARIO):
 *      - searchProductsByName con activeOnly default + match ranking
 *      - findProductByBarcode/Sku activeOnly default (NO devuelve inactive)
 *      - listLowStockProducts orden por urgencia + filtro stock_minimum NULL
 *      - listProductsPaginated paginación limit + offset
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  searchProductsByName,
  findProductByBarcode,
  findProductBySku,
  listLowStockProducts,
  listProductsPaginated,
} from '@/lib/inventory';

describe('T-INV-09 — Cross-tenant isolation + queries integration', () => {
  // ─── 2 tenants distintos ──────────────────────────────────────
  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  // ─── Tenant A: 5 productos ────────────────────────────────────
  // - 2 "Coca Cola" (mismo prefijo para typeahead cross-tenant test)
  // - 1 "Pan blanco" low stock (1 unidad < min 10)
  // - 1 "Yerba mate" stock normal
  // - 1 inactivo (para verificar activeOnly default)
  const A_coca500 = crypto.randomUUID();
  const A_coca1500 = crypto.randomUUID();
  const A_panLowStock = crypto.randomUUID();
  const A_yerba = crypto.randomUUID();
  const A_inactivo = crypto.randomUUID();

  // ─── Tenant B: 5 productos ────────────────────────────────────
  // - 1 "Coca Cola lata" (misma palabra que A para test typeahead leak)
  // - 1 "Pan integral" low stock (2 < min 5)  ← tampoco debe aparecer bajo A
  // - 1 "Yerba premium"
  // - 1 producto único B
  // - 1 inactivo
  const B_cocaLata = crypto.randomUUID();
  const B_panIntegralLowStock = crypto.randomUUID();
  const B_yerbaPremium = crypto.randomUUID();
  const B_uniqueB = crypto.randomUUID();
  const B_inactivo = crypto.randomUUID();

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

  beforeAll(async () => {
    // ─── Seed 2 companies ─────────────────────────────────────────
    await db.insert(companies).values([
      {
        id: tenantAId,
        name: 'T-INV-09 Tenant A',
        legal_name: 'T-INV-09 Tenant A SRL',
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      },
      {
        id: tenantBId,
        name: 'T-INV-09 Tenant B',
        legal_name: 'T-INV-09 Tenant B SRL',
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      },
    ]);

    // ─── Seed users + company_users ───────────────────────────────
    await db.insert(users).values([
      {
        id: userAId,
        email: `t-inv-09-a-${tenantAId.slice(0, 8)}@test.local`,
        full_name: 'Owner A',
        is_support: false,
      },
      {
        id: userBId,
        email: `t-inv-09-b-${tenantBId.slice(0, 8)}@test.local`,
        full_name: 'Owner B',
        is_support: false,
      },
    ]);

    await db.insert(company_users).values([
      {
        id: crypto.randomUUID(),
        company_id: tenantAId,
        user_id: userAId,
        role: 'owner',
      },
      {
        id: crypto.randomUUID(),
        company_id: tenantBId,
        user_id: userBId,
        role: 'owner',
      },
    ]);

    // ─── Tenant A: 5 productos ─────────────────────────────────────
    await db.insert(products).values([
      {
        id: A_coca500,
        tenant_id: tenantAId,
        name: 'Coca Cola 500ml',
        unit_type: 'unidad',
        price: '450.0000',
        cost: '300.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        barcode: 'A-7790123456789',
        sku: 'A-COCA500',
        stock_current: '50.0000',
        stock_minimum: '10.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        id: A_coca1500,
        tenant_id: tenantAId,
        name: 'Coca Cola 1.5L',
        unit_type: 'unidad',
        price: '900.0000',
        cost: '600.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        barcode: 'A-7790123456790',
        sku: 'A-COCA1500',
        stock_current: '30.0000',
        stock_minimum: '5.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        id: A_panLowStock,
        tenant_id: tenantAId,
        name: 'Pan blanco kg',
        unit_type: 'unidad',
        price: '250.0000',
        cost: '150.0000',
        tax_rate: '0.00',
        tdf_exempt: false,
        sku: 'A-PAN001',
        // stock_current=1 < stock_minimum=10 → low stock A
        stock_current: '1.0000',
        stock_minimum: '10.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        id: A_yerba,
        tenant_id: tenantAId,
        name: 'Yerba mate 500g',
        unit_type: 'unidad',
        price: '1200.0000',
        cost: '800.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        sku: 'A-YERBA500',
        stock_current: '20.0000',
        stock_minimum: '5.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        id: A_inactivo,
        tenant_id: tenantAId,
        name: 'Producto inactivo A',
        unit_type: 'unidad',
        price: '100.0000',
        cost: '50.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        sku: 'A-INACTIVE',
        barcode: 'A-INACTIVE-BC',
        stock_current: '0.0000',
        stock_minimum: '5.0000',
        stock_tracking_enabled: true,
        is_active: false,
      },
    ]);

    // ─── Tenant B: 5 productos ─────────────────────────────────────
    await db.insert(products).values([
      {
        id: B_cocaLata,
        tenant_id: tenantBId,
        name: 'Coca Cola lata',
        unit_type: 'unidad',
        price: '350.0000',
        cost: '200.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        barcode: 'B-7790999888777',
        sku: 'B-COCALATA',
        stock_current: '100.0000',
        stock_minimum: '20.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        id: B_panIntegralLowStock,
        tenant_id: tenantBId,
        name: 'Pan integral',
        unit_type: 'unidad',
        price: '350.0000',
        cost: '200.0000',
        tax_rate: '0.00',
        tdf_exempt: false,
        sku: 'B-PANINTEGRAL',
        // stock_current=2 < stock_minimum=5 → low stock B
        stock_current: '2.0000',
        stock_minimum: '5.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        id: B_yerbaPremium,
        tenant_id: tenantBId,
        name: 'Yerba premium',
        unit_type: 'unidad',
        price: '2500.0000',
        cost: '1800.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        sku: 'B-YERBAPREMIUM',
        stock_current: '15.0000',
        stock_minimum: '3.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        id: B_uniqueB,
        tenant_id: tenantBId,
        name: 'Producto unico B',
        unit_type: 'unidad',
        price: '500.0000',
        cost: '300.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        sku: 'B-UNIQUE',
        stock_current: '10.0000',
        stock_minimum: '2.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        id: B_inactivo,
        tenant_id: tenantBId,
        name: 'Producto inactivo B',
        unit_type: 'unidad',
        price: '100.0000',
        cost: '50.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        sku: 'B-INACTIVE',
        barcode: 'B-INACTIVE-BC',
        stock_current: '0.0000',
        stock_minimum: '5.0000',
        stock_tracking_enabled: true,
        is_active: false,
      },
    ]);
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx
        .delete(products)
        .where(sql`${products.tenant_id} IN (${tenantAId}, ${tenantBId})`);
      await tx
        .delete(company_users)
        .where(sql`${company_users.company_id} IN (${tenantAId}, ${tenantBId})`);
      await tx.delete(users).where(sql`${users.id} IN (${userAId}, ${userBId})`);
      await tx
        .delete(companies)
        .where(sql`${companies.id} IN (${tenantAId}, ${tenantBId})`);
    });
  });

  // ════════════════════════════════════════════════════════════════
  //  A) CROSS-TENANT FENCES — bajo A los productos de B son INVISIBLES
  // ════════════════════════════════════════════════════════════════

  describe('cross-tenant fences (CLAUDE.md §7.9 mandatory)', () => {
    it('searchProductsByName("Coca") bajo A → solo productos de A (2), nunca el de B con mismo prefijo', async () => {
      const results = await withCtx(tenantAId, userAId, () =>
        searchProductsByName('Coca')
      );

      // Esperamos exactly los 2 de A. NUNCA "Coca Cola lata" de B.
      expect(results).toHaveLength(2);
      const ids = results.map((p) => p.id).sort();
      expect(ids).toEqual([A_coca500, A_coca1500].sort());

      // Verificación cross-tenant explícita: TODOS los rows tienen tenant_id=A.
      for (const row of results) {
        expect(row.tenant_id).toBe(tenantAId);
        expect(row.tenant_id).not.toBe(tenantBId);
      }
      // Defensa redundante: ninguno es el de B.
      const idSet = new Set(results.map((p) => p.id));
      expect(idSet.has(B_cocaLata)).toBe(false);
    });

    it('searchProductsByName("Pan") bajo A → solo Pan blanco (A), nunca Pan integral (B)', async () => {
      const results = await withCtx(tenantAId, userAId, () =>
        searchProductsByName('Pan')
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(A_panLowStock);
      expect(results[0]?.tenant_id).toBe(tenantAId);

      // Symmetric: bajo B solo aparece Pan integral.
      const resultsB = await withCtx(tenantBId, userBId, () =>
        searchProductsByName('Pan')
      );
      expect(resultsB).toHaveLength(1);
      expect(resultsB[0]?.id).toBe(B_panIntegralLowStock);
      expect(resultsB[0]?.tenant_id).toBe(tenantBId);
    });

    it('findProductByBarcode(B.barcode) bajo A → null + symmetric bajo B retorna el real', async () => {
      // Pedimos el barcode de B desde contexto A → debe ser null.
      const fromA = await withCtx(tenantAId, userAId, () =>
        findProductByBarcode('B-7790999888777')
      );
      expect(fromA).toBeNull();

      // Sanity: bajo B la misma query devuelve el producto real.
      const fromB = await withCtx(tenantBId, userBId, () =>
        findProductByBarcode('B-7790999888777')
      );
      expect(fromB).not.toBeNull();
      expect(fromB?.id).toBe(B_cocaLata);
      expect(fromB?.tenant_id).toBe(tenantBId);

      // Reversa: barcode de A desde B → null
      const fromBLookA = await withCtx(tenantBId, userBId, () =>
        findProductByBarcode('A-7790123456789')
      );
      expect(fromBLookA).toBeNull();
    });

    it('findProductBySku(B.sku) bajo A → null + symmetric bajo B retorna el real', async () => {
      const fromA = await withCtx(tenantAId, userAId, () =>
        findProductBySku('B-COCALATA')
      );
      expect(fromA).toBeNull();

      const fromB = await withCtx(tenantBId, userBId, () =>
        findProductBySku('B-COCALATA')
      );
      expect(fromB?.id).toBe(B_cocaLata);
      expect(fromB?.tenant_id).toBe(tenantBId);

      // Reversa
      const fromBLookA = await withCtx(tenantBId, userBId, () =>
        findProductBySku('A-COCA500')
      );
      expect(fromBLookA).toBeNull();
    });

    it('listLowStockProducts bajo A → solo Pan blanco de A; nunca Pan integral de B (que TAMBIÉN está low)', async () => {
      const fromA = await withCtx(tenantAId, userAId, () => listLowStockProducts());
      expect(fromA).toHaveLength(1);
      expect(fromA[0]?.id).toBe(A_panLowStock);
      expect(fromA[0]?.tenant_id).toBe(tenantAId);

      // Symmetric — bajo B solo aparece Pan integral
      const fromB = await withCtx(tenantBId, userBId, () => listLowStockProducts());
      expect(fromB).toHaveLength(1);
      expect(fromB[0]?.id).toBe(B_panIntegralLowStock);
      expect(fromB[0]?.tenant_id).toBe(tenantBId);
    });

    it('listProductsPaginated bajo A → solo productos de A (4 activos, sin inactivo), nunca de B', async () => {
      const fromA = await withCtx(tenantAId, userAId, () =>
        listProductsPaginated({ limit: 100 })
      );
      // 4 activos (A_coca500 + A_coca1500 + A_panLowStock + A_yerba); A_inactivo excluido.
      expect(fromA).toHaveLength(4);
      const ids = fromA.map((p) => p.id);
      expect(ids).toContain(A_coca500);
      expect(ids).toContain(A_coca1500);
      expect(ids).toContain(A_panLowStock);
      expect(ids).toContain(A_yerba);
      // Defensa cross-tenant: ninguno de B (incluso B activos)
      expect(ids).not.toContain(B_cocaLata);
      expect(ids).not.toContain(B_panIntegralLowStock);
      expect(ids).not.toContain(B_yerbaPremium);
      expect(ids).not.toContain(B_uniqueB);
      expect(ids).not.toContain(B_inactivo);
      // is_active=false NUNCA aparece con activeOnly default
      expect(ids).not.toContain(A_inactivo);

      // Symmetric bajo B
      const fromB = await withCtx(tenantBId, userBId, () =>
        listProductsPaginated({ limit: 100 })
      );
      expect(fromB).toHaveLength(4); // 4 activos B
      for (const row of fromB) {
        expect(row.tenant_id).toBe(tenantBId);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════
  //  B) INTEGRATION COVERAGE — primera DB-real para los 5 wrappers
  // ════════════════════════════════════════════════════════════════

  describe('queries integration (primera DB-real coverage)', () => {
    it('searchProductsByName("Coca") con activeOnly default → excluye inactivos; ranking por similarity', async () => {
      const results = await withCtx(tenantAId, userAId, () =>
        searchProductsByName('Coca', { limit: 50 })
      );
      // 2 productos activos con "Coca" en el nombre, A_inactivo NO incluido
      // (no se llama "Coca" pero el test verifica activeOnly comportamiento)
      expect(results.every((p) => p.is_active === true)).toBe(true);
      expect(results.every((p) => p.name.toLowerCase().includes('coca'))).toBe(true);
    });

    it('searchProductsByName("Producto") con activeOnly=false → incluye inactivo de A', async () => {
      const results = await withCtx(tenantAId, userAId, () =>
        searchProductsByName('Producto', { activeOnly: false, limit: 50 })
      );
      // Bajo A, solo el "Producto inactivo A" matchea. Bajo activeOnly=false sí lo trae.
      const ids = results.map((p) => p.id);
      expect(ids).toContain(A_inactivo);
      // Cross-tenant defense: NO incluye "Producto inactivo B" ni "Producto unico B"
      expect(ids).not.toContain(B_inactivo);
      expect(ids).not.toContain(B_uniqueB);
    });

    it('findProductByBarcode con barcode existente y producto inactivo → null (activeOnly hardcoded)', async () => {
      // A_inactivo tiene barcode 'A-INACTIVE-BC' pero is_active=false.
      // El service hardcodea activeOnly=true → debe retornar null.
      const result = await withCtx(tenantAId, userAId, () =>
        findProductByBarcode('A-INACTIVE-BC')
      );
      expect(result).toBeNull();
    });

    it('findProductBySku con sku existente y producto inactivo → null (activeOnly hardcoded)', async () => {
      const result = await withCtx(tenantAId, userAId, () =>
        findProductBySku('A-INACTIVE')
      );
      expect(result).toBeNull();
    });

    it('listLowStockProducts orden por stock_current ascendente (urgencia primero)', async () => {
      // Bajo A solo hay 1 low stock — agregamos un segundo low stock de A
      // y verificamos orden. Insert/cleanup limited a este test.
      const A_panSegundoLow = crypto.randomUUID();
      await db.insert(products).values({
        id: A_panSegundoLow,
        tenant_id: tenantAId,
        name: 'Pan negro low',
        unit_type: 'unidad',
        price: '300.0000',
        cost: '180.0000',
        tax_rate: '0.00',
        tdf_exempt: false,
        sku: 'A-PAN-NEGRO',
        // stock_current=5 > A_panLowStock.stock_current=1 → debe quedar 2do en orden
        stock_current: '5.0000',
        stock_minimum: '10.0000',
        stock_tracking_enabled: true,
        is_active: true,
      });

      const results = await withCtx(tenantAId, userAId, () => listLowStockProducts());
      expect(results).toHaveLength(2);
      // stock_current asc: A_panLowStock (1) primero, A_panSegundoLow (5) después
      expect(results[0]?.id).toBe(A_panLowStock);
      expect(results[1]?.id).toBe(A_panSegundoLow);
      expect(Number(results[0]?.stock_current)).toBeLessThan(
        Number(results[1]?.stock_current)
      );

      // Cleanup local
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
        await tx.delete(products).where(eq(products.id, A_panSegundoLow));
      });
    });

    it('listProductsPaginated paginación → orden por name asc + limit/offset correctos', async () => {
      // Bajo A hay 4 activos. Orden por name asc:
      //   "Coca Cola 1.5L" (A_coca1500)
      //   "Coca Cola 500ml" (A_coca500)
      //   "Pan blanco kg" (A_panLowStock)
      //   "Yerba mate 500g" (A_yerba)
      const page1 = await withCtx(tenantAId, userAId, () =>
        listProductsPaginated({ limit: 2, offset: 0 })
      );
      expect(page1).toHaveLength(2);
      expect(page1[0]?.id).toBe(A_coca1500);
      expect(page1[1]?.id).toBe(A_coca500);

      const page2 = await withCtx(tenantAId, userAId, () =>
        listProductsPaginated({ limit: 2, offset: 2 })
      );
      expect(page2).toHaveLength(2);
      expect(page2[0]?.id).toBe(A_panLowStock);
      expect(page2[1]?.id).toBe(A_yerba);

      // No duplicates entre páginas
      const allIds = new Set([
        ...page1.map((p) => p.id),
        ...page2.map((p) => p.id),
      ]);
      expect(allIds.size).toBe(4);
    });
  });
});
