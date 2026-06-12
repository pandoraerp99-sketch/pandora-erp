/**
 * T-WSAA-01 — Schema wsaa_tokens: UNIQUE (tenant, environment) + CHECKs + per-tenant coexistence.
 * Mini-audit pre-Sprint 6 fiscal + CLAUDE.md §17.2 + ADR-0019 S13.
 *
 * **HONESTY NOTE (advisor catch 2026-06-12):** Este test corre con el `db`
 * client privileged que BYPASSA RLS. T1.6 verifica que UNIQUE está scoped
 * per-tenant (mismo env permitido para tenants distintos), NO que RLS
 * aisle lecturas cross-tenant. Real RLS isolation test requiere helper
 * `withRlsContext()` (gap sistémico documentado en ROADMAP §1054).
 *
 * RLS sí está habilitado en wsaa_tokens (migration 0013) — particularmente
 * crítico acá porque token + sign son SECRETS plaintext (cache-not-vault).
 *
 * ADR-0019 S13 (hard isolation homo vs prod): UNIQUE incluye environment para
 * permitir que un tenant tenga 2 tokens simultáneos durante period de transición
 * (típicamente "estamos en homo + queremos preparar prod"). CHECK constraint
 * environment IN AFIP_ENVIRONMENTS bloquea valores fuera del enum.
 *
 *   T1.1 INSERT homo → OK
 *   T1.2 INSERT prod mismo tenant → OK (UNIQUE incluye env)
 *   T1.3 INSERT duplicado (tenant, env) → throw 23505
 *   T1.4 INSERT environment='invalido' → throw 23514 CHECK violation
 *   T1.5 INSERT expires_at <= generated_at → throw 23514 CHECK violation
 *   T1.6 Per-tenant coexistence: tenant B mismo env → OK (UNIQUE scoped por tenant)
 *
 * Cache TTL semantics (refresh proactivo, etc.) son responsabilidad del service
 * Sprint 6. Acá solo schema enforce + secrets discipline.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { wsaa_tokens } from '@/lib/db/schema/wsaa_tokens';

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

describe('T-WSAA-01 — wsaa_tokens schema enforce', () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const now = new Date();
  const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  beforeAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.insert(companies).values({
        id: tenantId,
        name: `T-WSAA-01 Co ${tenantId.slice(0, 8)}`,
        legal_name: `T-WSAA-01 Co SRL ${tenantId.slice(0, 8)}`,
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      });
    }
  });

  afterAll(async () => {
    await db
      .delete(wsaa_tokens)
      .where(sql`${wsaa_tokens.tenant_id} IN (${tenantA}, ${tenantB})`);
    await db.delete(companies).where(sql`${companies.id} IN (${tenantA}, ${tenantB})`);
  });

  it('T1.1: INSERT tenant A + environment=homologacion → OK', async () => {
    const inserted = await db
      .insert(wsaa_tokens)
      .values({
        tenant_id: tenantA,
        environment: 'homologacion',
        token: 'token-homo-A-base64-payload-stub',
        sign: 'sign-homo-A-cookie-stub',
        generated_at: now,
        expires_at: in12h,
      })
      .returning({ id: wsaa_tokens.id });
    expect(inserted[0]?.id).toBeDefined();
  });

  it('T1.2: INSERT tenant A + environment=produccion → OK (UNIQUE incluye env, no choca con homo)', async () => {
    const inserted = await db
      .insert(wsaa_tokens)
      .values({
        tenant_id: tenantA,
        environment: 'produccion',
        token: 'token-prod-A-base64-payload-stub',
        sign: 'sign-prod-A-cookie-stub',
        generated_at: now,
        expires_at: in12h,
      })
      .returning({ id: wsaa_tokens.id });
    expect(inserted[0]?.id).toBeDefined();

    // Verifico que tenant A ahora tiene 2 rows (homo + prod).
    const rows = await db
      .select({ environment: wsaa_tokens.environment })
      .from(wsaa_tokens)
      .where(eq(wsaa_tokens.tenant_id, tenantA));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.environment).sort()).toEqual([
      'homologacion',
      'produccion',
    ]);
  });

  it('T1.3: INSERT duplicado (tenant A, environment=homologacion) → throw 23505', async () => {
    let caught: unknown;
    try {
      await db.insert(wsaa_tokens).values({
        tenant_id: tenantA,
        environment: 'homologacion',
        token: 'token-homo-A-duplicado',
        sign: 'sign-homo-A-duplicado',
        generated_at: now,
        expires_at: in12h,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const err = unwrapPgError(caught);
    expect(err.code).toBe('23505');
    expect(err.constraint).toBe('wsaa_tokens_tenant_env_unique');
  });

  it('T1.4: INSERT environment="invalido" → throw 23514 CHECK violation', async () => {
    let caught: unknown;
    try {
      await db.execute(sql`
        INSERT INTO wsaa_tokens (tenant_id, environment, token, sign, generated_at, expires_at)
        VALUES (${tenantB}, 'invalido', 'token-bad', 'sign-bad', ${now.toISOString()}, ${in12h.toISOString()})
      `);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const err = unwrapPgError(caught);
    expect(err.code).toBe('23514'); // check_violation
    expect(err.constraint).toBe('wsaa_tokens_environment_check');
  });

  it('T1.5: INSERT expires_at <= generated_at → throw 23514 CHECK violation', async () => {
    const inverted_expires = new Date(now.getTime() - 60 * 1000); // 1 min antes

    let caught: unknown;
    try {
      await db.insert(wsaa_tokens).values({
        tenant_id: tenantB,
        environment: 'homologacion',
        token: 'token-B-invalid-expiry',
        sign: 'sign-B-invalid-expiry',
        generated_at: now,
        expires_at: inverted_expires,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const err = unwrapPgError(caught);
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('wsaa_tokens_expiry_after_generation');
  });

  it('T1.6: per-tenant coexistence — tenant B mismo environment → OK (UNIQUE scoped por tenant; privileged client bypassa RLS)', async () => {
    const inserted = await db
      .insert(wsaa_tokens)
      .values({
        tenant_id: tenantB,
        environment: 'homologacion',
        token: 'token-homo-B-base64',
        sign: 'sign-homo-B-cookie',
        generated_at: now,
        expires_at: in12h,
      })
      .returning({ id: wsaa_tokens.id });
    expect(inserted[0]?.id).toBeDefined();

    // Verifico que ambos tenants tienen su row homologacion.
    const rows = await db
      .select({ tenant_id: wsaa_tokens.tenant_id })
      .from(wsaa_tokens)
      .where(eq(wsaa_tokens.environment, 'homologacion'));
    const tenants = rows.map((r) => r.tenant_id).sort();
    expect(tenants).toEqual([tenantA, tenantB].sort());
  });
});
