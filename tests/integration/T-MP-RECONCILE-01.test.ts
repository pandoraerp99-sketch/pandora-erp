/**
 * T-MP-RECONCILE-01 — reconcileMpPayment contra DB.
 * Sprint 5 Sales+MP · Integrations context (Fase B).
 *
 * Valida el slice fino webhook→reconcile (mock del re-fetch autoritativo):
 * - pending → approved: UPDATE mp_payments.status + reconciled_at + audit payment.mp.confirmed
 * - idempotencia: segundo reconcile con mismo status → noop
 * - mp_payment inexistente → mp_payment_not_found
 * - re-fetch falla (red) → fetch_failed (sin tocar la DB)
 *
 * "verify, don't trust": el status viene del fetchPayment mockeado (la API
 * autoritativa), nunca de un body de webhook.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { mp_payments } from '@/lib/db/schema/mp_payments';
import { audit_log } from '@/lib/db/schema/audit';
import { reconcileMpPayment } from '@/lib/integrations/mercadopago/reconcile.service';
import type { GetMpPaymentResult } from '@/lib/integrations/mercadopago/mp-api-client';
import type { MpPaymentInfo } from '@/lib/integrations/mercadopago/mp-payment-response';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';

const tenantId = crypto.randomUUID();
const userId = crypto.randomUUID();

async function runAs<T>(fn: () => Promise<T>): Promise<T> {
  return await withTracingContext(
    {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: tenantId,
      actor_user_id: userId,
      actor_type: 'system',
    },
    fn
  );
}

/** fetchPayment mock: devuelve un payment autoritativo con el status pedido. */
function mockFetch(status: MpPaymentInfo['status'], overrides: Partial<MpPaymentInfo> = {}) {
  return async (mpPaymentId: string): Promise<GetMpPaymentResult> => ({
    ok: true,
    payment: {
      paymentId: mpPaymentId,
      status,
      statusReclassified: false,
      rawStatus: status,
      statusDetail: 'accredited',
      amount: '1500.0000',
      externalReference: 'sale_payment_ref',
      paymentMethodId: 'visa',
      dateApproved: '2026-06-21T10:05:00.000-03:00',
      ...overrides,
    },
  });
}

async function seedMpPayment(mpPaymentId: string, status: string): Promise<string> {
  const rowId = crypto.randomUUID();
  await db.insert(mp_payments).values({
    id: rowId,
    tenant_id: tenantId,
    mp_payment_id: mpPaymentId,
    status,
    amount: '1500.0000',
  });
  return rowId;
}

describe('T-MP-RECONCILE-01 — reconcileMpPayment', () => {
  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-MP-RECONCILE-01 Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userId,
      email: `t-mp-reconcile-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Test',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(mp_payments).where(eq(mp_payments.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('pending → approved: actualiza status + reconciled_at + audita payment.mp.confirmed', async () => {
    const mpId = 'MP-APPROVE-1';
    await seedMpPayment(mpId, 'pending');

    const result = await runAs(() => reconcileMpPayment(mpId, { fetchPayment: mockFetch('approved') }));
    expect(result).toEqual({ outcome: 'updated', from: 'pending', to: 'approved', reclassified: false });

    const rows = await db
      .select()
      .from(mp_payments)
      .where(and(eq(mp_payments.tenant_id, tenantId), eq(mp_payments.mp_payment_id, mpId)));
    expect(rows[0]!.status).toBe('approved');
    expect(rows[0]!.reconciled_at).not.toBeNull();
    expect(rows[0]!.webhook_received_at).not.toBeNull();

    // audit: payment.mp.confirmed escrito
    const audits = await db
      .select()
      .from(audit_log)
      .where(and(eq(audit_log.tenant_id, tenantId), eq(audit_log.event_name, 'payment.mp.confirmed')));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('idempotente: segundo reconcile con el mismo status → noop', async () => {
    const mpId = 'MP-IDEMP-1';
    await seedMpPayment(mpId, 'pending');

    await runAs(() => reconcileMpPayment(mpId, { fetchPayment: mockFetch('approved') }));
    const second = await runAs(() =>
      reconcileMpPayment(mpId, { fetchPayment: mockFetch('approved') })
    );
    expect(second).toEqual({ outcome: 'noop_same_status', status: 'approved' });
  });

  it('mp_payment inexistente → mp_payment_not_found', async () => {
    const result = await runAs(() =>
      reconcileMpPayment('MP-NO-EXISTE', { fetchPayment: mockFetch('approved') })
    );
    expect(result).toEqual({ outcome: 'mp_payment_not_found', mpPaymentId: 'MP-NO-EXISTE' });
  });

  it('re-fetch falla (red) → fetch_failed sin tocar la DB', async () => {
    const mpId = 'MP-FETCHFAIL-1';
    await seedMpPayment(mpId, 'pending');

    const failingFetch = async (): Promise<GetMpPaymentResult> => ({
      ok: false,
      reason: 'network_error',
    });
    const result = await runAs(() => reconcileMpPayment(mpId, { fetchPayment: failingFetch }));
    expect(result).toEqual({ outcome: 'fetch_failed', reason: 'network_error' });

    // la DB quedó intacta (sigue pending)
    const rows = await db
      .select()
      .from(mp_payments)
      .where(and(eq(mp_payments.tenant_id, tenantId), eq(mp_payments.mp_payment_id, mpId)));
    expect(rows[0]!.status).toBe('pending');
  });
});
