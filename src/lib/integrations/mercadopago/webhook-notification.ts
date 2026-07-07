/**
 * Parser + validacion del BODY de notificaciones webhook de MercadoPago.
 * Sprint 5 ROADMAP Sales+MP — Integrations context (BOUNDED-CONTEXTS).
 *
 * Contrato oficial (verificado 2026-07-07):
 * https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks
 * Shape del body:
 *   { id, live_mode, type, action, date_created, user_id, api_version, data: { id } }
 *   - `id`      = id de la NOTIFICACION (para dedup en processed_webhook_events)
 *   - `type`    = recurso notificado ('payment' | 'merchant_order' | ...). F0 solo 'payment'.
 *   - `action`  = evento ('payment.created' | 'payment.updated')
 *   - `data.id` = id del PAGO a consultar via GET /v1/payments/{id}
 *
 * **INVARIANTE "verify, don't trust" (analoga a AFIP autoridad del CAE, CLAUDE.md §8.1):**
 * el body de MP NO trae el `status` del pago — solo `action` + `data.id`. Este parser
 * expone UNICAMENTE el id del recurso a consultar; NUNCA un status confiable. El status
 * autoritativo se obtiene re-consultando la API de MP (Fase B). Esto hace estructural
 * el principio: MercadoPago es la unica autoridad del estado de su propio pago, igual
 * que AFIP lo es del CAE. Un handler NO debe derivar el resultado del pago del webhook.
 *
 * Helper puro: sin DB, sin context, sin side effects. La validacion de FIRMA
 * (x-signature HMAC) vive en `security/hmac.ts` (validateMercadoPagoWebhook) — este
 * modulo asume que la autenticidad ya fue verificada por el handler ANTES de parsear.
 */
import { z } from 'zod';

/** id de MP puede venir como number o string segun el recurso; lo normalizamos a string. */
const mpIdSchema = z.union([z.string(), z.number()]).transform((v) => String(v));

const notificationSchema = z.object({
  id: mpIdSchema.optional(),
  live_mode: z.boolean().optional(),
  type: z.string().optional(),
  action: z.string().optional(),
  date_created: z.string().optional(),
  data: z.object({ id: mpIdSchema }).optional(),
});

/**
 * Resultado del parseo — union discriminada por `kind`:
 * - `payment`  → notificacion de pago valida; el handler debe re-consultar `paymentId`.
 * - `ignored`  → notificacion de otro recurso (merchant_order, etc.); responder 200 y no hacer nada.
 * - `invalid`  → body corrupto / shape inesperado; responder 400.
 *
 * Notar que `payment` NO expone ningun status (verify, don't trust).
 */
export type ParsedMpNotification =
  | {
      kind: 'payment';
      notificationId: string | null;
      paymentId: string;
      action: string | null;
      liveMode: boolean;
    }
  | { kind: 'ignored'; type: string }
  | { kind: 'invalid'; reason: 'body_not_json' | 'schema_mismatch' | 'payment_without_data_id' };

export function parseMpWebhookNotification(rawBody: string): ParsedMpNotification {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { kind: 'invalid', reason: 'body_not_json' };
  }

  const parsed = notificationSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: 'invalid', reason: 'schema_mismatch' };
  }

  const n = parsed.data;
  const type = n.type ?? '';

  // F0 solo procesa pagos. Otros recursos (merchant_order, plan, subscription,
  // point_integration_wh, etc.) se reconocen y se ignoran explicitamente.
  if (type !== 'payment') {
    return { kind: 'ignored', type: type.length > 0 ? type : 'unknown' };
  }

  // type === 'payment' pero sin data.id util → no podemos consultar el pago.
  if (!n.data || n.data.id.length === 0) {
    return { kind: 'invalid', reason: 'payment_without_data_id' };
  }

  return {
    kind: 'payment',
    notificationId: n.id ?? null,
    paymentId: n.data.id,
    action: n.action ?? null,
    liveMode: n.live_mode ?? false,
  };
}
