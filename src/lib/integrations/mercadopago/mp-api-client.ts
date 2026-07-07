/**
 * Cliente HTTP minimo de la API de pagos de MercadoPago.
 * Sprint 5 ROADMAP Sales+MP — Integrations context (Fase B: re-fetch autoritativo).
 *
 * Unica responsabilidad F0: `getMpPayment(id)` = GET /v1/payments/{id} → parsear.
 * Este es el "VERIFY" de "verify, don't trust": tras recibir un webhook, el handler
 * re-consulta el pago a la API autoritativa de MP (nunca confia en el body del webhook).
 *
 * Contrato: https://www.mercadopago.cl/developers/en/reference/payments/_payments_id/get
 *   GET https://api.mercadopago.com/v1/payments/{id}
 *   Header: Authorization: Bearer {access_token}   (token del tenant — per-tenant)
 *
 * `fetchFn` inyectable → tests deterministicos sin keys reales ni red.
 * NO maneja el access_token storage (eso es vault, resuelto per-tenant por el caller).
 */
import { parseMpPaymentResponse, type MpPaymentInfo } from './mp-payment-response.js';

const DEFAULT_BASE_URL = 'https://api.mercadopago.com';

/** Respuesta HTTP minima que usa el cliente — permite mock trivial en tests. */
export interface MpHttpResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
}

export type MpFetch = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<MpHttpResponse>;

export interface GetMpPaymentDeps {
  /** Access token del TENANT (per-tenant, resuelto via vault por el caller). */
  accessToken: string;
  /** Override para tests / homologacion. Default: API productiva de MP. */
  baseUrl?: string;
  /** Inyectable para tests. Default: fetch global. */
  fetchFn?: MpFetch;
}

export type GetMpPaymentResult =
  | { ok: true; payment: MpPaymentInfo }
  | {
      ok: false;
      reason: 'unauthorized' | 'not_found' | 'http_error' | 'network_error' | 'parse_error';
      status?: number;
    };

export async function getMpPayment(
  paymentId: string,
  deps: GetMpPaymentDeps
): Promise<GetMpPaymentResult> {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as unknown as MpFetch);
  const url = `${baseUrl}/v1/payments/${encodeURIComponent(paymentId)}`;

  let res: MpHttpResponse;
  try {
    res = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${deps.accessToken}`,
        Accept: 'application/json',
      },
    });
  } catch {
    // timeout / DNS / connection reset → transient, el worker reintenta.
    return { ok: false, reason: 'network_error' };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: 'unauthorized', status: res.status };
  }
  if (res.status === 404) {
    return { ok: false, reason: 'not_found', status: 404 };
  }
  if (!res.ok) {
    return { ok: false, reason: 'http_error', status: res.status };
  }

  const body = await res.text();
  const parsed = parseMpPaymentResponse(body);
  if (!parsed.ok) {
    return { ok: false, reason: 'parse_error' };
  }
  return { ok: true, payment: parsed.payment };
}
