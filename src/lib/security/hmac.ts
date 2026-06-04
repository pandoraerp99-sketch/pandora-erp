/**
 * HMAC validation para webhooks entrantes.
 * ADR-0019 S3 + CLAUDE.md §11.3 + §17.7.
 *
 * Helpers puros (sin DB, sin context). Composables:
 *   1. computeHmacSha256 — primitiva crypto
 *   2. validateHmacSignature — wrapper timing-safe usando safeSignatureCompare
 *   3. parseMercadoPagoSignatureHeader — parser especifico provider
 *   4. validateMercadoPagoWebhook — composicion: parsea + valida HMAC + valida freshness
 *
 * NO maneja secret storage (eso es vault — Sprint 1 #6). El secret se pasa
 * como argumento a cada helper. El service que llame es responsable de
 * resolverlo via vault.
 *
 * Vectores test usados: RFC 4231 §4 (test cases HMAC-SHA-256 oficiales)
 * https://datatracker.ietf.org/doc/html/rfc4231
 */
import { createHmac } from 'node:crypto';
import {
  safeSignatureCompare,
  validateWebhookFreshness,
} from './webhook-dedup.js';

/**
 * Computa HMAC-SHA-256 hex de un payload con un secret.
 * Output: 64 chars hex lowercase.
 */
export function computeHmacSha256(secret: string, payload: string): string {
  if (secret.length === 0) {
    throw new Error('computeHmacSha256: secret vacio — bug de programacion');
  }
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Valida una signature recibida contra el HMAC computado del payload.
 * Usa safeSignatureCompare para evitar timing attacks en la comparacion.
 *
 * CONTRATO ESTRICTO: la signature debe venir en lowercase hex (convencion
 * de todos los providers HMAC reales). Si el caller recibe uppercase del
 * provider, debe normalizar ANTES de llamar. La permisividad en parseo
 * es la fuente de la mayoria de bugs de seguridad, asi que aqui no
 * normalizamos silenciosamente.
 */
export function validateHmacSignature(
  secret: string,
  payload: string,
  providedSignature: string
): boolean {
  if (providedSignature.length === 0) return false;
  const expected = computeHmacSha256(secret, payload);
  return safeSignatureCompare(expected, providedSignature);
}

/**
 * Parser del header MercadoPago `x-signature`.
 *
 * Formato: `ts=1704067200,v1=abc123def456...`
 *   - `ts` = timestamp UNIX seconds (string numerico)
 *   - `v1` = HMAC-SHA-256 hex del payload firmado segun docs MP
 *
 * Retorna null si el header tiene shape invalido.
 * No valida HMAC ni timestamp aqui — eso es validateMercadoPagoWebhook.
 */
export interface MercadoPagoSignature {
  timestamp: number;
  hash: string;
}

export function parseMercadoPagoSignatureHeader(
  header: string
): MercadoPagoSignature | null {
  if (header.length === 0) return null;

  const parts = header.split(',').map((p) => p.trim());
  let ts: number | null = null;
  let v1: string | null = null;

  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.substring(0, eqIdx).trim();
    const value = part.substring(eqIdx + 1).trim();
    if (key === 'ts') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      ts = parsed;
    } else if (key === 'v1') {
      // v1 debe ser hex SHA-256 (64 chars lowercase). Defensa contra malformed.
      if (!/^[0-9a-f]{64}$/.test(value)) return null;
      v1 = value;
    }
  }

  if (ts === null || v1 === null) return null;
  return { timestamp: ts, hash: v1 };
}

/**
 * MercadoPago firma el payload `id:<id>;request-id:<requestId>;ts:<ts>;`
 * donde id viene del query string `data.id` y requestId del header
 * `x-request-id`. Reconstruimos el manifest y lo comparamos.
 *
 * Doc: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 */
export interface MercadoPagoManifestInput {
  dataId: string;
  requestId: string;
  timestamp: number;
}

export function buildMercadoPagoManifest(input: MercadoPagoManifestInput): string {
  return `id:${input.dataId};request-id:${input.requestId};ts:${input.timestamp};`;
}

/**
 * Composicion full: parsea header + valida freshness + valida HMAC.
 * Retorna ok=true solo si los 3 pasos pasan.
 *
 * **⚠️ INVARIANTE SEGURIDAD CRITICA — REPLAY PROTECTION:**
 * Esta funcion valida AUTENTICIDAD (HMAC) + FRESHNESS (±5min) — NO previene
 * REPLAY de un webhook capturado dentro de la ventana de freshness. La defensa
 * anti-replay vive en `tryRegisterWebhookEvent` (UNIQUE provider+event_id en
 * processed_webhook_events). El handler de webhook DEBE llamar AMBOS:
 *
 *   1. const v = validateMercadoPagoWebhook(...)
 *      if (!v.ok) return 401
 *   2. const reg = await tryRegisterWebhookEvent(...)
 *      if (!reg.isNew) return 200 (idempotente, ya procesado)
 *
 * Saltarse el paso 2 "porque el HMAC ya validó" = bug de seguridad classic.
 * NO eliminar esta nota.
 *
 * `nowMs` parametro opcional para tests determinísticos.
 */
export interface ValidateMercadoPagoInput {
  secret: string;
  signatureHeader: string;
  dataId: string;
  requestId: string;
  nowMs?: number;
}

export type ValidateMercadoPagoResult =
  | { ok: true; timestamp: number; hash: string }
  | { ok: false; reason: 'malformed_header' }
  | { ok: false; reason: 'missing_required_field' }
  | { ok: false; reason: 'timestamp_out_of_window'; timestamp: number }
  | { ok: false; reason: 'hmac_mismatch'; timestamp: number };

export function validateMercadoPagoWebhook(
  input: ValidateMercadoPagoInput
): ValidateMercadoPagoResult {
  // Defense-in-depth: dataId / requestId vacios producirian un manifest valido
  // pero sin sentido (`id:;request-id:;ts:N;`). MP nunca debe mandar empty,
  // pero rechazamos explicito para que forged-with-empties no pase.
  if (input.dataId.length === 0 || input.requestId.length === 0) {
    return { ok: false, reason: 'missing_required_field' };
  }

  const parsed = parseMercadoPagoSignatureHeader(input.signatureHeader);
  if (parsed === null) {
    return { ok: false, reason: 'malformed_header' };
  }

  if (!validateWebhookFreshness(parsed.timestamp, input.nowMs)) {
    return {
      ok: false,
      reason: 'timestamp_out_of_window',
      timestamp: parsed.timestamp,
    };
  }

  const manifest = buildMercadoPagoManifest({
    dataId: input.dataId,
    requestId: input.requestId,
    timestamp: parsed.timestamp,
  });

  if (!validateHmacSignature(input.secret, manifest, parsed.hash)) {
    return {
      ok: false,
      reason: 'hmac_mismatch',
      timestamp: parsed.timestamp,
    };
  }

  return { ok: true, timestamp: parsed.timestamp, hash: parsed.hash };
}
