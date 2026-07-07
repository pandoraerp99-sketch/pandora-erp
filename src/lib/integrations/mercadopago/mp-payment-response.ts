/**
 * Parser de la respuesta de la API de pagos de MercadoPago (GET /v1/payments/{id}).
 * Sprint 5 ROADMAP Sales+MP — Integrations context.
 *
 * Este es el lado "VERIFY" de "verify, don't trust": el webhook solo dice "consultá
 * el pago X"; ESTA respuesta (de la API autoritativa de MP) trae el status real. El
 * handler de conciliacion (Fase B) usa esto — NUNCA el body del webhook — para decidir.
 *
 * Contrato oficial: https://www.mercadopago.cl/developers/en/reference/payments/_payments_id/get
 * Campos F0 que nos importan:
 *   id, status, status_detail, transaction_amount, external_reference,
 *   payment_method_id, date_approved.
 *
 * `external_reference` es la CLAVE de conciliacion: Pandora lo setea = sale_payment_id
 * al crear el pago, y aca lo recupera para matchear el pago MP con la venta local.
 *
 * Money: `transaction_amount` viene como number JSON. Se convierte a Decimal en el
 * boundary via `money()` y se persiste como string storage (CLAUDE.md §9 — nunca
 * aritmetica sobre el number). La comparacion con el total de la venta (con tolerancia
 * ±$0.50) es responsabilidad del service de conciliacion (Fase B, `withinTolerance`).
 */
import { z } from 'zod';
import { type MpPaymentStatus } from '../../db/schema/_common.js';
import { money, moneyToStorage } from '../../money/decimal.js';
import { mapMpApiPaymentStatus } from './payment-status.js';

const mpIdSchema = z.union([z.string(), z.number()]).transform((v) => String(v));

const paymentResponseSchema = z.object({
  id: mpIdSchema,
  status: z.string(),
  status_detail: z.string().nullish(),
  transaction_amount: z.number(),
  external_reference: z.string().nullish(),
  payment_method_id: z.string().nullish(),
  date_approved: z.string().nullish(),
});

export interface MpPaymentInfo {
  paymentId: string;
  /** Status canonico F0 (via mapMpApiPaymentStatus). */
  status: MpPaymentStatus;
  /** true → el status crudo no era canonico; el caller DEBE auditar. */
  statusReclassified: boolean;
  /** Status crudo de MP, normalizado (para audit + status_detail lookup). */
  rawStatus: string;
  /** Codigo status_detail crudo (ej: 'cc_rejected_insufficient_amount'). */
  statusDetail: string | null;
  /** Monto en formato storage (numeric string), convertido desde el number de MP. */
  amount: string;
  /** Referencia externa seteada por Pandora al crear el pago (= sale_payment_id). Clave de conciliacion. */
  externalReference: string | null;
  paymentMethodId: string | null;
  dateApproved: string | null;
}

export type ParseMpPaymentResult =
  | { ok: true; payment: MpPaymentInfo }
  | { ok: false; reason: 'not_json' | 'schema_mismatch' };

export function parseMpPaymentResponse(rawBody: string): ParseMpPaymentResult {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'not_json' };
  }

  const parsed = paymentResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: 'schema_mismatch' };
  }

  const p = parsed.data;
  const mapped = mapMpApiPaymentStatus(p.status);

  return {
    ok: true,
    payment: {
      paymentId: p.id,
      status: mapped.status,
      statusReclassified: mapped.reclassified,
      rawStatus: mapped.raw,
      statusDetail: p.status_detail ?? null,
      amount: moneyToStorage(money(p.transaction_amount)),
      externalReference: p.external_reference ?? null,
      paymentMethodId: p.payment_method_id ?? null,
      dateApproved: p.date_approved ?? null,
    },
  };
}
