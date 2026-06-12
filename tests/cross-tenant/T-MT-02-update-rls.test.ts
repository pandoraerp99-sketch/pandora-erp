/**
 * T-MT-02 — Cross-tenant UPDATE bloqueado por RLS.
 * CLAUDE.md §7.9 mandatory test multi-tenant + ADR-0002 + advisor catch 2026-06-12.
 *
 * **El comportamiento esperado bajo RLS Postgres:** un UPDATE que pretende
 * modificar un row de otro tenant NO tira error — simplemente NO matchea
 * ningún row (porque RLS lo filtra del USING clause). El UPDATE termina
 * con 0 rows afectados. Esto es EXACTAMENTE lo mismo que un row inexistente,
 * por design (no leakage de información).
 *
 * Patrón:
 *   1. Setup: 2 tenants, 1 sale en cada uno con commercial_status='draft'.
 *   2. Como user A: UPDATE sales SET commercial_status='in_progress'
 *      WHERE id=<sale_B_id> → 0 rows (RLS filtra row de B).
 *   3. Verificar con db privileged que sale B sigue intacto.
 *   4. Como user A: UPDATE sales SET ... WHERE id=<sale_A_id> → 1 row (OK).
 *   5. INSERT con tenant_id de B desde context A → throw (WITH CHECK falla).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { sales } from '@/lib/db/schema/sales';
import { withRlsContext } from '@/lib/multi_tenant/rls_context';

function unwrapPgError(e: unknown): {
  code?: string;
  message: string;
} {
  if (e && typeof e === 'object') {
    const err = e as { message?: string; code?: string; cause?: unknown };
    const cause = err.cause as { code?: string; message?: string } | undefined;
    return {
      code: cause?.code ?? err.code,
      message: cause?.message ?? err.message ?? String(e),
    };
  }
  return { message: String(e) };
}

describe('T-MT-02 — cross-tenant UPDATE/INSERT bloqueados por RLS', () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  let saleIdA: string | undefined;
  let saleIdB: string | undefined;

  beforeAll(async () => {
    for (const [tenantId, userId] of [
      [tenantA, userA],
      [tenantB, userB],
    ] as const) {
      await db.insert(companies).values({
        id: tenantId,
        name: `T-MT-02 Co ${tenantId.slice(0, 8)}`,
        legal_name: `T-MT-02 Co SRL ${tenantId.slice(0, 8)}`,
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
        email: `t-mt-02-${userId.slice(0, 8)}@test.local`,
        full_name: `User T-MT-02 ${userId.slice(0, 4)}`,
        is_support: false,
      });

      await db.insert(company_users).values({
        id: crypto.randomUUID(),
        company_id: tenantId,
        user_id: userId,
        role: 'cashier',
      });
    }

    saleIdA = crypto.randomUUID();
    saleIdB = crypto.randomUUID();
    for (const [tenantId, userId, saleId] of [
      [tenantA, userA, saleIdA],
      [tenantB, userB, saleIdB],
    ] as const) {
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
  });

  afterAll(async () => {
    await db.delete(sales).where(inArray(sales.tenant_id, [tenantA, tenantB]));
    await db
      .delete(company_users)
      .where(inArray(company_users.company_id, [tenantA, tenantB]));
    await db.delete(users).where(inArray(users.id, [userA, userB]));
    await db.delete(companies).where(inArray(companies.id, [tenantA, tenantB]));
  });

  it('T2.1: user A intenta UPDATE sale de B por ID → 0 rows afectados (silent)', async () => {
    expect(saleIdB).toBeDefined();

    const result = await withRlsContext(
      { sub: userA, company_id: tenantA },
      async (tx) => {
        return tx.execute<{ id: string }>(sql`
          UPDATE sales SET commercial_status = 'in_progress'
          WHERE id = ${saleIdB!}
          RETURNING id
        `);
      }
    );
    // RLS filtra el row del USING — UPDATE no matchea nada, NO tira error.
    expect(result).toHaveLength(0);

    // Verifico con db privileged que sale B sigue como 'draft'.
    const rows = await db
      .select({ commercial_status: sales.commercial_status })
      .from(sales)
      .where(eq(sales.id, saleIdB!));
    expect(rows[0]?.commercial_status).toBe('draft');
  });

  it('T2.2: user A UPDATE su propia sale (A) → 1 row OK', async () => {
    expect(saleIdA).toBeDefined();

    const result = await withRlsContext(
      { sub: userA, company_id: tenantA },
      async (tx) => {
        return tx.execute<{ id: string }>(sql`
          UPDATE sales SET commercial_status = 'in_progress'
          WHERE id = ${saleIdA!}
          RETURNING id
        `);
      }
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(saleIdA);

    // Cross-check
    const rows = await db
      .select({ commercial_status: sales.commercial_status })
      .from(sales)
      .where(eq(sales.id, saleIdA!));
    expect(rows[0]?.commercial_status).toBe('in_progress');
  });

  it('T2.3: user A INSERT sale con tenant_id=B → throw 42501 (RLS WITH CHECK falla)', async () => {
    let caught: unknown;
    try {
      await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
        await tx.insert(sales).values({
          tenant_id: tenantB, // <-- atacante intenta inyectar tenant ajeno
          correlation_id: crypto.randomUUID(),
          cashier_user_id: userA,
          sale_point: 1,
          commercial_status: 'draft',
          fiscal_status: 'not_required',
          subtotal: '0',
          tax_amount: '0',
          exempt_amount: '0',
          total: '0',
        });
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const err = unwrapPgError(caught);
    // RLS WITH CHECK violation → Postgres tira 42501 (insufficient_privilege) o
    // 'new row violates row-level security policy'. Acepto ambos códigos.
    expect(err.message).toMatch(/row-level security|policy/i);
  });

  it('T2.4: UPDATE WHERE tenant_id=B desde context A → 0 rows (RLS oculta TODO el tenant)', async () => {
    const result = await withRlsContext(
      { sub: userA, company_id: tenantA },
      async (tx) => {
        return tx.execute<{ id: string }>(sql`
          UPDATE sales SET commercial_status = 'cancelada'
          WHERE tenant_id = ${tenantB}
          RETURNING id
        `);
      }
    );
    expect(result).toHaveLength(0);
  });
});
