/**
 * T-MP-WORKER-03 — runMpReconcileBatch (drainer del job mp.reconcile_webhook).
 * Sprint 5 Sales+MP · Integrations context (Fase B) — cierra el flujo async e2e.
 *
 * Valida:
 * - job encolado + mp_payments(pending) → drain → reconcile approved → job 'done' + mp_payments 'approved'
 * - job con payload sin mp_payment_id → 'dead' (poison específico)
 * - cola vacía → processed=0
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { mp_payments } from '@/lib/db/schema/mp_payments';
import { jobs_queue } from '@/lib/db/schema/jobs_queue';
import { audit_log } from '@/lib/db/schema/audit';
import { enqueueJob } from '@/lib/jobs_queue/queue.service';
import { runMpReconcileBatch } from '@/lib/integrations/mercadopago/reconcile.worker';
import type { GetMpPaymentResult } from '@/lib/integrations/mercadopago/mp-api-client';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';

const tenantId = crypto.randomUUID();
const userId = crypto.randomUUID();

async function asTenant<T>(fn: () => Promise<T>): Promise<T> {
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

/** deps con token OK + fetch que devuelve el pago approved. */
const approvedDeps = {
  resolveAccessToken: async () => 'ACCESS-TOKEN',
  fetchPaymentFor: (_token: string) => async (mpPaymentId: string): Promise<GetMpPaymentResult> => ({
    ok: true,
    payment: {
      paymentId: mpPaymentId,
      status: 'approved',
      statusReclassified: false,
      rawStatus: 'approved',
      statusDetail: 'accredited',
      amount: '1500.0000',
      externalReference: 'sp_ref',
      paymentMethodId: 'visa',
      dateApproved: '2026-06-21T10:05:00.000-03:00',
    },
  }),
};

describe('T-MP-WORKER-03 — runMpReconcileBatch', () => {
  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-MP-WORKER-03 Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userId,
      email: `t-mp-worker-${tenantId.slice(0, 8)}@test.local`,
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
      await tx.delete(jobs_queue).where(eq(jobs_queue.tenant_id, tenantId));
      await tx.delete(mp_payments).where(eq(mp_payments.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('job encolado + mp_payments pending → drain → reconcile approved + job done', async () => {
    await db.insert(mp_payments).values({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      mp_payment_id: 'PAY-W1',
      status: 'pending',
      amount: '1500.0000',
    });
    const job = await asTenant(() =>
      enqueueJob({ job_type: 'mp.reconcile_webhook', payload: { mp_payment_id: 'PAY-W1' } })
    );

    const result = await runMpReconcileBatch(approvedDeps);
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.done).toBeGreaterThanOrEqual(1);

    const pay = await db
      .select()
      .from(mp_payments)
      .where(and(eq(mp_payments.tenant_id, tenantId), eq(mp_payments.mp_payment_id, 'PAY-W1')));
    expect(pay[0]!.status).toBe('approved');

    const jobRow = await db.select().from(jobs_queue).where(eq(jobs_queue.id, job.id));
    expect(jobRow[0]!.status).toBe('done');
  });

  it('job con payload sin mp_payment_id → dead (poison específico)', async () => {
    const job = await asTenant(() =>
      enqueueJob({ job_type: 'mp.reconcile_webhook', payload: { wrong: 'shape' } })
    );

    const result = await runMpReconcileBatch(approvedDeps);
    expect(result.dead).toBeGreaterThanOrEqual(1);

    const jobRow = await db.select().from(jobs_queue).where(eq(jobs_queue.id, job.id));
    expect(jobRow[0]!.status).toBe('dead');
  });

  it('cola vacía → processed = 0', async () => {
    const result = await runMpReconcileBatch(approvedDeps);
    expect(result.processed).toBe(0);
  });
});
