/**
 * T-CASH-03 — Cierre limpio (descuadre = 0) → audit info + métrica sign=zero + no reason.
 * Sprint 4 ROADMAP Cash context (C-OPS-01) — mirror conceptual de T-CASH-02
 * para el happy path.
 *
 * **Por qué importa:**
 * El branching del service decide event_name y severity según
 * `descuadre_sign === 'zero'`:
 *   - 'cash_session.closed' + severity='info' + discrepancy_reason=NULL → ESTE test
 *   - 'cash_session.closed_with_difference' + severity='warning' → T-CASH-02
 * Sin verificar ambos branches, un swap entre ramas no se detectaría
 * (la métrica reportaría volumen incorrecto + dashboards mostrarían noise).
 *
 * **Escenario:**
 *   open: initial=5000 sale_point=1
 *   close: counted=5000 expected=5000 → descuadre = 0
 *   (NO se pasa discrepancy_reason — el service no lo necesita ni guarda nada)
 *
 * **Aserciones críticas:**
 *   - session.descuadre = '0.0000'
 *   - session.discrepancy_reason = NULL (NO una string vacía)
 *   - audit row: event='cash_session.closed', severity='info',
 *     payload.descuadre_sign='zero', payload.severity_label='none',
 *     payload.discrepancy_reason=null
 *   - metrics_counter (sign='zero') count=1
 *   - NO se emite 'cash_session.closed_with_difference' (defensa contra
 *     branching invertido)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { audit_log } from '@/lib/db/schema/audit';
import { metrics_counter } from '@/lib/db/schema/metrics';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { openCashSession, closeCashSession } from '@/lib/cash/sessions';

describe('T-CASH-03 — Cierre limpio descuadre=0', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-CASH-03 Test Co',
      legal_name: 'T-CASH-03 Test Co SRL',
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
      email: `t-cash-03-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier T-CASH-03',
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
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx
        .delete(metrics_counter)
        .where(eq(metrics_counter.tenant_id, tenantId));
      await tx
        .delete(cash_sessions)
        .where(eq(cash_sessions.tenant_id, tenantId));
      await tx
        .delete(company_users)
        .where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  const withCtx = async <T,>(fn: () => Promise<T>): Promise<T> =>
    withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      fn
    );

  it('descuadre = 0 sin reason → event closed info + sign zero + severity none + reason NULL persisted + métrica incrementada', async () => {
    const opened = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '5000.0000' })
    );
    expect(opened.initial_amount).toBe('5000.0000');

    // Close sin discrepancy_reason — el service NO debe exigirlo cuando
    // descuadre = 0 (lo confirma prepareCloseSessionUpdate).
    const closeResult = await withCtx(() =>
      closeCashSession({
        session_id: opened.id,
        counted_amount: '5000.0000',
        expected_amount: '5000.0000',
        // discrepancy_reason omitido a propósito
      })
    );

    // ─── Service result ───
    expect(closeResult.descuadre).toBe('0.0000');
    expect(closeResult.descuadre_sign).toBe('zero');
    expect(closeResult.severity_label).toBe('none');
    expect(closeResult.session.discrepancy_reason).toBeNull();
    expect(closeResult.session.closed_at).not.toBeNull();

    // ─── Row persistida ───
    const persisted = await db
      .select()
      .from(cash_sessions)
      .where(eq(cash_sessions.id, opened.id))
      .limit(1);
    expect(persisted[0]?.descuadre).toBe('0.0000');
    expect(persisted[0]?.discrepancy_reason).toBeNull();
    expect(persisted[0]?.final_amount).toBe('5000.0000');
    expect(persisted[0]?.expected_amount).toBe('5000.0000');

    // ─── Audit_log ───
    // Esperamos exactamente 2 audit en este tenant:
    //   - cash_session.opened (info) — emitido al abrir
    //   - cash_session.closed (info) — emitido en este cierre limpio
    // NUNCA 'cash_session.closed_with_difference'.
    const closedRows = await db
      .select({
        severity: audit_log.severity,
        payload: audit_log.payload,
      })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'cash_session.closed')
        )
      );
    expect(closedRows).toHaveLength(1);
    expect(closedRows[0]?.severity).toBe('info');

    const closedPayload = closedRows[0]?.payload as {
      session_id: string;
      sale_point: number;
      initial_amount: string;
      final_amount: string;
      expected_amount: string;
      descuadre: string;
      descuadre_sign: string;
      severity_label: string;
      discrepancy_reason: string | null;
    };
    expect(closedPayload.session_id).toBe(opened.id);
    expect(closedPayload.descuadre).toBe('0.0000');
    expect(closedPayload.descuadre_sign).toBe('zero');
    expect(closedPayload.severity_label).toBe('none');
    expect(closedPayload.discrepancy_reason).toBeNull();
    expect(closedPayload.final_amount).toBe('5000.0000');
    expect(closedPayload.expected_amount).toBe('5000.0000');

    // ─── Defensa contra branching invertido ───
    const withDifferenceRows = await db
      .select({ id: audit_log.id })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'cash_session.closed_with_difference')
        )
      );
    expect(withDifferenceRows).toHaveLength(0);

    // ─── Metrics counter ───
    const metricRows = await db
      .select({
        tag_value: metrics_counter.tag_value,
        count: metrics_counter.count,
      })
      .from(metrics_counter)
      .where(
        and(
          eq(metrics_counter.tenant_id, tenantId),
          eq(metrics_counter.metric_name, 'cash_session.diff.amount'),
          eq(metrics_counter.tag_key, 'sign')
        )
      );
    expect(metricRows).toHaveLength(1);
    expect(metricRows[0]?.tag_value).toBe('zero');
    expect(Number(metricRows[0]?.count)).toBe(1);
  });
});
