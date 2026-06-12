/**
 * T-PADRON-01 — Schema padron_a5_cache: UNIQUE (tenant_id, cuit) + per-tenant coexistence.
 * Mini-audit pre-Sprint 6 fiscal + CLAUDE.md §17.2 + §3.5 (A-4 pendiente contadora).
 *
 * **HONESTY NOTE (advisor catch 2026-06-12):** Este test corre con el `db`
 * client privileged que BYPASSA RLS. Por lo tanto T1.4 verifica que la
 * constraint UNIQUE está scoped per-tenant (mismo CUIT permitido para
 * tenants distintos), NO que RLS aisle lecturas cross-tenant.
 *
 * Real isolation test (tenant A no ve rows de tenant B vía SELECT con
 * tenant-context JWT) requiere helper `withRlsContext()` que NO existe
 * en el repo todavía — gap sistémico documentado en ROADMAP §1054.
 * Cuando exista, agregar tests en `tests/cross-tenant/`.
 *
 * Política caché Padrón A5 exacta pendiente A-4 contadora (estricto vs permisivo +
 * tolerancia timeout). Este test NO valida policy — solo que el SCHEMA enforce:
 *
 *   T1.1 INSERT inicial → OK
 *   T1.2 INSERT duplicado mismo (tenant, cuit) → throw 23505 unique_violation
 *   T1.3 UPSERT misma key → fetched_at se actualiza, NO duplica
 *   T1.4 Per-tenant coexistence: tenant distinto + mismo CUIT → OK (UNIQUE scoped por tenant)
 *
 * Cache TTL semantics + stale-while-revalidate quedan para Sprint 6 cuando se
 * arme el service padron lookup. Schema solo enforce uniqueness.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { padron_a5_cache } from '@/lib/db/schema/padron_a5_cache';

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

describe('T-PADRON-01 — padron_a5_cache UNIQUE + per-tenant coexistence (NOT RLS isolation)', () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const cuitConsultado = '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

  beforeAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.insert(companies).values({
        id: tenantId,
        name: `T-PADRON-01 Co ${tenantId.slice(0, 8)}`,
        legal_name: `T-PADRON-01 Co SRL ${tenantId.slice(0, 8)}`,
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
      .delete(padron_a5_cache)
      .where(
        sql`${padron_a5_cache.tenant_id} IN (${tenantA}, ${tenantB})`
      );
    await db.delete(companies).where(sql`${companies.id} IN (${tenantA}, ${tenantB})`);
  });

  it('T1.1: INSERT inicial tenant A + cuit X → OK', async () => {
    const inserted = await db
      .insert(padron_a5_cache)
      .values({
        tenant_id: tenantA,
        cuit: cuitConsultado,
        data: { estadoClave: 'ACTIVO', razonSocial: 'Test SA', test: true },
      })
      .returning({ id: padron_a5_cache.id });
    expect(inserted[0]?.id).toBeDefined();
  });

  it('T1.2: INSERT duplicado mismo (tenant A, cuit X) → throw 23505 unique_violation', async () => {
    let caught: unknown;
    try {
      await db.insert(padron_a5_cache).values({
        tenant_id: tenantA,
        cuit: cuitConsultado,
        data: { estadoClave: 'ACTIVO', razonSocial: 'Re-insert', test: true },
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const err = unwrapPgError(caught);
    expect(err.code).toBe('23505'); // unique_violation
    expect(err.constraint).toBe('padron_a5_cache_tenant_cuit_unique');
  });

  it('T1.3: UPSERT misma key (tenant A, cuit X) → fetched_at actualizado, NO duplica row', async () => {
    const rowsBefore = await db
      .select({ id: padron_a5_cache.id, fetched_at: padron_a5_cache.fetched_at })
      .from(padron_a5_cache)
      .where(
        and(
          eq(padron_a5_cache.tenant_id, tenantA),
          eq(padron_a5_cache.cuit, cuitConsultado)
        )
      );
    expect(rowsBefore).toHaveLength(1);
    const fetchedAtBefore = rowsBefore[0]!.fetched_at;

    // Pequeño sleep para garantizar diff timestamp visible
    await new Promise((r) => setTimeout(r, 50));

    // UPSERT pattern: ON CONFLICT DO UPDATE sobre la unique constraint.
    await db
      .insert(padron_a5_cache)
      .values({
        tenant_id: tenantA,
        cuit: cuitConsultado,
        data: { estadoClave: 'ACTIVO', razonSocial: 'Updated', updated: true },
        fetched_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [padron_a5_cache.tenant_id, padron_a5_cache.cuit],
        set: {
          data: { estadoClave: 'ACTIVO', razonSocial: 'Updated', updated: true },
          fetched_at: new Date(),
        },
      });

    const rowsAfter = await db
      .select({ id: padron_a5_cache.id, fetched_at: padron_a5_cache.fetched_at })
      .from(padron_a5_cache)
      .where(
        and(
          eq(padron_a5_cache.tenant_id, tenantA),
          eq(padron_a5_cache.cuit, cuitConsultado)
        )
      );
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0]!.id).toBe(rowsBefore[0]!.id);
    expect(rowsAfter[0]!.fetched_at.getTime()).toBeGreaterThan(
      fetchedAtBefore.getTime()
    );
  });

  it('T1.4: per-tenant coexistence — tenant B mismo CUIT → OK (UNIQUE scoped por tenant; privileged client bypassa RLS)', async () => {
    const inserted = await db
      .insert(padron_a5_cache)
      .values({
        tenant_id: tenantB,
        cuit: cuitConsultado, // mismo CUIT que tenant A
        data: { estadoClave: 'ACTIVO', razonSocial: 'Tenant B view', test: true },
      })
      .returning({ id: padron_a5_cache.id });
    expect(inserted[0]?.id).toBeDefined();

    // Verifico que existen 2 rows (1 por tenant) con el mismo CUIT.
    const rows = await db
      .select({ tenant_id: padron_a5_cache.tenant_id })
      .from(padron_a5_cache)
      .where(eq(padron_a5_cache.cuit, cuitConsultado));
    const tenants = rows.map((r) => r.tenant_id).sort();
    expect(tenants).toEqual([tenantA, tenantB].sort());
  });
});
