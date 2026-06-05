/**
 * T-CASH-02 — Cierre con descuadre > $5000 → audit warning + métrica + severity high.
 * Sprint 4 ROADMAP Cash context (C-OPS-01) — verifica el path "comerciante
 * descuadró fuerte y debe quedar trazado para investigación".
 *
 * **Por qué importa:**
 * El flow descuadre alto activa 3 invariantes simultáneas:
 *   1. discrepancy_reason OBLIGATORIO (CHECK constraint + validación service)
 *   2. event_name = 'cash_session.closed_with_difference' + severity='warning'
 *      (vs 'cash_session.closed' info en cierre limpio)
 *   3. métrica `cash_session.diff.amount` tag sign='negative' (falta de plata) +
 *      severity_label='high' (|descuadre| > $5000 = umbral DESCUADRE_HIGH_THRESHOLD_ARS)
 *
 * Sin trace correcto, RUNBOOKS/cash-discrepancy.md no puede operar:
 * la Pandora team no sabe qué cajas investigar (S2).
 *
 * **Escenario:**
 *   open: initial=10000 sale_point=1
 *   close: counted=4000 expected=10000 → descuadre = 4000 - 10000 = -6000
 *          → faltante (negative) + alto (|6000| > $5000)
 *
 * **Aserciones críticas:**
 *   - session.descuadre = '-6000.0000'
 *   - session.discrepancy_reason = 'caja olvidada abierta toda la noche'
 *   - audit row: event='cash_session.closed_with_difference', severity='warning',
 *     payload.descuadre_sign='negative', payload.severity_label='high'
 *   - metrics_counter (sign='negative') count=1
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

describe('T-CASH-02 — Cierre con descuadre alto', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-CASH-02 Test Co',
      legal_name: 'T-CASH-02 Test Co SRL',
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
      email: `t-cash-02-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier T-CASH-02',
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
    // Cleanup con bypass del trigger immutable post-close.
    // metrics_counter NO se filtra por tenant en una FK CASCADE — limpiamos
    // explícitamente las rows de este tenant.
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

  it('descuadre = -6000 (counted < expected, magnitud > $5000) → warning + sign negative + severity high + reason persistido + métrica incrementada', async () => {
    // ─── Open ───
    const opened = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '10000.0000' })
    );
    expect(opened.initial_amount).toBe('10000.0000');

    // ─── Close con descuadre negativo alto ───
    const reason = 'caja olvidada abierta toda la noche';
    const closeResult = await withCtx(() =>
      closeCashSession({
        session_id: opened.id,
        counted_amount: '4000.0000',
        expected_amount: '10000.0000',
        discrepancy_reason: reason,
      })
    );

    // ─── Assertions sobre el result del service ───
    expect(closeResult.descuadre).toBe('-6000.0000');
    expect(closeResult.descuadre_sign).toBe('negative');
    expect(closeResult.severity_label).toBe('high'); // |6000| > $5000 threshold
    expect(closeResult.session.discrepancy_reason).toBe(reason);
    expect(closeResult.session.closed_at).not.toBeNull();
    expect(closeResult.session.final_amount).toBe('4000.0000');
    expect(closeResult.session.expected_amount).toBe('10000.0000');

    // ─── Assertions sobre row persistida ───
    const persisted = await db
      .select()
      .from(cash_sessions)
      .where(eq(cash_sessions.id, opened.id))
      .limit(1);
    expect(persisted[0]?.descuadre).toBe('-6000.0000');
    expect(persisted[0]?.discrepancy_reason).toBe(reason);

    // ─── Assertions sobre audit_log ───
    const auditRows = await db
      .select({
        event_name: audit_log.event_name,
        severity: audit_log.severity,
        payload: audit_log.payload,
      })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'cash_session.closed_with_difference')
        )
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.severity).toBe('warning');

    const auditPayload = auditRows[0]?.payload as {
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
    expect(auditPayload.session_id).toBe(opened.id);
    expect(auditPayload.sale_point).toBe(1);
    expect(auditPayload.descuadre).toBe('-6000.0000');
    expect(auditPayload.descuadre_sign).toBe('negative');
    expect(auditPayload.severity_label).toBe('high');
    expect(auditPayload.discrepancy_reason).toBe(reason);

    // ─── Assertions sobre metrics_counter ───
    // El tag sign='negative' debería tener count >= 1 (puede ser 1 si T-CASH-02
    // corre aislado; estricto = 1 porque tenantId es UUID único por suite).
    const metricRows = await db
      .select({
        count: metrics_counter.count,
        tag_value: metrics_counter.tag_value,
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
    expect(metricRows[0]?.tag_value).toBe('negative');
    expect(Number(metricRows[0]?.count)).toBe(1);

    // ─── Verificación NO event 'closed' info (solo 'closed_with_difference') ───
    // Para evitar double-emit por bug en el branching del service.
    const cleanCloseAudits = await db
      .select({ id: audit_log.id })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'cash_session.closed')
        )
      );
    expect(cleanCloseAudits).toHaveLength(0);
  });
});
