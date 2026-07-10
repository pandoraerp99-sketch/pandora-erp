/**
 * WSAA — TRA (Ticket de Requerimiento de Acceso) + parseo del TA.
 *
 * Funciones PURAS (sin red, sin crypto, sin DB). La firma CMS del TRA y la
 * llamada SOAP viven aparte (wsaa-signer / wsaa-client) porque necesitan el
 * certificado y la red.
 *
 * Flujo WSAA:
 *   buildTra() → [firmar CMS] → LoginCms(cms) → parseLoginCmsResponse() → {token, sign, expiresAt}
 */
import { FiscalIntegrityError } from '../../multi_tenant/errors.js';

export interface WsaaCredentials {
  token: string;
  sign: string;
  generatedAt: Date;
  expiresAt: Date;
}

/**
 * Formatea una fecha en ISO8601 con offset de Argentina (-03:00), sin
 * milisegundos. AFIP es estricto con el formato del TRA. AR = UTC-3 (sin DST).
 */
export function formatArIso(date: Date): string {
  const ar = new Date(date.getTime() - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${ar.getUTCFullYear()}-${p(ar.getUTCMonth() + 1)}-${p(ar.getUTCDate())}` +
    `T${p(ar.getUTCHours())}:${p(ar.getUTCMinutes())}:${p(ar.getUTCSeconds())}-03:00`
  );
}

export interface BuildTraOptions {
  /** Ventana hacia atrás para generationTime (margen de clock skew). Default 600s. */
  skewSeconds?: number;
  /** Ventana hacia adelante para expirationTime. Default 600s. */
  ttlSeconds?: number;
}

/**
 * Genera el XML del TRA para un servicio (ej 'wsfe'), dado un `now` explícito
 * (inyectable → determinístico y testeable).
 */
export function buildTra(service: string, now: Date, opts: BuildTraOptions = {}): string {
  if (!service || !/^[a-z0-9_]+$/i.test(service)) {
    throw new FiscalIntegrityError('service WSAA inválido', { service });
  }
  const skewSeconds = opts.skewSeconds ?? 600;
  const ttlSeconds = opts.ttlSeconds ?? 600;

  const generationTime = new Date(now.getTime() - skewSeconds * 1000);
  const expirationTime = new Date(now.getTime() + ttlSeconds * 1000);
  const uniqueId = Math.floor(now.getTime() / 1000);

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<loginTicketRequest version="1.0">\n' +
    '  <header>\n' +
    `    <uniqueId>${uniqueId}</uniqueId>\n` +
    `    <generationTime>${formatArIso(generationTime)}</generationTime>\n` +
    `    <expirationTime>${formatArIso(expirationTime)}</expirationTime>\n` +
    '  </header>\n' +
    `  <service>${service}</service>\n` +
    '</loginTicketRequest>'
  );
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTag(xml: string, tag: string): string | null {
  // Permite el tag con o sin atributos: <tag> o <tag version="1.0">.
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? m[1]!.trim() : null;
}

/**
 * Parsea la respuesta SOAP de LoginCms. El body SOAP contiene el
 * `loginTicketResponse` (habitualmente escapado dentro de `<loginCmsReturn>`).
 * Devuelve las credenciales (token + sign + expiración authoritative de AFIP).
 *
 * Fail-closed: si falta cualquier campo crítico → FiscalIntegrityError.
 */
export function parseLoginCmsResponse(soapXml: string): WsaaCredentials {
  // 1. Extraer el loginTicketResponse (directo o dentro de loginCmsReturn escapado).
  let ta = extractTag(soapXml, 'loginTicketResponse');
  if (!ta) {
    const ret = extractTag(soapXml, 'loginCmsReturn');
    if (ret) {
      ta = extractTag(unescapeXml(ret), 'loginTicketResponse');
    }
  }
  if (!ta) {
    // Puede venir todo escapado sin loginCmsReturn detectable → probar unescape global.
    ta = extractTag(unescapeXml(soapXml), 'loginTicketResponse');
  }
  if (!ta) {
    throw new FiscalIntegrityError('Respuesta WSAA sin loginTicketResponse', {});
  }

  const token = extractTag(ta, 'token');
  const sign = extractTag(ta, 'sign');
  const generationTime = extractTag(ta, 'generationTime');
  const expirationTime = extractTag(ta, 'expirationTime');

  if (!token || !sign || !expirationTime || !generationTime) {
    throw new FiscalIntegrityError('TA WSAA incompleto (token/sign/expiración)', {
      hasToken: !!token,
      hasSign: !!sign,
      hasExpiration: !!expirationTime,
    });
  }

  const expiresAt = new Date(expirationTime);
  const generatedAt = new Date(generationTime);
  if (Number.isNaN(expiresAt.getTime()) || Number.isNaN(generatedAt.getTime())) {
    throw new FiscalIntegrityError('TA WSAA con fechas inválidas', {
      generationTime,
      expirationTime,
    });
  }

  return { token, sign, generatedAt, expiresAt };
}
