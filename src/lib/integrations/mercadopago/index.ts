/**
 * Integrations context — MercadoPago. Public API.
 * BOUNDED-CONTEXTS.md · Sprint 5 ROADMAP Sales+MP.
 *
 * Fase A (esta capa, pura sin DB):
 *   - webhook-notification: parseo/validacion del body del webhook ("verify, don't trust")
 *   - mp-payment-response: parseo de GET /v1/payments/{id} — el status AUTORITATIVO ("verify")
 *   - payment-status: mapeo status API MP → enum canonico F0 ("reclassify with audit")
 *   - status-detail-message: status_detail → mensaje para el cajero (rioplatense)
 *
 * La validacion de FIRMA del webhook (x-signature HMAC) vive en `security/hmac.ts`
 * (validateMercadoPagoWebhook) + dedup en `security/webhook-dedup.ts`.
 *
 * Fase B (pendiente Docker + keys sandbox): API client HTTP (createPayment/getPayment),
 * route handler /api/webhooks/mp, worker mp.reconcile_webhook, persistencia mp_payments.
 */
export {
  parseMpWebhookNotification,
  type ParsedMpNotification,
} from './webhook-notification.js';

export {
  parseMpPaymentResponse,
  type MpPaymentInfo,
  type ParseMpPaymentResult,
} from './mp-payment-response.js';

export {
  mapMpApiPaymentStatus,
  isKnownMpApiStatus,
  type MappedMpStatus,
} from './payment-status.js';

export {
  statusDetailMessage,
  type StatusDetailInfo,
  type StatusDetailCategory,
} from './status-detail-message.js';

export {
  getMpPayment,
  type GetMpPaymentDeps,
  type GetMpPaymentResult,
  type MpFetch,
  type MpHttpResponse,
} from './mp-api-client.js';

export {
  reconcileMpPayment,
  type ReconcileMpDeps,
  type ReconcileMpOutcome,
} from './reconcile.service.js';

export {
  handleMpWebhook,
  type MpWebhookInput,
  type MpWebhookDeps,
  type MpWebhookResult,
} from './webhook-handler.js';

export { resolveMpWebhookSecret } from './mp-secret.js';
