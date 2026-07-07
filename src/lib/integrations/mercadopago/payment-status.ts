/**
 * Mapeo del `status` crudo de la API de pagos de MercadoPago (GET /v1/payments/{id})
 * al enum canonico F0 `MpPaymentStatus` de `_common.ts`.
 * Sprint 5 ROADMAP Sales+MP — Integrations context.
 *
 * Statuses oficiales de la API de MP:
 *   pending · approved · authorized · in_process · in_mediation ·
 *   rejected · cancelled · refunded · charged_back
 * https://www.mercadopago.com.ar/developers/en/docs/checkout-api/response-handling/collection-results
 *
 * Canonico F0 (_common.ts MP_PAYMENT_STATUSES):
 *   pending · approved · rejected · cancelled · refunded
 *
 * **INVARIANTE "reclassify with audit" (fail-safe):**
 * los statuses no-canonicos conocidos (authorized, in_process, in_mediation,
 * charged_back) y CUALQUIER status desconocido se mapean a `pending` TEMPORAL con
 * `reclassified: true`. El caller (service de conciliacion, Fase B) DEBE emitir un
 * evento de audit cuando `reclassified === true` y dejar que la conciliacion lo
 * resuelva. NUNCA se descarta un status en silencio ni se asume terminal — un
 * `charged_back` mal interpretado como `approved` seria plata mal contada.
 * (Coherente con CLAUDE.md §8.12 fail-closed + §10 auditabilidad.)
 */
import { type MpPaymentStatus } from '../../db/schema/_common.js';

/** Statuses de la API de MP que mapean 1:1 al enum canonico F0. */
const CANONICAL_STATUS: Record<string, MpPaymentStatus> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
  refunded: 'refunded',
};

/**
 * Statuses de la API de MP validos pero NO canonicos F0. Se reconocen (para no
 * confundirlos con un typo/ataque) pero se mapean a `pending` + reclassified.
 */
const KNOWN_NON_CANONICAL: ReadonlySet<string> = new Set([
  'authorized', // pago autorizado, fondos aun no capturados
  'in_process', // en revision (anti-fraude / cuotas)
  'in_mediation', // disputa abierta
  'charged_back', // contracargo — requiere resolucion humana
]);

export interface MappedMpStatus {
  /** Status canonico F0 para persistir en `mp_payments.status`. */
  status: MpPaymentStatus;
  /**
   * true → el status crudo no era canonico F0 (no-canonico conocido o desconocido).
   * El caller DEBE auditar y dejar la conciliacion posterior reclasificar.
   */
  reclassified: boolean;
  /** El status crudo normalizado (lowercase/trim) — para el payload de audit. */
  raw: string;
}

/**
 * Mapea un status crudo de la API de MP al enum canonico F0.
 * Case-insensitive + trim (defensa ante variaciones del provider).
 */
export function mapMpApiPaymentStatus(rawStatus: string): MappedMpStatus {
  const raw = rawStatus.trim().toLowerCase();

  const canonical = CANONICAL_STATUS[raw];
  if (canonical !== undefined) {
    return { status: canonical, reclassified: false, raw };
  }

  // No-canonico conocido o totalmente desconocido → pending temporal + reclassify.
  return { status: 'pending', reclassified: true, raw };
}

/** true si el status crudo es uno que MP documenta (canonico o no-canonico conocido). */
export function isKnownMpApiStatus(rawStatus: string): boolean {
  const raw = rawStatus.trim().toLowerCase();
  return raw in CANONICAL_STATUS || KNOWN_NON_CANONICAL.has(raw);
}
