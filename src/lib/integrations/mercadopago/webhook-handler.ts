/**
 * Handler del webhook de MercadoPago — el "borde fino" (CLAUDE.md §6.4: cero
 * lógica de negocio en el handler HTTP). Valida firma per-tenant → dedup →
 * encola `mp.reconcile_webhook` → responde. La reconciliación real corre async
 * en el worker (verify, don't trust) para responder <22s (ventana de MP).
 *
 * Testeable directo (orquestación pura + deps inyectables); el route Next.js es
 * un wrapper delgado que lee el Request y llama esto.
 *
 * Matriz de respuesta (fail-closed):
 *   - secret no resoluble / firma inválida → 401 (sin filtrar si el company existe)
 *   - body no-JSON / shape inválido → 400
 *   - recurso no-payment (merchant_order, etc.) → 200 (ack, nada que hacer)
 *   - webhook ya procesado (dedup) → 200 (idempotente)
 *   - encolado OK → 200
 *   - encolado FALLA → 500 (no aceptamos durablemente → MP reintenta cada 15min)
 *
 * Corre dentro de un tracing context (tenant_id = company_id del path per-tenant).
 * El correlation_id del context se propaga al job encolado → el worker lo hereda →
 * trazabilidad end-to-end webhook→reconcile→audit (CORRELATION-PROPAGATION.md).
 */
import { validateMercadoPagoWebhook } from '../../security/hmac.js';
import {
  hashWebhookPayload,
  tryRegisterWebhookEvent,
} from '../../security/webhook-dedup.js';
import { enqueueJob } from '../../jobs_queue/queue.service.js';
import { parseMpWebhookNotification } from './webhook-notification.js';

export interface MpWebhookInput {
  companyId: string;
  rawBody: string;
  signatureHeader: string | null;
  /** header x-request-id de MP (parte del manifest firmado). */
  requestId: string | null;
  /** query `data.id` — lo que MP firma en el manifest. */
  dataIdQuery: string | null;
}

export interface MpWebhookDeps {
  /** Resuelve el webhook secret del tenant (per-tenant via vault). null → no configurado. */
  resolveSecret: (companyId: string) => Promise<string | null>;
  /** para tests deterministicos de freshness. */
  nowMs?: number;
}

export interface MpWebhookResult {
  status: 200 | 400 | 401 | 500;
  reason: string;
  enqueued?: boolean;
}

export async function handleMpWebhook(
  input: MpWebhookInput,
  deps: MpWebhookDeps
): Promise<MpWebhookResult> {
  // 1. Secret per-tenant. Sin secret → no podemos autenticar → 401 (fail-closed, sin leak).
  const secret = await deps.resolveSecret(input.companyId);
  if (secret === null || secret.length === 0) {
    return { status: 401, reason: 'no_secret_configured' };
  }

  // 2. Autenticidad: HMAC + freshness (validateMercadoPagoWebhook, security/hmac).
  const verdict = validateMercadoPagoWebhook({
    secret,
    signatureHeader: input.signatureHeader ?? '',
    dataId: input.dataIdQuery ?? '',
    requestId: input.requestId ?? '',
    nowMs: deps.nowMs,
  });
  if (!verdict.ok) {
    return { status: 401, reason: `signature_${verdict.reason}` };
  }

  // 3. Parse del body (ya autenticado). Solo procesamos 'payment'.
  const parsed = parseMpWebhookNotification(input.rawBody);
  if (parsed.kind === 'invalid') {
    return { status: 400, reason: `body_${parsed.reason}` };
  }
  if (parsed.kind === 'ignored') {
    return { status: 200, reason: `ignored_${parsed.type}` };
  }

  // 4. Dedup (replay protection). event_id = id de la notificación MP.
  const eventId = parsed.notificationId ?? parsed.paymentId;
  const registration = await tryRegisterWebhookEvent({
    provider: 'mercadopago',
    event_id: eventId,
    payload_hash: hashWebhookPayload(input.rawBody),
    signature_validated: true,
    tenant_id: input.companyId,
  });
  if (!registration.isNew) {
    return { status: 200, reason: 'already_processed' };
  }

  // 5. Encolar la reconciliación async. El worker re-consulta MP (verify, don't trust).
  try {
    await enqueueJob({
      job_type: 'mp.reconcile_webhook',
      payload: { mp_payment_id: parsed.paymentId },
    });
  } catch {
    // No aceptamos durablemente → 500 → MP reintenta. Edge raro (dedup registrado
    // pero job no) mitigado por idempotencia del reconcile + sweep pending (F1).
    return { status: 500, reason: 'enqueue_failed' };
  }

  return { status: 200, reason: 'enqueued', enqueued: true };
}
