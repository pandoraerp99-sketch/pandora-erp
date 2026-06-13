/**
 * T-MT-04 — Cross-tenant RLS isolation sobre wsaa_tokens + padron_a5_cache.
 * CLAUDE.md §7.9 mandatory test multi-tenant + ADR-0002 + ADR-0019 S13 +
 * advisor catch 2026-06-12 (mini-audit pre-Sprint 6 fiscal).
 *
 * **Por qué este test es MUST-DO** (advisor catch 2026-06-12):
 * Las migrations 0011 (padron_a5_cache) + 0012 (wsaa_tokens) crearon tablas
 * SIN RLS. Se cerró el gap con migration 0013 (ENABLE RLS + policies) pero
 * la verificación behavioral quedó como deuda — "applied but not verified".
 * Sin este test, 0013 es solo "ALTER TABLE corrió sin error". No hay
 * garantía empírica de que un context tenant A NO ve secrets de tenant B.
 *
 * **Por qué es particularmente crítico** (CLAUDE.md §11.8):
 * wsaa_tokens.token + wsaa_tokens.sign son SECRETS plaintext (cache no
 * vault). Una fuga cross-tenant aquí significaría que el tenant A puede
 * usar el token AFIP del tenant B → emitir facturas en nombre de B con CAE
 * legítimo de AFIP. Catástrofe legal + fiscal + Ley 25.326.
 *
 * Cobertura:
 *   T4.1: SELECT padron_a5_cache desde A solo ve entries de A
 *   T4.2: SELECT wsaa_tokens desde A solo ve tokens de A (NO secrets de B)
 *   T4.3: UPDATE padron_a5_cache de B desde context A → 0 rows
 *   T4.4: INSERT padron_a5_cache con tenant_id=B desde A → throw RLS
 *   T4.5: UPDATE wsaa_tokens de B desde context A → 0 rows (secret intacto)
 *   T4.6: INSERT wsaa_tokens con tenant_id=B desde A → throw RLS
 *   T4.7: SELECT por CUIT compartido — UNIQUE (tenant_id, cuit) permite
 *         que ambos tenants tengan misma CUIT cacheada; RLS asegura que
 *         A solo ve SU entry, no la de B.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { padron_a5_cache } from '@/lib/db/schema/padron_a5_cache';
import { wsaa_tokens } from '@/lib/db/schema/wsaa_tokens';
import { withRlsContext } from '@/lib/multi_tenant/rls_context';

function unwrapPgError(e: unknown): { code?: string; message: string } {
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

describe('T-MT-04 — cross-tenant RLS sobre wsaa_tokens + padron_a5_cache', () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  // CUIT compartido entre tenants — caso real: dos comercios consultan el
  // mismo cliente final. UNIQUE (tenant_id, cuit) permite coexistencia.
  // RLS debe asegurar que cada tenant SOLO ve su row.
  const sharedCuit = '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  let padronIdA: string | undefined;
  let padronIdB: string | undefined;
  let tokenIdA: string | undefined;
  let tokenIdB: string | undefined;

  beforeAll(async () => {
    // Setup con `db` privileged (bypassa RLS) — necesario porque sembramos rows
    // de 2 tenants desde un solo contexto de test.
    for (const [tenantId, userId] of [
      [tenantA, userA],
      [tenantB, userB],
    ] as const) {
      await db.insert(companies).values({
        id: tenantId,
        name: `T-MT-04 Co ${tenantId.slice(0, 8)}`,
        legal_name: `T-MT-04 Co SRL ${tenantId.slice(0, 8)}`,
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
        email: `t-mt-04-${userId.slice(0, 8)}@test.local`,
        full_name: `User T-MT-04 ${userId.slice(0, 4)}`,
        is_support: false,
      });

      await db.insert(company_users).values({
        id: crypto.randomUUID(),
        company_id: tenantId,
        user_id: userId,
        role: 'cashier',
      });
    }

    // Padron entries — MISMO CUIT, cada tenant tiene su data distinta.
    padronIdA = crypto.randomUUID();
    padronIdB = crypto.randomUUID();
    await db.insert(padron_a5_cache).values({
      id: padronIdA,
      tenant_id: tenantA,
      cuit: sharedCuit,
      data: { razonSocial: 'CLIENTE VISTO POR TENANT A', estadoClave: 'ACTIVO' },
      fetched_at: new Date(),
    });
    await db.insert(padron_a5_cache).values({
      id: padronIdB,
      tenant_id: tenantB,
      cuit: sharedCuit,
      data: { razonSocial: 'CLIENTE VISTO POR TENANT B', estadoClave: 'ACTIVO' },
      fetched_at: new Date(),
    });

    // WSAA tokens — MISMO environment (homologacion), secrets distintos.
    // Los valores son ficticios pero el shape es el real (base64-ish).
    tokenIdA = crypto.randomUUID();
    tokenIdB = crypto.randomUUID();
    const futureExpiry = new Date(Date.now() + 12 * 60 * 60 * 1000); // +12h
    const generatedAt = new Date();
    await db.insert(wsaa_tokens).values({
      id: tokenIdA,
      tenant_id: tenantA,
      environment: 'homologacion',
      token: 'TOKEN_SECRETO_DEL_TENANT_A_NO_DEBE_FUGAR',
      sign: 'SIGN_SECRETO_DEL_TENANT_A',
      generated_at: generatedAt,
      expires_at: futureExpiry,
    });
    await db.insert(wsaa_tokens).values({
      id: tokenIdB,
      tenant_id: tenantB,
      environment: 'homologacion',
      token: 'TOKEN_SECRETO_DEL_TENANT_B_NO_DEBE_FUGAR',
      sign: 'SIGN_SECRETO_DEL_TENANT_B',
      generated_at: generatedAt,
      expires_at: futureExpiry,
    });
  });

  afterAll(async () => {
    await db
      .delete(wsaa_tokens)
      .where(inArray(wsaa_tokens.tenant_id, [tenantA, tenantB]));
    await db
      .delete(padron_a5_cache)
      .where(inArray(padron_a5_cache.tenant_id, [tenantA, tenantB]));
    await db
      .delete(company_users)
      .where(inArray(company_users.company_id, [tenantA, tenantB]));
    await db.delete(users).where(inArray(users.id, [userA, userB]));
    await db.delete(companies).where(inArray(companies.id, [tenantA, tenantB]));
  });

  it('T4.1: SELECT padron_a5_cache desde context A solo ve entries de A', async () => {
    await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
      const rows = await tx
        .select({
          id: padron_a5_cache.id,
          tenant_id: padron_a5_cache.tenant_id,
          data: padron_a5_cache.data,
        })
        .from(padron_a5_cache);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(tenantA);
      expect(rows[0]?.id).toBe(padronIdA);
      // Sanity: la data NO es la del tenant B aunque tengan el mismo CUIT
      const data = rows[0]?.data as { razonSocial: string };
      expect(data.razonSocial).toBe('CLIENTE VISTO POR TENANT A');
    });
  });

  it('T4.2: SELECT wsaa_tokens desde context A solo ve token de A (NO secrets de B)', async () => {
    await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
      const rows = await tx
        .select({
          id: wsaa_tokens.id,
          tenant_id: wsaa_tokens.tenant_id,
          token: wsaa_tokens.token,
          sign: wsaa_tokens.sign,
        })
        .from(wsaa_tokens);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(tenantA);
      // **Defensa crítica**: el token+sign de B NO deben aparecer en el result
      // set bajo ningún concepto. Si esta línea falla, hay fuga de secret.
      expect(rows[0]?.token).not.toContain('TENANT_B');
      expect(rows[0]?.sign).not.toContain('TENANT_B');
      expect(rows[0]?.token).toBe('TOKEN_SECRETO_DEL_TENANT_A_NO_DEBE_FUGAR');
    });
  });

  it('T4.3: UPDATE padron entry de B desde context A → 0 rows (silent)', async () => {
    expect(padronIdB).toBeDefined();

    const result = await withRlsContext(
      { sub: userA, company_id: tenantA },
      async (tx) => {
        return tx.execute<{ id: string }>(sql`
          UPDATE padron_a5_cache
          SET data = '{"razonSocial":"HACKEADO POR A"}'::jsonb
          WHERE id = ${padronIdB!}
          RETURNING id
        `);
      }
    );
    expect(result).toHaveLength(0);

    // Verificar con db privileged que el data de B sigue intacto
    const rows = await db
      .select({ data: padron_a5_cache.data })
      .from(padron_a5_cache)
      .where(eq(padron_a5_cache.id, padronIdB!));
    const data = rows[0]?.data as { razonSocial: string };
    expect(data.razonSocial).toBe('CLIENTE VISTO POR TENANT B');
  });

  it('T4.4: INSERT padron con tenant_id=B desde context A → throw RLS WITH CHECK', async () => {
    let caught: unknown;
    try {
      await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
        await tx.insert(padron_a5_cache).values({
          tenant_id: tenantB, // <-- atacante intenta inyectar tenant ajeno
          cuit: '99999999999',
          data: { razonSocial: 'INYECCION DESDE A' },
          fetched_at: new Date(),
        });
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const err = unwrapPgError(caught);
    expect(err.message).toMatch(/row-level security|policy/i);
  });

  it('T4.5: UPDATE wsaa_tokens de B desde context A → 0 rows (secret intacto)', async () => {
    expect(tokenIdB).toBeDefined();

    const result = await withRlsContext(
      { sub: userA, company_id: tenantA },
      async (tx) => {
        return tx.execute<{ id: string }>(sql`
          UPDATE wsaa_tokens
          SET token = 'TOKEN_HACKEADO', sign = 'SIGN_HACKEADO'
          WHERE id = ${tokenIdB!}
          RETURNING id
        `);
      }
    );
    expect(result).toHaveLength(0);

    // Verificación crítica: el token de B sigue siendo el original.
    // Si esto falla, un atacante con context A pudo sobrescribir el secret
    // de B (catástrofe — denial of service fiscal de B + posibilidad de
    // inyectar secret malicioso).
    const rows = await db
      .select({ token: wsaa_tokens.token, sign: wsaa_tokens.sign })
      .from(wsaa_tokens)
      .where(eq(wsaa_tokens.id, tokenIdB!));
    expect(rows[0]?.token).toBe('TOKEN_SECRETO_DEL_TENANT_B_NO_DEBE_FUGAR');
    expect(rows[0]?.sign).toBe('SIGN_SECRETO_DEL_TENANT_B');
  });

  it('T4.6: INSERT wsaa_tokens con tenant_id=B desde A → throw RLS WITH CHECK', async () => {
    let caught: unknown;
    try {
      await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
        await tx.insert(wsaa_tokens).values({
          tenant_id: tenantB,
          environment: 'produccion', // inyectar token prod en cuenta de B
          token: 'TOKEN_INYECTADO_MALICIOSO',
          sign: 'SIGN_INYECTADO_MALICIOSO',
          generated_at: new Date(),
          expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000),
        });
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const err = unwrapPgError(caught);
    expect(err.message).toMatch(/row-level security|policy/i);
  });

  it('T4.7: SELECT por CUIT compartido — A ve solo SU entry (no la de B con mismo CUIT)', async () => {
    // Caso real: dos comerciantes distintos cachean el padrón del mismo cliente
    // final. UNIQUE (tenant_id, cuit) permite coexistencia. RLS debe aislarlos.
    await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
      const rows = await tx
        .select({
          id: padron_a5_cache.id,
          tenant_id: padron_a5_cache.tenant_id,
          data: padron_a5_cache.data,
        })
        .from(padron_a5_cache)
        .where(eq(padron_a5_cache.cuit, sharedCuit));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(padronIdA);
      expect(rows[0]?.tenant_id).toBe(tenantA);
    });

    // Espejo desde B — ve solo SU entry
    await withRlsContext({ sub: userB, company_id: tenantB }, async (tx) => {
      const rows = await tx
        .select({ id: padron_a5_cache.id, tenant_id: padron_a5_cache.tenant_id })
        .from(padron_a5_cache)
        .where(eq(padron_a5_cache.cuit, sharedCuit));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(padronIdB);
      expect(rows[0]?.tenant_id).toBe(tenantB);
    });

    // Cross-check privileged: ambas entries existen (no es que B no la tenga)
    const allRows = await db
      .select()
      .from(padron_a5_cache)
      .where(eq(padron_a5_cache.cuit, sharedCuit));
    expect(allRows).toHaveLength(2);
  });
});
