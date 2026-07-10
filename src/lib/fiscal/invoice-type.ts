/**
 * Selección del tipo de comprobante (A/B/C) según la condición del COMERCIO
 * (emisor) y del receptor.
 *
 * Regla fiscal (decisión BASE del guion contadora, 2026-07-10):
 * - Monotributista emisor → SIEMPRE Factura C (no discrimina IVA, nunca A/B).
 * - Responsable Inscripto / IVA liberado (Ley 19.640) emisor →
 *     · Consumidor final  → Factura B
 *     · Receptor con condición fiscal (RI / Monotributo / Exento) → Factura A
 *
 * A-18 (leyenda RG 5003) y A-19 (sub-tipos RG 5762) solo aplican cuando el
 * emisor es RI (emite A). El Monotri nunca los ve.
 */
import type { TaxRegime } from '../db/schema/_common.js';

export type ReceptorCondition =
  | 'consumidor_final'
  | 'responsable_inscripto'
  | 'monotributo'
  | 'exento';

export type InvoiceType = 'A' | 'B' | 'C';

export function selectInvoiceType(
  emisorRegime: TaxRegime,
  receptor: ReceptorCondition
): InvoiceType {
  // Monotributo emisor: SIEMPRE C, sin importar el receptor.
  if (emisorRegime === 'monotributo') {
    return 'C';
  }

  // responsable_inscripto | iva_liberado: A a sujetos con condición fiscal,
  // B a consumidor final.
  if (receptor === 'consumidor_final') {
    return 'B';
  }
  return 'A';
}
