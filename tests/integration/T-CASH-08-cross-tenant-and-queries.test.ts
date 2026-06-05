/**
 * T-CASH-08 — Cross-tenant isolation + integration coverage de queries cash.
 * Sprint 4 ROADMAP Cash context (C-OPS-01).
 *
 * **Por qué CRÍTICO (advisor 2026-06-04):**
 *
 * CLAUDE.md §18.4: *"Lo que NO puede mergearse sin test: cualquier query
 * cross-tenant (test que valide aislamiento)"*. CLAUDE.md §7.9 lista los
 * T-MT mandatory. CLAUDE.md §1.4 declara "cero fugas cross-tenant" como
 * métrica de éxito F0 no negociable.
 *
 * Para Inventory existe T-INV-07. Cash NO tenía equivalente — pure helpers
 * unit-tested NO sustituyen verificación empírica de fences cross-tenant en
 * los wrappers DB.
 *
 * **Doble objetivo del archivo (cubrir 2 huecos en uno):**
 *
 *   A) Cross-tenant fences (PRIMARIO):
 *      - getCashSessionById(B's id) bajo contexto A → null
 *      - getCashSessionSummary(B's id) bajo contexto A → null
 *      - closeCashSession(B's id) bajo contexto A → SessionNotFoundError
 *      - getActiveCashSession(salePoint=B's) bajo contexto A → A's o null,
 *        nunca B's
 *      - listCashSessions bajo contexto A → solo A's rows, nunca B's
 *
 *   B) Integration coverage de los wrappers (SECUNDARIO):
 *      - getCashSessionSummary: SQL real con movements join + agregados totals
 *      - listCashSessions: SQL real con multi-row + paginación + active_only
 *
 * **Estructura:** un único setup con 2 tenants ricos. Cada `it` cubre un
 * escenario aislado. Cada escenario abre su propio context A o B según
 * corresponda (la propiedad cross-tenant requiere SWITCHING contexto en
 * runtime, no solo seed-multi).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  openCashSession,
  closeCashSession,
  getActiveCashSession,
  getCashSessionById,
  SessionNotFoundError,
} from '@/lib/cash/sessions';
import { registerCashMovement } from '@/lib/cash/movements';
import {
  getCashSessionSummary,
  listCashSessions,
} from '@/lib/cash/queries';

describe('T-CASH-08 — Cross-tenant isolation + queries integration', () => {
  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  // Para Tenant A: 2 sessions (sp=1 ACTIVA con 3 movements + sp=2 CERRADA limpia)
  let sessionA_sp1_activeId: string | undefined;
  let sessionA_sp2_closedId: string | undefined;
  // Para Tenant B: 1 session abierta sp=1 con 1 movement
  let sessionB_sp1_activeId: string | undefined;

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
    // ── Seed companies ──
    await db.insert(companies).values([
      {
        id: tenantAId,
        name: 'T-CASH-08 Tenant A',
        legal_name: 'T-CASH-08 Tenant A SRL',
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
        name: 'T-CASH-08 Tenant B',
        legal_name: 'T-CASH-08 Tenant B SRL',
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      },
    ]);

    // ── Seed users ──
    await db.insert(users).values([
      {
        id: userAId,
        email: `t-cash-08-a-${tenantAId.slice(0, 8)}@test.local`,
        full_name: 'Cashier A',
        is_support: false,
      },
      {
        id: userBId,
        email: `t-cash-08-b-${tenantBId.slice(0, 8)}@test.local`,
        full_name: 'Cashier B',
        is_support: false,
      },
    ]);

    await db.insert(company_users).values([
      {
        id: crypto.randomUUID(),
        company_id: tenantAId,
        user_id: userAId,
        role: 'cashier',
      },
      {
        id: crypto.randomUUID(),
        company_id: tenantBId,
        user_id: userBId,
        role: 'cashier',
      },
    ]);

    // ── Tenant A: open session sp=1 con 3 movements ──
    const sA1 = await withCtx(tenantAId, userAId, () =>
      openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );
    sessionA_sp1_activeId = sA1.id;
    await withCtx(tenantAId, userAId, () =>
      registerCashMovement({
        cash_session_id: sA1.id,
        type: 'deposit',
        amount: '200.0000',
        reason: 'cambio extra para vuelto',
      })
    );
    await withCtx(tenantAId, userAId, () =>
      registerCashMovement({
        cash_session_id: sA1.id,
        type: 'withdraw',
        amount: '50.0000',
        reason: 'gasto operativo (cafe)',
      })
    );
    await withCtx(tenantAId, userAId, () =>
      registerCashMovement({
        cash_session_id: sA1.id,
        type: 'provider_payment',
        amount: '300.0000',
        reason: 'pago proveedor (entrega manana)',
      })
    );

    // ── Tenant A: open + close session sp=2 (limpia) ──
    const sA2 = await withCtx(tenantAId, userAId, () =>
      openCashSession({ sale_point: 2, initial_amount: '500.0000' })
    );
    sessionA_sp2_closedId = sA2.id;
    await withCtx(tenantAId, userAId, () =>
      closeCashSession({
        session_id: sA2.id,
        counted_amount: '500.0000',
        expected_amount: '500.0000',
      })
    );

    // ── Tenant B: open session sp=1 con 1 movement ──
    const sB1 = await withCtx(tenantBId, userBId, () =>
      openCashSession({ sale_point: 1, initial_amount: '777.0000' })
    );
    sessionB_sp1_activeId = sB1.id;
    await withCtx(tenantBId, userBId, () =>
      registerCashMovement({
        cash_session_id: sB1.id,
        type: 'deposit',
        amount: '23.0000',
        reason: 'reposicion B',
      })
    );
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx
        .delete(cash_movements)
        .where(
          sql`${cash_movements.cash_session_id} IN (
            SELECT id FROM cash_sessions WHERE tenant_id IN (${tenantAId}, ${tenantBId})
          )`
        );
      await tx
        .delete(cash_sessions)
        .where(sql`${cash_sessions.tenant_id} IN (${tenantAId}, ${tenantBId})`);
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
  //  A) CROSS-TENANT FENCES — bajo contexto A, recursos B son INVISIBLES
  // ════════════════════════════════════════════════════════════════

  describe('cross-tenant fences (CLAUDE.md §7.9 mandatory)', () => {
    it('getCashSessionById(B.id) bajo contexto A → null (no-distinguir "no existe" de "es de otro")', async () => {
      const result = await withCtx(tenantAId, userAId, () =>
        getCashSessionById(sessionB_sp1_activeId!)
      );
      expect(result).toBeNull();
    });

    it('getCashSessionSummary(B.id) bajo contexto A → null (NO devuelve session ni movements de B)', async () => {
      const result = await withCtx(tenantAId, userAId, () =>
        getCashSessionSummary(sessionB_sp1_activeId!)
      );
      expect(result).toBeNull();

      // Defensa adicional: verificar que B's session SÍ existe (sanity — para
      // descartar que el null venga de "la session no existe en absoluto").
      // Bajo contexto B la misma query devuelve la session.
      const fromB = await withCtx(tenantBId, userBId, () =>
        getCashSessionSummary(sessionB_sp1_activeId!)
      );
      expect(fromB).not.toBeNull();
      expect(fromB?.session.tenant_id).toBe(tenantBId);
    });

    it('closeCashSession(B.id) bajo contexto A → SessionNotFoundError (NO permite cerrar session de otro tenant)', async () => {
      let caught: unknown;
      try {
        await withCtx(tenantAId, userAId, () =>
          closeCashSession({
            session_id: sessionB_sp1_activeId!,
            counted_amount: '777.0000',
            expected_amount: '777.0000',
          })
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SessionNotFoundError);
      if (caught instanceof SessionNotFoundError) {
        expect(caught.session_id).toBe(sessionB_sp1_activeId!);
      }

      // Verifico que B's session SIGUE abierta (no se cerró por accidente).
      const stillOpen = await withCtx(tenantBId, userBId, () =>
        getCashSessionById(sessionB_sp1_activeId!)
      );
      expect(stillOpen?.closed_at).toBeNull();
    });

    it('getActiveCashSession(salePoint=1) bajo contexto A → A.sp1 (NUNCA B.sp1, aunque ambos tengan sp=1 abierta)', async () => {
      // Este es el caso "interesante" — ambos tenants tienen una session
      // ABIERTA en sale_point=1. Una query mal escrita sin filtro tenant_id
      // podría devolver B's. Verificamos que NO.
      const result = await withCtx(tenantAId, userAId, () =>
        getActiveCashSession(1)
      );
      expect(result).not.toBeNull();
      expect(result?.tenant_id).toBe(tenantAId);
      expect(result?.id).toBe(sessionA_sp1_activeId!);
      expect(result?.id).not.toBe(sessionB_sp1_activeId!);
    });

    it('listCashSessions bajo contexto A → SOLO sessions de A (nunca B)', async () => {
      const rowsA = await withCtx(tenantAId, userAId, () =>
        listCashSessions({ limit: 50 })
      );
      expect(rowsA.length).toBeGreaterThanOrEqual(2); // A tiene sp=1 (abierta) + sp=2 (cerrada)
      for (const row of rowsA) {
        expect(row.tenant_id).toBe(tenantAId);
        expect(row.tenant_id).not.toBe(tenantBId);
      }

      const idsA = rowsA.map((r) => r.id);
      expect(idsA).toContain(sessionA_sp1_activeId!);
      expect(idsA).toContain(sessionA_sp2_closedId!);
      expect(idsA).not.toContain(sessionB_sp1_activeId!);

      // Symmetric verification bajo contexto B.
      const rowsB = await withCtx(tenantBId, userBId, () =>
        listCashSessions({ limit: 50 })
      );
      expect(rowsB.length).toBeGreaterThanOrEqual(1);
      for (const row of rowsB) {
        expect(row.tenant_id).toBe(tenantBId);
      }
      const idsB = rowsB.map((r) => r.id);
      expect(idsB).toContain(sessionB_sp1_activeId!);
      expect(idsB).not.toContain(sessionA_sp1_activeId!);
      expect(idsB).not.toContain(sessionA_sp2_closedId!);
    });
  });

  // ════════════════════════════════════════════════════════════════
  //  B) INTEGRATION COVERAGE — los wrappers tocan DB real por primera vez
  // ════════════════════════════════════════════════════════════════

  describe('queries integration (primera DB-real coverage)', () => {
    it('getCashSessionSummary(A.sp1) bajo A → session + 3 movements ordered + totals correctos', async () => {
      const summary = await withCtx(tenantAId, userAId, () =>
        getCashSessionSummary(sessionA_sp1_activeId!)
      );

      expect(summary).not.toBeNull();
      expect(summary?.session.id).toBe(sessionA_sp1_activeId!);
      expect(summary?.session.tenant_id).toBe(tenantAId);
      expect(summary?.session.initial_amount).toBe('1000.0000');

      // 3 movements ordenados cronológicamente (asc created_at).
      expect(summary?.movements).toHaveLength(3);
      const types = summary?.movements.map((m) => m.type);
      expect(types).toEqual(['deposit', 'withdraw', 'provider_payment']);

      // Totals agregados por type (en TS, escala 10000):
      //   deposits   = 200.0000
      //   withdraws  =  50.0000
      //   prov.pay.  = 300.0000
      //   expected   = initial + deposits - withdraws - provider_payments
      //              = 1000 + 200 - 50 - 300 = 850.0000
      expect(summary?.totals.total_deposits).toBe('200.0000');
      expect(summary?.totals.total_withdraws).toBe('50.0000');
      expect(summary?.totals.total_provider_payments).toBe('300.0000');
      expect(summary?.totals.expected_from_movements).toBe('850.0000');
    });

    it('getCashSessionSummary(A.sp2 cerrada limpia) bajo A → session cerrada + 0 movements + totals zero', async () => {
      const summary = await withCtx(tenantAId, userAId, () =>
        getCashSessionSummary(sessionA_sp2_closedId!)
      );

      expect(summary).not.toBeNull();
      expect(summary?.session.closed_at).not.toBeNull();
      expect(summary?.session.descuadre).toBe('0.0000');
      expect(summary?.movements).toHaveLength(0);
      expect(summary?.totals.total_deposits).toBe('0.0000');
      expect(summary?.totals.total_withdraws).toBe('0.0000');
      expect(summary?.totals.total_provider_payments).toBe('0.0000');
      expect(summary?.totals.expected_from_movements).toBe('500.0000'); // = initial_amount
    });

    it('listCashSessions con active_only=true bajo A → SOLO A.sp1 (cerrada A.sp2 NO entra)', async () => {
      const rows = await withCtx(tenantAId, userAId, () =>
        listCashSessions({ active_only: true, limit: 50 })
      );
      // Solo A.sp1 está abierta — A.sp2 fue cerrada en beforeAll.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(sessionA_sp1_activeId!);
      expect(rows[0]?.closed_at).toBeNull();
    });

    it('listCashSessions con paginación (limit + offset) bajo A → respeta orden opened_at DESC + paginación correcta', async () => {
      // A tiene 2 sessions. limit=1 + offset=0 → más reciente (sp=2 cerrada,
      // porque se abrió después que sp=1 en beforeAll).
      const page1 = await withCtx(tenantAId, userAId, () =>
        listCashSessions({ limit: 1, offset: 0 })
      );
      expect(page1).toHaveLength(1);

      // limit=1 + offset=1 → la otra session (sp=1).
      const page2 = await withCtx(tenantAId, userAId, () =>
        listCashSessions({ limit: 1, offset: 1 })
      );
      expect(page2).toHaveLength(1);

      // No deben repetirse — paginación válida.
      expect(page1[0]?.id).not.toBe(page2[0]?.id);

      // Ambos pertenecen a A.
      expect(page1[0]?.tenant_id).toBe(tenantAId);
      expect(page2[0]?.tenant_id).toBe(tenantAId);

      // Orden: opened_at DESC. La sp=2 se abrió DESPUÉS de sp=1.
      // Por lo tanto page1 (más reciente) debería ser A.sp2.
      expect(page1[0]?.id).toBe(sessionA_sp2_closedId!);
      expect(page2[0]?.id).toBe(sessionA_sp1_activeId!);
    });
  });
});
