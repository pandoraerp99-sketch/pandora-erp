/**
 * T-WEBHOOK-01 — UNIQUE atomic INSERT ON CONFLICT en processed_webhook_events.
 * Sprint 1 ROADMAP Platform + CLAUDE.md §17.7 (idempotency obligatoria).
 *
 * **Por qué CRÍTICO:** los providers (MercadoPago, AFIP) reentregan webhooks
 * con el MISMO event_id ante errores de red, timeouts, o retries automáticos.
 * Sin dedup atómica, el handler procesaría 2 veces (doble confirmación de pago,
 * doble update de stock, etc).
 *
 * **Lo que validamos:**
 * - Primera llegada de (provider, event_id) → isNew=true + row insertado
 * - Segunda llegada del mismo (provider, event_id) → isNew=false + metadata
 *   existente devuelta (processed_at + correlation_id + payload_hash)
 * - 2 llegadas paralelas atómicas: exactamente 1 INSERT, otro hace SELECT fallback
 * - Tamper detection: mismo event_id + payload_hash distinto → caller puede
 *   detectar la divergencia comparando existing_payload_hash vs el actual
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { processed_webhook_events } from '@/lib/db/schema/processed_webhook_events';
import {
  tryRegisterWebhookEvent,
  hashWebhookPayload,
} from '@/lib/security/webhook-dedup';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';

describe('T-WEBHOOK-01 — UNIQUE atomic INSERT ON CONFLICT dedup', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-WEBHOOK-01 Test Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userId,
      email: `t-webhook-01-${tenantId.slice(0, 8)}@test.local`,
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
      await tx
        .delete(processed_webhook_events)
        .where(eq(processed_webhook_events.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('Primera llegada → isNew=true + row insertado en DB', async () => {
    const payload = JSON.stringify({ id: 'mp-001', type: 'payment' });
    const hash = hashWebhookPayload(payload);

    const result = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        tryRegisterWebhookEvent({
          provider: 'mercadopago',
          event_id: 'mp-evt-T01',
          payload_hash: hash,
          signature_validated: true,
        })
    );
    expect(result.isNew).toBe(true);
    if (result.isNew) {
      expect(result.row.event_id).toBe('mp-evt-T01');
      expect(result.row.provider).toBe('mercadopago');
      expect(result.row.payload_hash).toBe(hash);
    }

    // Confirma DB state
    const dbRows = await db
      .select()
      .from(processed_webhook_events)
      .where(eq(processed_webhook_events.event_id, 'mp-evt-T01'));
    expect(dbRows).toHaveLength(1);
  });

  it('Segunda llegada del mismo (provider, event_id) → isNew=false + metadata existente', async () => {
    const payload = JSON.stringify({ id: 'mp-001', type: 'payment' });
    const hash = hashWebhookPayload(payload);
    const correlationFirst = generateCorrelationId();
    const correlationSecond = generateCorrelationId();

    // Primer registro (con correlation A)
    await withTracingContext(
      {
        correlation_id: correlationFirst,
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        tryRegisterWebhookEvent({
          provider: 'mercadopago',
          event_id: 'mp-evt-T02',
          payload_hash: hash,
          signature_validated: true,
        })
    );

    // Segundo intento (con correlation B) — debería ver isNew=false
    const secondResult = await withTracingContext(
      {
        correlation_id: correlationSecond,
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        tryRegisterWebhookEvent({
          provider: 'mercadopago',
          event_id: 'mp-evt-T02',
          payload_hash: hash,
          signature_validated: true,
        })
    );
    expect(secondResult.isNew).toBe(false);
    if (!secondResult.isNew) {
      // El correlation_id existente es el del PRIMER intento (correlationFirst)
      expect(secondResult.existing_correlation_id).toBe(correlationFirst);
      expect(secondResult.existing_payload_hash).toBe(hash);
      expect(secondResult.existing_processed_at).toBeInstanceOf(Date);
    }
  });

  it('Tamper detection: mismo event_id + payload_hash distinto → caller detecta divergencia', async () => {
    const payloadOriginal = JSON.stringify({ id: 'mp-002', amount: 100 });
    const payloadTampered = JSON.stringify({ id: 'mp-002', amount: 999999 });
    const hashOriginal = hashWebhookPayload(payloadOriginal);
    const hashTampered = hashWebhookPayload(payloadTampered);
    expect(hashOriginal).not.toBe(hashTampered); // sanity

    // Primer registro con payload original
    await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        tryRegisterWebhookEvent({
          provider: 'mercadopago',
          event_id: 'mp-evt-T03',
          payload_hash: hashOriginal,
          signature_validated: true,
        })
    );

    // Segundo intento con MISMO event_id pero payload tampered
    const tamperResult = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        tryRegisterWebhookEvent({
          provider: 'mercadopago',
          event_id: 'mp-evt-T03',
          payload_hash: hashTampered, // ← distinto
          signature_validated: true,
        })
    );

    expect(tamperResult.isNew).toBe(false);
    if (!tamperResult.isNew) {
      // El service devuelve el hash ORIGINAL — el caller hace la comparación
      // y emite `security.webhook_payload_mismatch` si difieren.
      expect(tamperResult.existing_payload_hash).toBe(hashOriginal);
      expect(tamperResult.existing_payload_hash).not.toBe(hashTampered);
    }
  });

  it('2 llegadas paralelas con mismo (provider, event_id) → exactamente 1 isNew=true + 1 isNew=false (UNIQUE atomic)', async () => {
    const payload = JSON.stringify({ id: 'mp-003', concurrent: true });
    const hash = hashWebhookPayload(payload);

    const registerAttempt = () =>
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        () =>
          tryRegisterWebhookEvent({
            provider: 'mercadopago',
            event_id: 'mp-evt-T04-concurrent',
            payload_hash: hash,
            signature_validated: true,
          })
      );

    const [resultA, resultB] = await Promise.all([registerAttempt(), registerAttempt()]);
    const news = [resultA, resultB].filter((r) => r.isNew);
    const dups = [resultA, resultB].filter((r) => !r.isNew);
    expect(news).toHaveLength(1);
    expect(dups).toHaveLength(1);

    // Verifica que solo 1 row insertado (UNIQUE constraint enforce)
    const dbRows = await db
      .select()
      .from(processed_webhook_events)
      .where(eq(processed_webhook_events.event_id, 'mp-evt-T04-concurrent'));
    expect(dbRows).toHaveLength(1);
  });

  it('Distinct providers con mismo event_id → ambos isNew=true (UNIQUE es por (provider, event_id))', async () => {
    // Un AFIP webhook y un MP webhook con event_id='shared-001' deben coexistir.
    const hash = createHash('sha256').update('shared-payload').digest('hex');

    const mpResult = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        tryRegisterWebhookEvent({
          provider: 'mercadopago',
          event_id: 'shared-001',
          payload_hash: hash,
          signature_validated: true,
        })
    );
    expect(mpResult.isNew).toBe(true);

    const afipResult = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        tryRegisterWebhookEvent({
          provider: 'afip',
          event_id: 'shared-001', // mismo event_id, distinto provider
          payload_hash: hash,
          signature_validated: true,
        })
    );
    expect(afipResult.isNew).toBe(true); // ← coexisten porque provider distinto
  });
});
