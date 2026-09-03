/**
 * Códigos oficiales AFIP/ARCA para WSFEv1 FECAESolicitar.
 *
 * Fuente PRIMARIA: Manual COMPG v4.5 (02/07/2026, URL canónica), extraído y
 * verificado 2026-07-10. Ver tax-policy-versions/ar-2026-07-v1.md.
 *
 * NO inventar códigos: si aparece una alícuota/condición sin código acá, es
 * fail-closed (FiscalIntegrityError) — antes que enviar un payload inválido.
 *
 * ── Por qué esto está HARDCODEADO y no se consulta en runtime (2026-09-03) ──
 *
 * ADR-0025 especifica traer los catálogos de ARCA en runtime (FEParam* + cache
 * + validación al boot). Ese ADR sigue vigente, pero su **implementación quedó
 * diferida a F1+**: este archivo es una decisión deliberada, NO un incumplimiento.
 *
 * Evidencia que lo justifica: la RG 5762/2025 eliminó la clase de comprobante
 * "M" ENTERA (01/12/2025) — cambio normativo mayor — y aun así el código interno
 * siguió siendo `0051`. ARCA cambia nombres, leyendas y condiciones, pero
 * preserva los códigos numéricos por retrocompatibilidad con los clientes de
 * webservice. El riesgo que motivó ADR-0025 es menor al asumido en 2026-06.
 *
 * Entonces este archivo es una **fotografía versionada** de los catálogos: la
 * reproducibilidad histórica la da el par (este archivo, `tax_policy_version`
 * persistido en el snapshot fiscal), que es el objetivo de fondo del ADR.
 *
 * DISPARADOR para construir `catalogs/` runtime: ARCA agrega un código que
 * necesitemos, o modifica uno existente. Se detecta al re-extraer el Manual
 * COMPG en cada bump de `tax_policy_version` — que es el momento en que este
 * archivo debe revisarse SIEMPRE.
 */
import { FiscalIntegrityError } from '../multi_tenant/errors.js';

/**
 * Tipos de comprobante (CbteTipo). Manual v4.5 tabla de tipos de comprobante.
 * F0 retail: A (a negocios), B (a consumidor final), C (Monotributo).
 * 51 = "A con leyenda operación sujeta a retención" (RG 5762/2025) — solo si
 * ARCA habilitó al comercio en esa modalidad.
 */
export const CBTE_TIPO = {
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
  FACTURA_A_ALEY: 51,
} as const;

export const CBTE_TIPO_BY_INVOICE_TYPE: Record<'A' | 'B' | 'C', number> = {
  A: CBTE_TIPO.FACTURA_A,
  B: CBTE_TIPO.FACTURA_B,
  C: CBTE_TIPO.FACTURA_C,
};

/**
 * Concepto. F0 = retail de bienes → 1 (Productos).
 * Manual v4.5: 1 Productos, 2 Servicios, 3 Productos y Servicios.
 */
export const CONCEPTO = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
} as const;

/**
 * Tipo de documento del receptor (DocTipo).
 * CONSUMIDOR_FINAL (99) = venta sin identificar (CF cash típico TDF) con DocNro 0.
 */
export const DOC_TIPO = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  CONSUMIDOR_FINAL: 99,
} as const;

/**
 * Condición IVA del receptor (CondicionIVAReceptorId). Catálogo Manual v4.5
 * (FEParamGetCondicionIvaReceptor, pág. 195). OPCIONAL al 2026-07-10 (v4.5:
 * "podrá enviarse de forma opcional… hasta tanto entre en vigencia RG 5616").
 */
export const CONDICION_IVA_RECEPTOR = {
  RESPONSABLE_INSCRIPTO: 1,
  SUJETO_EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  RESPONSABLE_MONOTRIBUTO: 6,
  IVA_LIBERADO_LEY_19640: 10,
} as const;

/** Moneda. F0 = ARS-only → 'PES' con cotización 1. */
export const MONEDA = { PESOS: 'PES' } as const;
export const MON_COTIZ_PESOS = '1';

/**
 * Alícuotas IVA (FEParamGetTiposIva). rate% → Id AFIP.
 * Confirmado en Manual v4.5 (ejemplos): Id 5 = 21%, Id 4 = 10.5%.
 * Resto (0/2.5/5/27) = códigos canónicos WSFEv1.
 */
export const IVA_ID_BY_RATE: Readonly<Record<string, number>> = {
  '0': 3,
  '2.5': 9,
  '5': 8,
  '10.5': 4,
  '21': 5,
  '27': 6,
};

/**
 * Mapea una alícuota (string, ej '21.00' | '10.50') a su Id AFIP.
 * Normaliza formato ('21.00' → '21', '10.50' → '10.5'). Fail-closed si no existe.
 */
export function ivaIdForRate(rate: string): number {
  const normalized = String(Number(rate));
  const id = IVA_ID_BY_RATE[normalized];
  if (id === undefined) {
    throw new FiscalIntegrityError(
      `Alícuota IVA sin código AFIP conocido: ${rate}% (revisar IVA_ID_BY_RATE / Manual)`,
      { rate }
    );
  }
  return id;
}
