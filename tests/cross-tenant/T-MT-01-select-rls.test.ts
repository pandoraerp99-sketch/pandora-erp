/**
 * T-MT-01 — Cross-tenant SELECT bloqueado por RLS.
 * CLAUDE.md §7.9 mandatory test multi-tenant + ADR-0002 + advisor catch 2026-06-12.
 *
 * **El test que SÍ valida RLS isolation (a diferencia de los integration
 * tests etiquetados "cross-tenant" hasta hoy):** usa withRlsContext() que
 * monta role=authenticated + JWT claims reales, fuerza a RLS a aplicar.
 *
 * Patrón:
 *   1. Setup con `db` privileged: 2 companies + sales en cada una.
 *   2. Como user de A (withRlsContext company_id=A): SELECT debe devolver
 *      SOLO sales de A. Sales de B son invisibles (RLS las filtra silente).
 *   3. Como user de B: SOLO sales de B.
 *   4. Cross-check con `db` privileged: total = sales A + sales B (todo existe).
 *
 * Lo crítico es paso 2: bajo el client privileged ese SELECT devolvería 4 rows.
 * Bajo authenticated + RLS, devuelve 2 (las de A).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { sales } from '@/lib/db/schema/sales';
import { withRlsContext } from '@/lib/multi_tenant/rls_context';

describe('T-MT-01 — cross-tenant SELECT bloqueado por RLS', () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const saleIdsA: string[] = [];
  const saleIdsB: string[] = [];

  beforeAll(async () => {
    // Setup con `db` privileged — el seed no debe respetar RLS.
    for (const [tenantId, userId, salesArr] of [
      [tenantA, userA, saleIdsA],
      [tenantB, userB, saleIdsB],
    ] as const) {
      await db.insert(companies).values({
        id: tenantId,
        name: `T-MT-01 Co ${tenantId.slice(0, 8)}`,
        legal_name: `T-MT-01 Co SRL ${tenantId.slice(0, 8)}`,
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
        email: `t-mt-01-${userId.slice(0, 8)}@test.local`,
        full_name: `User T-MT-01 ${userId.slice(0, 4)}`,
        is_support: false,
      });

      await db.insert(company_users).values({
        id: crypto.randomUUID(),
        company_id: tenantId,
        user_id: userId,
        role: 'cashier',
      });

      // 2 sales por tenant
      for (let i = 0; i < 2; i++) {
        const saleId = crypto.randomUUID();
        salesArr.push(saleId);
        await db.insert(sales).values({
          id: saleId,
          tenant_id: tenantId,
          correlation_id: crypto.randomUUID(),
          cashier_user_id: userId,
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
  });

  afterAll(async () => {
    await db
      .delete(sales)
      .where(inArray(sales.tenant_id, [tenantA, tenantB]));
    await db
      .delete(company_users)
      .where(inArray(company_users.company_id, [tenantA, tenantB]));
    await db.delete(users).where(inArray(users.id, [userA, userB]));
    await db.delete(companies).where(inArray(companies.id, [tenantA, tenantB]));
  });

  it('T1.1: user A solo ve sales del tenant A (2 rows), invisibles las de B', async () => {
    await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
      const rows = await tx
        .select({ id: sales.id, tenant_id: sales.tenant_id })
        .from(sales);

      // RLS filtra silente — sales de B no aparecen como "denied", simplemente
      // no están en el result set.
      expect(rows).toHaveLength(2);
      const tenantIds = new Set(rows.map((r) => r.tenant_id));
      expect(tenantIds).toEqual(new Set([tenantA]));

      const visibleIds = rows.map((r) => r.id).sort();
      expect(visibleIds).toEqual([...saleIdsA].sort());
    });
  });

  it('T1.2: user B solo ve sales del tenant B (2 rows), invisibles las de A', async () => {
    await withRlsContext({ sub: userB, company_id: tenantB }, async (tx) => {
      const rows = await tx
        .select({ id: sales.id, tenant_id: sales.tenant_id })
        .from(sales);

      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([tenantB]));
      expect(rows.map((r) => r.id).sort()).toEqual([...saleIdsB].sort());
    });
  });

  it('T1.3: SELECT por ID específico de tenant B desde context A → 0 rows (no error)', async () => {
    expect(saleIdsB.length).toBeGreaterThan(0);

    await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
      const rows = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.id, saleIdsB[0]!));

      // El row EXISTE pero RLS lo filtra — el SELECT no tira error, devuelve vacío.
      // Esa "fuga silenciosa" es exactamente lo que RLS protege: el atacante
      // no puede distinguir entre "no existe" y "existe pero no me lo muestran".
      expect(rows).toHaveLength(0);
    });
  });

  it('T1.4: cross-check con db privileged — los 4 sales existen en realidad', async () => {
    const rows = await db
      .select({ id: sales.id })
      .from(sales)
      .where(inArray(sales.tenant_id, [tenantA, tenantB]));
    expect(rows).toHaveLength(4);
  });

  it('T1.5: SELECT count via SQL raw también respeta RLS (no bypass por agregación)', async () => {
    await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
      const rows = await tx.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM sales`
      );
      expect(rows[0]?.count).toBe('2'); // solo cuenta sales visibles
    });
  });
});
