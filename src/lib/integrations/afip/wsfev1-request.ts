/**
 * Serializers de requests WSFEv1 (FECAESolicitar + FECompUltimoAutorizado).
 *
 * Función PURA. El ORDEN de los campos de FECAEDetRequest respeta la secuencia
 * del XSD (verificado contra Manual COMPG v4.5): ...ImpOpEx, ImpTrib, ImpIVA,
 * MonId, MonCotiz, CondicionIVAReceptorId, Iva. Orden incorrecto = rechazo de
 * esquema por AFIP.
 *
 * Los valores (token/sign base64, montos, códigos) no contienen `<>&`, por eso
 * no se escapan. Si en el futuro se agregan textos libres, escapar.
 */
import type { Wsfev1DetRequest } from '../../fiscal/projection/wsfev1.js';

export interface AfipAuth {
  token: string;
  sign: string;
  cuit: string;
}

const NS = 'http://ar.gov.afip.dif.FEV1/';

export const SOAP_ACTION = {
  FECAESolicitar: `${NS}FECAESolicitar`,
  FECompUltimoAutorizado: `${NS}FECompUltimoAutorizado`,
} as const;

function el(tag: string, value: string | number): string {
  return `<ar:${tag}>${value}</ar:${tag}>`;
}

function authXml(auth: AfipAuth): string {
  return `<ar:Auth>${el('Token', auth.token)}${el('Sign', auth.sign)}${el('Cuit', auth.cuit)}</ar:Auth>`;
}

function envelope(bodyInner: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">` +
    `<soapenv:Header/><soapenv:Body>${bodyInner}</soapenv:Body></soapenv:Envelope>`
  );
}

/** FECAEDetRequest en ORDEN XSD (crítico). */
function detToXml(det: Wsfev1DetRequest): string {
  const parts = [
    el('Concepto', det.Concepto),
    el('DocTipo', det.DocTipo),
    el('DocNro', det.DocNro),
    el('CbteDesde', det.CbteDesde),
    el('CbteHasta', det.CbteHasta),
    el('CbteFch', det.CbteFch),
    el('ImpTotal', det.ImpTotal),
    el('ImpTotConc', det.ImpTotConc),
    el('ImpNeto', det.ImpNeto),
    el('ImpOpEx', det.ImpOpEx),
    el('ImpTrib', det.ImpTrib),
    el('ImpIVA', det.ImpIVA),
    el('MonId', det.MonId),
    el('MonCotiz', det.MonCotiz),
  ];
  if (det.CondicionIVAReceptorId != null) {
    parts.push(el('CondicionIVAReceptorId', det.CondicionIVAReceptorId));
  }
  if (det.Iva && det.Iva.length > 0) {
    const alics = det.Iva.map(
      (a) => `<ar:AlicIva>${el('Id', a.Id)}${el('BaseImp', a.BaseImp)}${el('Importe', a.Importe)}</ar:AlicIva>`
    ).join('');
    parts.push(`<ar:Iva>${alics}</ar:Iva>`);
  }
  return parts.join('');
}

export function buildFecaeSolicitarEnvelope(
  auth: AfipAuth,
  ptoVta: number,
  cbteTipo: number,
  det: Wsfev1DetRequest
): string {
  const feCabReq = `<ar:FeCabReq>${el('CantReg', 1)}${el('PtoVta', ptoVta)}${el('CbteTipo', cbteTipo)}</ar:FeCabReq>`;
  const feDetReq = `<ar:FeDetReq><ar:FECAEDetRequest>${detToXml(det)}</ar:FECAEDetRequest></ar:FeDetReq>`;
  return envelope(
    `<ar:FECAESolicitar>${authXml(auth)}<ar:FeCAEReq>${feCabReq}${feDetReq}</ar:FeCAEReq></ar:FECAESolicitar>`
  );
}

export function buildFecompUltimoAutorizadoEnvelope(
  auth: AfipAuth,
  ptoVta: number,
  cbteTipo: number
): string {
  return envelope(
    `<ar:FECompUltimoAutorizado>${authXml(auth)}${el('PtoVta', ptoVta)}${el('CbteTipo', cbteTipo)}</ar:FECompUltimoAutorizado>`
  );
}
