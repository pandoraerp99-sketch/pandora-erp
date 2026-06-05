/**
 * T-CASH-01 — UNIQUE partial constraint flows lineales.
 * Sprint 4 ROADMAP Cash context (C-OPS-01) — el motivo de existir del schema.
 *
 * **Por qué CRÍTICO:**
 * El UNIQUE partial index
 *   `cash_sessions_open_unique_partial ON cash_sessions(tenant_id, sale_point)
 *    WHERE closed_at IS NULL`
 * garantiza la invariante operativa: **solo 1 session abierta por
 * (tenant, sale_point)**. Sin verificación empírica, esa garantía es un claim
 * NO PROBADO (mismo patrón Spike A1 que validó stock_movements oversell).
 *
 * **Lo que validamos (6 flows lineales en 1 `it` — la concurrencia pura va
 * en T-CONC-02 separado para mantener atómico el test de orden):**
 *
 * F1. Tenant A abre session sale_point=1, initial=1000.0000 → OK
 * F2. Tenant A intenta SEGUNDA session mismo sale_point=1
 *     → throw ActiveSessionAlreadyOpenError (mapeo PG ERRCODE 23505)
 *     + se mantiene exactly 1 session abierta (NO se creó row nueva)
 * F3. Tenant A cierra primera (descuadre=0) + abre nueva mismo sale_point=1
 *     → OK (la cerrada NO entra al partial index, abre nueva sin colisión)
 * F4. Tenant A abre session sale_point=2 → OK (distinct sale_point, independiente)
 * F5. Tenant B abre session sale_point=1 → OK (distinct tenant, distinct namespace)
 * F6. Estado final: 3 sessions abiertas + 1 cerrada en (A,B) — cross-tenant
 *     integrity verificada.
 *
 * **Patrón:** copia T-INV-04 (1 sólo `it` con flows lineales, evita asunción de
 * orden entre `it` blocks y mantiene seed/teardown atómico).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  openCashSession,
  closeCashSession,
  ActiveSessionAlreadyOpenError,
} from '@/lib/cash/sessions';

describe('T-CASH-01 — UNIQUE partial constraint flows lineales', () => {
  // UUIDs únicos por suite — aislamiento contra otros tests integration
  // (no hay truncate global, tests coexisten en mismo Supabase Local).
  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  beforeAll(async () => {
    // ── Seed 2 companies (tenants distintos) ──
    await db.insert(companies).values([
      {
        id: tenantAId,
        name: 'T-CASH-01 Tenant A',
        legal_name: 'T-CASH-01 Tenant A SRL',
        // CUIT formato `^[0-9]{11}$` (CHECK constraint companies)
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
        name: 'T-CASH-01 Tenant B',
        legal_name: 'T-CASH-01 Tenant B SRL',
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      },
    ]);

    // ── Seed 1 user por tenant ──
    await db.insert(users).values([
      {
        id: userAId,
        email: `t-cash-01-a-${tenantAId.slice(0, 8)}@test.local`,
        full_name: 'Cashier A',
        is_support: false,
      },
      {
        id: userBId,
        email: `t-cash-01-b-${tenantBId.slice(0, 8)}@test.local`,
        full_name: 'Cashier B',
        is_support: false,
      },
    ]);

    // ── Link user ↔ company ──
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
  });

  afterAll(async () => {
    // Cleanup orden inverso. `session_replication_role='replica'` bypassea
    // el trigger `cash_sessions_immutable_after_close` que bloquea DELETE de
    // sessions cerradas (comportamiento correcto en runtime, escape hatch
    // necesario solo para test cleanup — mismo patrón T-INV-04).
    //
    // **audit_log:** acumulación esperada. F1+ trigger para test-DB cleanup
    // global si crece (por ahora consistent con T-INV-04 — no se limpia).
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      // cash_sessions FIRST — no se crearon cash_movements en T-CASH-01.
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

  // Helper: envuelve cualquier op cash con tracing context apropiado.
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

  it('flows lineales — abrir/colisión/cerrar/reabrir/distinto-sp/distinto-tenant/integrity', async () => {
    // ─── F1: Tenant A abre session sale_point=1 ───────────────────
    const sessionA_sp1_initial = await withCtx(tenantAId, userAId, () =>
      openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );
    expect(sessionA_sp1_initial.tenant_id).toBe(tenantAId);
    expect(sessionA_sp1_initial.sale_point).toBe(1);
    expect(sessionA_sp1_initial.initial_amount).toBe('1000.0000');
    expect(sessionA_sp1_initial.opened_by).toBe(userAId);
    expect(sessionA_sp1_initial.closed_at).toBeNull();
    expect(sessionA_sp1_initial.descuadre).toBeNull();

    // ─── F2: Tenant A intenta SEGUNDA session mismo sale_point=1 ──
    //   → debe rechazar con ActiveSessionAlreadyOpenError (PG 23505).
    let caught: unknown = undefined;
    try {
      await withCtx(tenantAId, userAId, () =>
        openCashSession({ sale_point: 1, initial_amount: '500.0000' })
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ActiveSessionAlreadyOpenError);
    if (caught instanceof ActiveSessionAlreadyOpenError) {
      expect(caught.tenant_id).toBe(tenantAId);
      expect(caught.sale_point).toBe(1);
      expect(caught.message).toMatch(/ya existe una session de caja abierta/);
    }
    // Verifico que NO se creó row nueva — sigue habiendo exactly 1 abierta
    // para (tenantA, sp=1) y es la inicial.
    const stillOnlyA_sp1 = await db
      .select()
      .from(cash_sessions)
      .where(
        and(
          eq(cash_sessions.tenant_id, tenantAId),
          eq(cash_sessions.sale_point, 1),
          isNull(cash_sessions.closed_at)
        )
      );
    expect(stillOnlyA_sp1).toHaveLength(1);
    expect(stillOnlyA_sp1[0]?.id).toBe(sessionA_sp1_initial.id);

    // ─── F3: Cerrar la primera + abrir nueva mismo sale_point=1 ───
    //   descuadre=0 → cierre limpio sin reason.
    const closeResult = await withCtx(tenantAId, userAId, () =>
      closeCashSession({
        session_id: sessionA_sp1_initial.id,
        counted_amount: '1000.0000',
        expected_amount: '1000.0000',
      })
    );
    expect(closeResult.descuadre).toBe('0.0000');
    expect(closeResult.descuadre_sign).toBe('zero');
    expect(closeResult.severity_label).toBe('none');
    expect(closeResult.session.closed_at).not.toBeNull();
    expect(closeResult.session.discrepancy_reason).toBeNull();

    // Abrir nueva session mismo sale_point=1 — el UNIQUE partial ignora
    // sessions cerradas (WHERE closed_at IS NULL), así que la cerrada NO
    // bloquea la apertura nueva.
    const sessionA_sp1_reopened = await withCtx(tenantAId, userAId, () =>
      openCashSession({ sale_point: 1, initial_amount: '2000.0000' })
    );
    expect(sessionA_sp1_reopened.id).not.toBe(sessionA_sp1_initial.id);
    expect(sessionA_sp1_reopened.tenant_id).toBe(tenantAId);
    expect(sessionA_sp1_reopened.sale_point).toBe(1);
    expect(sessionA_sp1_reopened.initial_amount).toBe('2000.0000');
    expect(sessionA_sp1_reopened.closed_at).toBeNull();

    // ─── F4: Tenant A abre session sale_point=2 ───────────────────
    //   distinct sale_point → no colisión con el UNIQUE partial.
    const sessionA_sp2 = await withCtx(tenantAId, userAId, () =>
      openCashSession({ sale_point: 2, initial_amount: '500.0000' })
    );
    expect(sessionA_sp2.tenant_id).toBe(tenantAId);
    expect(sessionA_sp2.sale_point).toBe(2);
    expect(sessionA_sp2.closed_at).toBeNull();

    // ─── F5: Tenant B abre session sale_point=1 ───────────────────
    //   distinct tenant → namespace separado. NO colisiona con la
    //   session abierta de Tenant A en sale_point=1.
    const sessionB_sp1 = await withCtx(tenantBId, userBId, () =>
      openCashSession({ sale_point: 1, initial_amount: '3000.0000' })
    );
    expect(sessionB_sp1.tenant_id).toBe(tenantBId);
    expect(sessionB_sp1.sale_point).toBe(1);
    expect(sessionB_sp1.closed_at).toBeNull();

    // ─── F6: Estado final cross-tenant integrity ──────────────────
    //   Esperamos exactamente:
    //   - 3 sessions abiertas: A/sp=1 reopened + A/sp=2 + B/sp=1
    //   - 1 session cerrada: A/sp=1 initial
    const allRows = await db
      .select({
        id: cash_sessions.id,
        tenant_id: cash_sessions.tenant_id,
        sale_point: cash_sessions.sale_point,
        closed_at: cash_sessions.closed_at,
      })
      .from(cash_sessions)
      .where(sql`${cash_sessions.tenant_id} IN (${tenantAId}, ${tenantBId})`);

    expect(allRows).toHaveLength(4); // 3 open + 1 closed

    const openRows = allRows.filter((r) => r.closed_at === null);
    const closedRows = allRows.filter((r) => r.closed_at !== null);
    expect(openRows).toHaveLength(3);
    expect(closedRows).toHaveLength(1);
    expect(closedRows[0]?.id).toBe(sessionA_sp1_initial.id);

    const openIdsSet = new Set(openRows.map((r) => r.id));
    expect(openIdsSet.has(sessionA_sp1_reopened.id)).toBe(true);
    expect(openIdsSet.has(sessionA_sp2.id)).toBe(true);
    expect(openIdsSet.has(sessionB_sp1.id)).toBe(true);

    // Verifico también el conteo per-tenant + per-sale_point para detectar
    // accidental cross-tenant leak.
    const aSp1Open = openRows.filter(
      (r) => r.tenant_id === tenantAId && r.sale_point === 1
    );
    const aSp2Open = openRows.filter(
      (r) => r.tenant_id === tenantAId && r.sale_point === 2
    );
    const bSp1Open = openRows.filter(
      (r) => r.tenant_id === tenantBId && r.sale_point === 1
    );
    expect(aSp1Open).toHaveLength(1);
    expect(aSp2Open).toHaveLength(1);
    expect(bSp1Open).toHaveLength(1);
  });
});
