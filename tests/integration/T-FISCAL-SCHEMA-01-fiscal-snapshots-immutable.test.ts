/**
 * T-FISCAL-SCHEMA-01 — Trigger immutability fiscal_snapshots.
 * Mini-audit pre-Sprint 6 fiscal + CLAUDE.md §8.2 + §16.5 + ADR-0022.
 *
 * **Por qué este test EXISTE:** el schema fiscal_snapshots.ts línea 7 declara
 * desde Sprint 5 que el trigger anti-UPDATE/DELETE debe instalarse "via
 * migración SQL custom en B5", pero B5 nunca llegó. Mini-audit 2026-06-12
 * detectó el gap y creó migration 0010_fiscal_snapshots_immutable.sql con
 * el patrón idéntico de stock_movements (0005) y cash_movements (0007).
 *
 * Este test valida empíricamente que el trigger:
 *   T1.1 INSERT inicial → OK (snapshot creado bare-minimum)
 *   T1.2 UPDATE → throw check_violation con mensaje INSERT-only
 *   T1.3 DELETE → throw check_violation
 *   T1.4 TRUNCATE → throw check_violation (statement-level)
 *
 * Reproducibilidad histórica ADR-0022: dada (sale_id, snapshot) años después,
 * el motor debe reconstruir payload AFIP idéntico. Sin trigger, un UPDATE
 * accidental rompe esa garantía.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { sales } from '@/lib/db/schema/sales';
import { fiscal_snapshots } from '@/lib/db/schema/fiscal_snapshots';

/** Mismo helper que T-CASH-05 / T-INV-05 — desenvuelve PgError de Drizzle. */
function unwrapPgError(e: unknown): {
  code?: string;
  message: string;
  constraint?: string;
} {
  if (e && typeof e === 'object') {
    const err = e as { message?: string; code?: string; cause?: unknown };
    const cause = err.cause as
      | { code?: string; message?: string; constraint_name?: string }
      | undefined;
    return {
      code: cause?.code ?? err.code,
      message: cause?.message ?? err.message ?? String(e),
      constraint: cause?.constraint_name,
    };
  }
  return { message: String(e) };
}

describe('T-FISCAL-SCHEMA-01 — fiscal_snapshots_immutable trigger', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let saleId: string | undefined;
  let snapshotId: string | undefined;

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-FISCAL-SCHEMA-01 Test Co',
      legal_name: 'T-FISCAL-SCHEMA-01 Test Co SRL',
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
      email: `t-fiscal-schema-01-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier T-FISCAL-SCHEMA-01',
      is_support: false,
    });

    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });

    // Sale minimalista (NO finalizado — solo necesitamos un row con FK válida
    // para que el INSERT en fiscal_snapshots no rompa por sale_id FK).
    saleId = crypto.randomUUID();
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

    // INSERT fiscal_snapshot bare-minimum (T1.1). Acá NO probamos shape
    // de fiscal_breakdown / iva_rates_applied — solo que el trigger permite
    // INSERT y bloquea mutación posterior.
    const inserted = await db
      .insert(fiscal_snapshots)
      .values({
        tenant_id: tenantId,
        sale_id: saleId,
        calculation_engine_version: '1.0.0-test',
        tax_policy_version: 'ar-test-v1',
        rounding_mode: 'HALF_EVEN',
        rounding_stage: 'PER_LINE',
        iva_rates_applied: [],
        currency_code: 'ARS',
        jurisdiction_context: { test: true },
        fiscal_breakdown: { test: true },
        wsfe_version: 'WSFEv1',
      })
      .returning({ id: fiscal_snapshots.id });

    snapshotId = inserted[0]?.id;
  });

  afterAll(async () => {
    // Cleanup con session_replication_role='replica' bypassa el trigger
    // (igual que T-CASH-05 con cash_movements + cash_sessions cerradas).
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx
        .delete(fiscal_snapshots)
        .where(eq(fiscal_snapshots.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx
        .delete(company_users)
        .where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('T1.1: INSERT inicial → OK (snapshot creado)', () => {
    // Validado en beforeAll. Si llegamos acá sin throw, el INSERT pasó.
    expect(snapshotId).toBeDefined();
  });

  it('T1.2: UPDATE de snapshot → throw check_violation con mensaje INSERT-only', async () => {
    expect(snapshotId).toBeDefined();

    let caught: unknown;
    try {
      await db.execute(sql`
        UPDATE fiscal_snapshots
        SET cae = '99999999999999', tax_policy_version = 'tampered'
        WHERE id = ${snapshotId!}
      `);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const err = unwrapPgError(caught);
    expect(err.code).toBe('23514'); // USING ERRCODE = 'check_violation'
    expect(err.message).toMatch(/INSERT-only/);
    expect(err.message).toMatch(/fiscal_snapshots/);

    // Verifico que la row NO cambió (cae sigue siendo NULL del INSERT inicial).
    const rows = await db
      .select({
        cae: fiscal_snapshots.cae,
        tax_policy_version: fiscal_snapshots.tax_policy_version,
      })
      .from(fiscal_snapshots)
      .where(eq(fiscal_snapshots.id, snapshotId!))
      .limit(1);
    expect(rows[0]?.cae).toBeNull();
    expect(rows[0]?.tax_policy_version).toBe('ar-test-v1');
  });

  it('T1.3: DELETE de snapshot → throw check_violation', async () => {
    expect(snapshotId).toBeDefined();

    let caught: unknown;
    try {
      await db.execute(sql`
        DELETE FROM fiscal_snapshots WHERE id = ${snapshotId!}
      `);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const err = unwrapPgError(caught);
    expect(err.code).toBe('23514');
    expect(err.message).toMatch(/INSERT-only/);

    // Row sigue existiendo.
    const rows = await db
      .select({ id: fiscal_snapshots.id })
      .from(fiscal_snapshots)
      .where(eq(fiscal_snapshots.id, snapshotId!));
    expect(rows).toHaveLength(1);
  });

  it('T1.4: TRUNCATE de fiscal_snapshots → throw check_violation (statement-level)', async () => {
    let caught: unknown;
    try {
      await db.execute(sql`TRUNCATE TABLE fiscal_snapshots`);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const err = unwrapPgError(caught);
    expect(err.code).toBe('23514');
    expect(err.message).toMatch(/INSERT-only/);
  });
});
