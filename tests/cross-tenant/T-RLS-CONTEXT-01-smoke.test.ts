/**
 * T-RLS-CONTEXT-01 — Smoke test del helper withRlsContext().
 * Mini-audit pre-Sprint 6 fiscal (advisor catch 2026-06-12) + CLAUDE.md §7.9.
 *
 * Verifica que el helper:
 *   T1.1 setea request.jwt.claims que auth.jwt() lee correctamente
 *   T1.2 cambia el role a 'authenticated' dentro del context
 *   T1.3 pandora.current_company_ids() devuelve company_id single
 *   T1.4 pandora.current_company_ids() devuelve company_ids array completo (accountant)
 *   T1.5 throw si jwt sin company_id NI company_ids (guard explícito)
 *   T1.6 priority array sobre single — si JWT trae ambos, accountant path gana
 *        (coalesce(company_ids, [company_id]) en current_company_ids)
 *
 * NO testea RLS isolation per se — eso es T-MT-01..07 con tablas reales.
 * Acá solo: ¿el plumbing funciona? ¿auth.jwt() y current_company_ids() ven
 * lo que el helper setea?
 */
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withRlsContext } from '@/lib/multi_tenant/rls_context';

describe('T-RLS-CONTEXT-01 — withRlsContext smoke', () => {
  it('T1.1: setea request.jwt.claims que auth.jwt() lee', async () => {
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();

    await withRlsContext({ sub: userId, company_id: companyId }, async (tx) => {
      const rows = await tx.execute<{ jwt: { sub: string; company_id: string } }>(
        sql`SELECT auth.jwt() AS jwt`
      );
      const jwt = rows[0]?.jwt;
      expect(jwt?.sub).toBe(userId);
      expect(jwt?.company_id).toBe(companyId);
    });
  });

  it('T1.2: role authenticated activo dentro del context', async () => {
    await withRlsContext(
      { sub: crypto.randomUUID(), company_id: crypto.randomUUID() },
      async (tx) => {
        const rows = await tx.execute<{ role: string }>(
          sql`SELECT current_user AS role`
        );
        expect(rows[0]?.role).toBe('authenticated');
      }
    );
  });

  it('T1.3: current_company_ids() devuelve UUID single del JWT', async () => {
    const companyId = crypto.randomUUID();
    await withRlsContext(
      { sub: crypto.randomUUID(), company_id: companyId },
      async (tx) => {
        const rows = await tx.execute<{ id: string }>(
          sql`SELECT id FROM pandora.current_company_ids() AS id`
        );
        expect(rows.map((r) => r.id)).toEqual([companyId]);
      }
    );
  });

  it('T1.4: current_company_ids() devuelve array completo (accountant)', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await withRlsContext(
      { sub: crypto.randomUUID(), company_ids: ids },
      async (tx) => {
        const rows = await tx.execute<{ id: string }>(
          sql`SELECT id FROM pandora.current_company_ids() AS id`
        );
        expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
      }
    );
  });

  it('T1.5: throw si jwt sin company_id NI company_ids (guard)', async () => {
    await expect(
      withRlsContext({ sub: crypto.randomUUID() }, async () => undefined)
    ).rejects.toThrow(/company_id/);
  });

  it('T1.6: si JWT trae company_id Y company_ids, array gana (coalesce migration 0003)', async () => {
    const arrayId = crypto.randomUUID();
    const singleId = crypto.randomUUID();
    await withRlsContext(
      { sub: crypto.randomUUID(), company_id: singleId, company_ids: [arrayId] },
      async (tx) => {
        const rows = await tx.execute<{ id: string }>(
          sql`SELECT id FROM pandora.current_company_ids() AS id`
        );
        const ids = rows.map((r) => r.id);
        // Migration 0003 SQL: COALESCE(company_ids, [company_id]) → array gana
        expect(ids).toContain(arrayId);
        expect(ids).not.toContain(singleId);
      }
    );
  });
});
