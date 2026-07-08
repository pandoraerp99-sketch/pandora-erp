/**
 * T-MP-WEBHOOK-02 — handleMpWebhook contra DB (dedup + enqueue).
 * Sprint 5 Sales+MP · Integrations context (Fase B, borde del webhook).
 *
 * Valida la matriz de respuesta + efectos:
 * - firma válida + payment → 200 'enqueued' + job mp.reconcile_webhook en jobs_queue
 * - secret no configurado → 401
 * - firma inválida → 401
 * - recurso no-payment → 200 ignored
 * - webhook duplicado (dedup) → 200 already_processed + NO segundo job
 *
 * Firma construida con las primitivas reales (buildMercadoPagoManifest +
 * computeHmacSha256) — mismo algoritmo que MP.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { jobs_queue } from '@/lib/db/schema/jobs_queue';
import { processed_webhook_events } from '@/lib/db/schema/processed_webhook_events';
import {
  buildMercadoPagoManifest,
  computeHmacSha256,
} from '@/lib/security/hmac';
import {
  handleMpWebhook,
  type MpWebhookInput,
} from '@/lib/integrations/mercadopago/webhook-handler';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';

const tenantId = crypto.randomUUID();
const userId = crypto.randomUUID();
const SECRET = 'mp-webhook-secret-T02';
const secretOk = async () => SECRET;
const secretNull = async () => null;

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

/** Construye un input firmado válido (mismo esquema que MP: manifest + HMAC). */
function signed(opts: {
  paymentId: string;
  notifId: string;
  type?: string;
}): MpWebhookInput {
  const requestId = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  // MP firma el manifest con data.id (= payment id) del query + x-request-id + ts.
  const manifest = buildMercadoPagoManifest({
    dataId: opts.paymentId,
    requestId,
    timestamp: ts,
  });
  const v1 = computeHmacSha256(SECRET, manifest);
  const rawBody = JSON.stringify({
    id: opts.notifId,
    type: opts.type ?? 'payment',
    action: 'payment.updated',
    data: { id: opts.paymentId },
  });
  return {
    companyId: tenantId,
    rawBody,
    signatureHeader: `ts=${ts},v1=${v1}`,
    requestId,
    dataIdQuery: opts.paymentId,
  };
}

async function jobsFor(mpPaymentId: string) {
  const rows = await db
    .select()
    .from(jobs_queue)
    .where(
      and(
        eq(jobs_queue.tenant_id, tenantId),
        eq(jobs_queue.job_type, 'mp.reconcile_webhook')
      )
    );
  return rows.filter(
    (r) => (r.payload as { mp_payment_id?: string }).mp_payment_id === mpPaymentId
  );
}

describe('T-MP-WEBHOOK-02 — handleMpWebhook', () => {
  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-MP-WEBHOOK-02 Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userId,
      email: `t-mp-webhook-${tenantId.slice(0, 8)}@test.local`,
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
      await tx.delete(jobs_queue).where(eq(jobs_queue.tenant_id, tenantId));
      await tx
        .delete(processed_webhook_events)
        .where(eq(processed_webhook_events.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('firma válida + payment → 200 enqueued + job mp.reconcile_webhook encolado', async () => {
    const input = signed({ paymentId: 'PAY-100', notifId: 'NOTIF-100' });
    const res = await runAs(() => handleMpWebhook(input, { resolveSecret: secretOk }));
    expect(res).toEqual({ status: 200, reason: 'enqueued', enqueued: true });

    const jobs = await jobsFor('PAY-100');
    expect(jobs).toHaveLength(1);
  });

  it('secret no configurado → 401 (no_secret_configured)', async () => {
    const input = signed({ paymentId: 'PAY-101', notifId: 'NOTIF-101' });
    const res = await runAs(() => handleMpWebhook(input, { resolveSecret: secretNull }));
    expect(res.status).toBe(401);
    expect(res.reason).toBe('no_secret_configured');
  });

  it('firma inválida (v1 falso) → 401', async () => {
    const input = signed({ paymentId: 'PAY-102', notifId: 'NOTIF-102' });
    const tampered: MpWebhookInput = {
      ...input,
      signatureHeader: input.signatureHeader!.replace(/v1=.*/, 'v1=' + 'a'.repeat(64)),
    };
    const res = await runAs(() => handleMpWebhook(tampered, { resolveSecret: secretOk }));
    expect(res.status).toBe(401);
    expect(res.reason).toContain('signature_');
    // no encoló nada
    expect(await jobsFor('PAY-102')).toHaveLength(0);
  });

  it('recurso no-payment (merchant_order) → 200 ignored', async () => {
    const input = signed({ paymentId: 'MO-1', notifId: 'NOTIF-MO', type: 'merchant_order' });
    const res = await runAs(() => handleMpWebhook(input, { resolveSecret: secretOk }));
    expect(res.status).toBe(200);
    expect(res.reason).toBe('ignored_merchant_order');
  });

  it('webhook duplicado (mismo notif id) → 200 already_processed + NO segundo job', async () => {
    const input = signed({ paymentId: 'PAY-103', notifId: 'NOTIF-DUP' });
    const first = await runAs(() => handleMpWebhook(input, { resolveSecret: secretOk }));
    expect(first.reason).toBe('enqueued');

    const second = await runAs(() => handleMpWebhook(input, { resolveSecret: secretOk }));
    expect(second).toEqual({ status: 200, reason: 'already_processed' });

    // exactamente 1 job para PAY-103 (el dedup evitó el segundo)
    expect(await jobsFor('PAY-103')).toHaveLength(1);
  });
});
