/**
 * T-MT-03 — Contador multi-empresa solo ve sus `company_ids`.
 * CLAUDE.md §7.9 mandatory test + ADR-0008 (contador multi-empresa) + §7.3.
 *
 * **Setup del contador** (ADR-0008):
 * El JWT del contador trae `company_ids: [uuidA, uuidB]` (array). Las
 * policies RLS usan `pandora.current_company_ids()` que devuelve el array
 * completo cuando viene poblado (migration 0003 coalesce). Resultado:
 * SELECT visible = unión de sales de A y B; sales de C invisibles.
 *
 * Diferenciado de T-MT-01 (cashier single-tenant):
 * - Cashier: JWT.company_id = uuidA → solo ve A
 * - Contador: JWT.company_ids = [uuidA, uuidB] → ve A+B
 * - Contador es read-only por default (CLAUDE.md §7.3); mutations requieren
 *   rol explícito. Acá testeamos SOLO la visibilidad SELECT — el read-only
 *   policy enforcement vive en service layer (capa 2) + role TS, no en RLS.
 *
 * Cobertura:
 *   T3.1: contador con company_ids=[A,B] ve sales de A Y B (4 rows)
 *   T3.2: contador NO ve sales de C (tenant fuera del array)
 *   T3.3: SELECT por ID específico de C desde contador → 0 rows silent
 *   T3.4: cashier de A (single company_id) NO ve sales de B aunque contador sí
 *   T3.5: contador con company_ids=[] (array vacío explícito) → throw guard helper
 *   T3.6: cross-check privileged confirma 6 sales existen (2 por tenant)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { sales } from '@/lib/db/schema/sales';
import { withRlsContext } from '@/lib/multi_tenant/rls_context';

describe('T-MT-03 — contador multi-empresa solo ve sus company_ids', () => {
  // 3 tenants: A y B son clientes del contador; C es ajeno.
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const tenantC = crypto.randomUUID();
  // Users: cashier per tenant + contador asociado a A y B
  const cashierA = crypto.randomUUID();
  const cashierB = crypto.randomUUID();
  const cashierC = crypto.randomUUID();
  const accountant = crypto.randomUUID();

  const saleIdsByTenant: Record<string, string[]> = {
    [tenantA]: [],
    [tenantB]: [],
    [tenantC]: [],
  };

  beforeAll(async () => {
    // Companies + cashiers + sales
    for (const [tenantId, cashierId] of [
      [tenantA, cashierA],
      [tenantB, cashierB],
      [tenantC, cashierC],
    ] as const) {
      await db.insert(companies).values({
        id: tenantId,
        name: `T-MT-03 Co ${tenantId.slice(0, 8)}`,
        legal_name: `T-MT-03 Co SRL ${tenantId.slice(0, 8)}`,
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      });

      await db.insert(users).values({
        id: cashierId,
        email: `t-mt-03-cashier-${cashierId.slice(0, 8)}@test.local`,
        full_name: `Cashier T-MT-03 ${cashierId.slice(0, 4)}`,
        is_support: false,
      });

      await db.insert(company_users).values({
        id: crypto.randomUUID(),
        company_id: tenantId,
        user_id: cashierId,
        role: 'cashier',
      });

      // 2 sales por tenant
      for (let i = 0; i < 2; i++) {
        const saleId = crypto.randomUUID();
        saleIdsByTenant[tenantId]!.push(saleId);
        await db.insert(sales).values({
          id: saleId,
          tenant_id: tenantId,
          correlation_id: crypto.randomUUID(),
          cashier_user_id: cashierId,
          sale_point: 1,
          commercial_status: 'draft',
          fiscal_status: 'not_required',
          subtotal: '0',
          tax_amount: '0',
          exempt_amount: '0',
          total: '0',
        });
      }
    }

    // Contador: 1 user + 2 entries en company_users (A y B). NO C.
    await db.insert(users).values({
      id: accountant,
      email: `t-mt-03-accountant-${accountant.slice(0, 8)}@test.local`,
      full_name: 'Contador T-MT-03',
      is_support: false,
    });

    for (const tenantId of [tenantA, tenantB]) {
      await db.insert(company_users).values({
        id: crypto.randomUUID(),
        company_id: tenantId,
        user_id: accountant,
        role: 'accountant',
      });
    }
  });

  afterAll(async () => {
    await db
      .delete(sales)
      .where(inArray(sales.tenant_id, [tenantA, tenantB, tenantC]));
    await db
      .delete(company_users)
      .where(inArray(company_users.company_id, [tenantA, tenantB, tenantC]));
    await db
      .delete(users)
      .where(inArray(users.id, [cashierA, cashierB, cashierC, accountant]));
    await db
      .delete(companies)
      .where(inArray(companies.id, [tenantA, tenantB, tenantC]));
  });

  it('T3.1: contador con company_ids=[A,B] ve sales de A Y B (4 rows)', async () => {
    await withRlsContext(
      { sub: accountant, company_ids: [tenantA, tenantB] },
      async (tx) => {
        const rows = await tx
          .select({ id: sales.id, tenant_id: sales.tenant_id })
          .from(sales);

        expect(rows).toHaveLength(4);
        const visibleTenants = new Set(rows.map((r) => r.tenant_id));
        expect(visibleTenants).toEqual(new Set([tenantA, tenantB]));

        // IDs específicos: unión de A y B (no C)
        const visibleIds = new Set(rows.map((r) => r.id));
        const expectedIds = new Set([
          ...saleIdsByTenant[tenantA]!,
          ...saleIdsByTenant[tenantB]!,
        ]);
        expect(visibleIds).toEqual(expectedIds);
      }
    );
  });

  it('T3.2: contador NO ve sales del tenant C (fuera del array)', async () => {
    await withRlsContext(
      { sub: accountant, company_ids: [tenantA, tenantB] },
      async (tx) => {
        const rows = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.tenant_id, tenantC));

        expect(rows).toHaveLength(0);
      }
    );
  });

  it('T3.3: SELECT por ID específico de C desde contador → 0 rows silent', async () => {
    const saleCId = saleIdsByTenant[tenantC]![0]!;
    await withRlsContext(
      { sub: accountant, company_ids: [tenantA, tenantB] },
      async (tx) => {
        const rows = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.id, saleCId));

        // RLS oculta el row — no error, no distinción "existe pero no me lo muestran"
        expect(rows).toHaveLength(0);
      }
    );
  });

  it('T3.4: cashier de A (single company_id) NO ve sales de B aunque contador sí', async () => {
    // Cashier A: company_id=A → solo ve A (2 rows)
    await withRlsContext(
      { sub: cashierA, company_id: tenantA },
      async (tx) => {
        const rows = await tx
          .select({ tenant_id: sales.tenant_id })
          .from(sales);

        expect(rows).toHaveLength(2);
        expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([tenantA]));
      }
    );

    // Mismo accountant en otro context con array → ve A+B (4 rows). Demuestra
    // que la diferencia está en el JWT, no en el user en sí.
    await withRlsContext(
      { sub: accountant, company_ids: [tenantA, tenantB] },
      async (tx) => {
        const rows = await tx
          .select({ tenant_id: sales.tenant_id })
          .from(sales);
        expect(rows).toHaveLength(4);
      }
    );
  });

  it('T3.5: contador con company_ids=[] (array vacío) → throw guard del helper', async () => {
    // El helper exige al menos UN company_id (single o array no vacío). Un JWT
    // sin company actualmente activa es un bug de auth flow — debe fallar fast.
    await expect(
      withRlsContext(
        { sub: accountant, company_ids: [] },
        async () => undefined
      )
    ).rejects.toThrow(/company_id/);
  });

  it('T3.6: cross-check con db privileged — los 6 sales existen (2 por tenant)', async () => {
    const rows = await db
      .select({ tenant_id: sales.tenant_id })
      .from(sales)
      .where(inArray(sales.tenant_id, [tenantA, tenantB, tenantC]));

    expect(rows).toHaveLength(6);
    // 2 por cada tenant
    const counts = rows.reduce(
      (acc, r) => {
        acc[r.tenant_id] = (acc[r.tenant_id] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    expect(counts[tenantA]).toBe(2);
    expect(counts[tenantB]).toBe(2);
    expect(counts[tenantC]).toBe(2);
  });
});
