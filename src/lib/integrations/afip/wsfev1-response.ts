/**
 * Parseo de respuestas WSFEv1 (FECAESolicitar + FECompUltimoAutorizado).
 *
 * Función PURA. Lo más delicado del sistema: clasificar correctamente el
 * resultado de AFIP determina si una venta queda `issued`, `rejected` (número
 * quemado) o requiere intervención. Fail-closed ante lo desconocido.
 */
import { extractAllTags, extractNumber, extractTag } from './xml.js';

export interface FiscalMessage {
  code: string;
  msg: string;
}

export interface FecaeSolicitarResult {
  /** 'A' Aprobado · 'R' Rechazado · 'P' Parcial · null si no vino. */
  resultado: 'A' | 'R' | 'P' | null;
  cae: string | null;
  /** Vencimiento del CAE (YYYYMMDD). */
  caeVto: string | null;
  cbteDesde: number | null;
  observaciones: FiscalMessage[];
  errors: FiscalMessage[];
}

/**
 * Clasificación operativa del resultado (mapea a fiscal_status del dominio):
 * - 'issued'   → Aprobado con CAE y sin observaciones.
 * - 'observed' → Aprobado pero con observaciones (A-7: revisión manual, no auto-entregar).
 * - 'rejected' → Rechazado por AFIP (número quemado).
 * - 'error'    → Error de request (validación/estructura); NO se emitió, revisar payload.
 */
export type CaeOutcome = 'issued' | 'observed' | 'rejected' | 'error';

function parseMessages(container: string | null, itemTag: string): FiscalMessage[] {
  if (!container) return [];
  return extractAllTags(container, itemTag).map((item) => ({
    code: extractTag(item, 'Code') ?? '',
    msg: extractTag(item, 'Msg') ?? '',
  }));
}

export function parseFecaeSolicitarResponse(soapXml: string): FecaeSolicitarResult {
  // Errors viven a nivel FECAESolicitarResult (fuera de FeDetResp).
  const errors = parseMessages(extractTag(soapXml, 'Errors'), 'Err');

  const cab = extractTag(soapXml, 'FeCabResp');
  const det = extractTag(soapXml, 'FECAEDetResponse');

  // Resultado: preferir el del detalle (por comprobante); fallback al cabecera.
  const resultadoRaw =
    (det ? extractTag(det, 'Resultado') : null) ??
    (cab ? extractTag(cab, 'Resultado') : null);
  const resultado =
    resultadoRaw === 'A' || resultadoRaw === 'R' || resultadoRaw === 'P'
      ? resultadoRaw
      : null;

  const cae = det ? extractTag(det, 'CAE') : null;
  const caeVto = det ? extractTag(det, 'CAEFchVto') : null;
  const cbteDesde = det ? extractNumber(det, 'CbteDesde') : null;
  const observaciones = parseMessages(
    det ? extractTag(det, 'Observaciones') : null,
    'Obs'
  );

  return {
    resultado,
    cae: cae && cae.length > 0 ? cae : null,
    caeVto: caeVto && caeVto.length > 0 ? caeVto : null,
    cbteDesde,
    observaciones,
    errors,
  };
}

/**
 * Clasifica el resultado. Fail-closed: cualquier cosa que no sea un Aprobado
 * limpio con CAE cae en 'observed'/'rejected'/'error' (nunca se asume emitido).
 */
export function classifyCaeResult(r: FecaeSolicitarResult): CaeOutcome {
  if (r.errors.length > 0) return 'error';
  if (r.resultado === 'R') return 'rejected';
  if (r.resultado === 'A' && r.cae) {
    return r.observaciones.length > 0 ? 'observed' : 'issued';
  }
  // Aprobado sin CAE, Parcial, o resultado desconocido → no asumir emisión.
  return 'error';
}

// ── FECompUltimoAutorizado (numeración) ──────────────────────────────────────

export interface UltimoAutorizadoResult {
  ptoVta: number | null;
  cbteTipo: number | null;
  cbteNro: number | null;
  errors: FiscalMessage[];
}

export function parseFecompUltimoAutorizadoResponse(
  soapXml: string
): UltimoAutorizadoResult {
  const errors = parseMessages(extractTag(soapXml, 'Errors'), 'Err');
  const result = extractTag(soapXml, 'FECompUltimoAutorizadoResult') ?? soapXml;
  return {
    ptoVta: extractNumber(result, 'PtoVta'),
    cbteTipo: extractNumber(result, 'CbteTipo'),
    cbteNro: extractNumber(result, 'CbteNro'),
    errors,
  };
}
