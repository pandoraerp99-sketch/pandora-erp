/**
 * Deriva el receptor AFIP (DocTipo, DocNro, CondicionIVAReceptorId) + la
 * condición para elegir el tipo de comprobante, desde el snapshot de cliente
 * de la venta. Puro.
 *
 * `customer_tax_condition_snapshot` es texto libre (sin CHECK en el schema) →
 * mapeo defensivo con default consumidor_final (el >80% del retail TDF).
 */
import { CONDICION_IVA_RECEPTOR, DOC_TIPO } from './afip-codes.js';
import type { ReceptorCondition } from './invoice-type.js';

export interface AfipReceptor {
  doc_tipo: number;
  doc_nro: string;
  /** Opcional (Manual v4.5). Lo mandamos cuando conocemos la condición. */
  condicion_iva_id: number | null;
  condition: ReceptorCondition;
}

export function docTipoFromCustomer(docType: string | null | undefined): number {
  switch (docType) {
    case 'CUIT':
      return DOC_TIPO.CUIT;
    case 'CUIL':
      return DOC_TIPO.CUIL;
    case 'DNI':
      return DOC_TIPO.DNI;
    default:
      return DOC_TIPO.CONSUMIDOR_FINAL; // 'none' | null | undefined
  }
}

export function receptorConditionFrom(
  taxCondition: string | null | undefined
): ReceptorCondition {
  const c = (taxCondition ?? '').toLowerCase();
  if (c.includes('inscripto') || c === 'ri') return 'responsable_inscripto';
  if (c.includes('monotrib')) return 'monotributo';
  if (c.includes('exento')) return 'exento';
  return 'consumidor_final';
}

export function condicionIvaIdFrom(condition: ReceptorCondition): number {
  switch (condition) {
    case 'responsable_inscripto':
      return CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO;
    case 'monotributo':
      return CONDICION_IVA_RECEPTOR.RESPONSABLE_MONOTRIBUTO;
    case 'exento':
      return CONDICION_IVA_RECEPTOR.SUJETO_EXENTO;
    case 'consumidor_final':
      return CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL;
  }
}

export function buildReceptor(customer: {
  doc_type: string | null | undefined;
  doc_number: string | null | undefined;
  tax_condition: string | null | undefined;
}): AfipReceptor {
  const condition = receptorConditionFrom(customer.tax_condition);
  const doc_tipo = docTipoFromCustomer(customer.doc_type);
  // Consumidor final sin identificar → DocNro 0. Si hay número, solo dígitos.
  const digits = (customer.doc_number ?? '').replace(/\D/g, '');
  const doc_nro = doc_tipo === DOC_TIPO.CONSUMIDOR_FINAL || digits === '' ? '0' : digits;
  return { doc_tipo, doc_nro, condicion_iva_id: condicionIvaIdFrom(condition), condition };
}
