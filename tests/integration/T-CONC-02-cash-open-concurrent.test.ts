/**
 * T-CONC-02 — Apertura concurrente de cash session (mismo tenant + sale_point).
 * Sprint 4 ROADMAP Cash context (C-OPS-01) — gemelo conceptual de T-INV-04
 * para concurrencia.
 *
 * **Por qué CRÍTICO:**
 * El UNIQUE partial index `cash_sessions_open_unique_partial` debe sobrevivir
 * a 2 requests SIMULTÁNEOS (no solo serializados). Sin verificación empírica
 * de race condition, no podemos afirmar que la garantía "1 session abierta
 * por (tenant, sale_point)" se mantiene bajo carga real.
 *
 * **Escenario real:**
 * Dos pestañas del POS abren caja simultáneamente:
 *   T1: BEGIN; INSERT cash_sessions (tenant=A, sp=1) ...
 *   T2: BEGIN; INSERT cash_sessions (tenant=A, sp=1) → BLOQUEA por UNIQUE partial
 *   T1: COMMIT; ← gana
 *   T2: receives unique_violation (PG ERRCODE 23505) → service lo mapea a
 *       ActiveSessionAlreadyOpenError, transaction rollback.
 *
 * **Lo que validamos:**
 * - Exactamente 1 fulfilled + 1 rejected en Promise.allSettled
 * - El rejection ES instancia de ActiveSessionAlreadyOpenError (no otro error)
 * - El error reporta tenant_id + sale_point correctos
 * - Stock final: exactly 1 row en cash_sessions abierta para (tenant, sp=1)
 * - El audit_log tiene exactly 1 evento `cash_session.opened` (no 2 — el
 *   rollback de la perdedora también revierte su audit insert)
 *
 * **Patrón:** copia exacta de T-INV-04 — 1 sólo `it()` con Promise.allSettled.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { openCashSession, ActiveSessionAlreadyOpenError } from '@/lib/cash/sessions';

describe('T-CONC-02 — Apertura concurrente cash session', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-CONC-02 Test Co',
      legal_name: 'T-CONC-02 Test Co SRL',
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
      email: `t-conc-02-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier Concurrent',
      is_support: false,
    });

    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });
  });

  afterAll(async () => {
    // Cleanup — session_replication_role='replica' bypass del trigger
    // immutable post-close. En T-CONC-02 la session ganadora NO se cierra,
    // pero el bypass es preventivo + consistente con T-CASH-01.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx
        .delete(cash_sessions)
        .where(eq(cash_sessions.tenant_id, tenantId));
      // audit_log de este test se mantiene (consistente con T-INV-04).
      await tx
        .delete(company_users)
        .where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('2 promises paralelas openCashSession mismo (tenant, sale_point) → 1 OK + 1 ActiveSessionAlreadyOpenError; exactly 1 row open; exactly 1 audit', async () => {
    // Helper: envuelve openCashSession en tracing context propio
    // (correlation_id + request_id ÚNICO por intento — refleja 2 requests
    // independientes de la realidad).
    const openOne = (initial: string) =>
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        () => openCashSession({ sale_point: 1, initial_amount: initial })
      );

    // Lanzar las 2 aperturas en paralelo. Promise.allSettled — sabemos que
    // una va a rechazar (no Promise.all que cortaría temprano).
    const results = await Promise.allSettled([
      openOne('1000.0000'),
      openOne('2000.0000'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // ── Assert: exactamente 1 + 1 ──
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // ── Assert: la rechazada ES ActiveSessionAlreadyOpenError ──
    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection).toBeInstanceOf(ActiveSessionAlreadyOpenError);
    if (rejection instanceof ActiveSessionAlreadyOpenError) {
      expect(rejection.tenant_id).toBe(tenantId);
      expect(rejection.sale_point).toBe(1);
    }

    // ── Assert: la ganadora tiene los campos esperados ──
    const winner = (fulfilled[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof openCashSession>>
    >).value;
    expect(winner.tenant_id).toBe(tenantId);
    expect(winner.sale_point).toBe(1);
    expect(winner.closed_at).toBeNull();
    // El initial_amount será uno de los dos — no asumimos cuál ganó.
    expect(['1000.0000', '2000.0000']).toContain(winner.initial_amount);

    // ── Assert: stock DB final → exactly 1 row open en (tenant, sp=1) ──
    const openRows = await db
      .select()
      .from(cash_sessions)
      .where(
        and(
          eq(cash_sessions.tenant_id, tenantId),
          eq(cash_sessions.sale_point, 1),
          isNull(cash_sessions.closed_at)
        )
      );
    expect(openRows).toHaveLength(1);
    expect(openRows[0]?.id).toBe(winner.id);

    // ── Assert: total rows en cash_sessions tenant === 1 ──
    // (la perdedora hizo rollback, NO quedó cerrada huérfana ni nada)
    const allTenantRows = await db
      .select({ id: cash_sessions.id })
      .from(cash_sessions)
      .where(eq(cash_sessions.tenant_id, tenantId));
    expect(allTenantRows).toHaveLength(1);

    // ── Assert: exactly 1 audit `cash_session.opened` para este tenant ──
    // Si el audit hubiera quedado huérfano de la perdedora (bug en tx), aquí
    // veríamos 2. Verifica que audit_log + cash_sessions INSERT son atómicos
    // (mismo tx — rollback colectivo cuando UNIQUE viola).
    const auditRows = await db
      .select({
        id: audit_log.id,
        event_name: audit_log.event_name,
        payload: audit_log.payload,
      })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'cash_session.opened')
        )
      );
    expect(auditRows).toHaveLength(1);

    const auditPayload = auditRows[0]?.payload as {
      session_id: string;
      sale_point: number;
      initial_amount: string;
    };
    expect(auditPayload.session_id).toBe(winner.id);
    expect(auditPayload.sale_point).toBe(1);
    expect(auditPayload.initial_amount).toBe(winner.initial_amount);
  });
});
