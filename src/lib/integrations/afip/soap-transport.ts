/**
 * Transporte SOAP a AFIP (WSAA y WSFEv1) — la implementacion real.
 *
 * ── TLS 1.2+ Y VALIDACION DE CERTIFICADO, NO NEGOCIABLE (CLAUDE.md §11.4) ──
 * Por este canal viajan el certificado X.509 del comercio y el token WSAA.
 * Bajar `rejectUnauthorized` esta PROHIBIDO explicitamente: es el atajo mas
 * comun de la industria cuando el handshake falla, y convierte cualquier
 * intermediario en un lector de la identidad fiscal del comerciante.
 *
 * Se usa `node:https` y no `fetch`: `fetch` no deja fijar `minVersion` sin
 * traerse `undici` como dependencia propia. Un POST de SOAP no necesita mas
 * que esto.
 *
 * ── EL TIMEOUT NO ES DECORATIVO ───────────────────────────────────────────
 * `emitInvoice` sostiene una transaccion de base ABIERTA mientras habla con
 * AFIP (frontera §8.5: el numero fiscal avanza solo si AFIP autoriza). Si AFIP
 * cuelga y este timeout no corta, la transaccion queda abierta hasta que la
 * corte Postgres — y ahi el numero queda en un limbo que hay que resolver a
 * mano. Por eso el timeout es obligatorio y tiene que ser MENOR que el
 * `idle_in_transaction_session_timeout` de la base (ver `assertAfipTimeoutFitsDb`).
 */
import { request as httpsRequest } from 'node:https';
import { logger } from '../../observability/logger.js';

/**
 * 30 segundos: es el timeout que fija ADR-0004 para la espera sincronica de
 * AFIP. Pasado eso la venta va a reconciliacion, no se espera mas.
 */
export const AFIP_TIMEOUT_MS = 30_000;

export class SoapTransportError extends Error {
  constructor(
    public readonly code: 'timeout' | 'network' | 'http_error',
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'SoapTransportError';
  }
}

interface PostSoapOptions {
  url: string;
  body: string;
  /** SOAPAction. WSFEv1 la exige; WSAA la ignora. */
  soapAction?: string;
  timeoutMs?: number;
  /**
   * CA extra en la que confiar, en PEM.
   *
   * Esto AGREGA confianza, no la saca: `rejectUnauthorized` sigue en `true` y
   * el certificado del servidor se valida igual, sólo que contra esta CA
   * además de las del sistema. Es lo contrario de `rejectUnauthorized:false`,
   * que es lo que está prohibido.
   *
   * Lo usa el test T-SEC-06 para su servidor local, y sirve si algún día hace
   * falta confiar en una CA interna.
   */
  ca?: string;
}

/** POST de un envelope SOAP. Devuelve el XML crudo de la respuesta. */
export function postSoap({
  url,
  body,
  soapAction,
  timeoutMs = AFIP_TIMEOUT_MS,
  ca,
}: PostSoapOptions): Promise<string> {
  const destino = new URL(url);

  return new Promise<string>((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: destino.protocol,
        hostname: destino.hostname,
        port: destino.port || 443,
        path: destino.pathname + destino.search,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body, 'utf8'),
          ...(soapAction ? { SOAPAction: `"${soapAction}"` } : {}),
        },
        // ── Los dos que no se tocan ──
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
        timeout: timeoutMs,
      },
      (res) => {
        const trozos: Buffer[] = [];
        res.on('data', (c: Buffer) => trozos.push(c));
        res.on('end', () => {
          const texto = Buffer.concat(trozos).toString('utf8');
          const status = res.statusCode ?? 0;
          // 500 es NORMAL en SOAP: un Fault viaja con ese codigo y el cuerpo
          // tiene el detalle. Lo devuelve para que lo parsee la capa de
          // arriba, que sabe distinguir un Fault de un rechazo de negocio.
          if (status >= 200 && status < 300) return resolve(texto);
          if (status === 500 && texto.includes('Fault')) return resolve(texto);
          reject(
            new SoapTransportError(
              'http_error',
              `AFIP respondió HTTP ${status}`,
              status
            )
          );
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      // Se loguea el timeout SIN el cuerpo: el TRA firmado lleva el cert.
      logger.warn({ host: destino.hostname, timeout_ms: timeoutMs }, 'afip.timeout');
      reject(
        new SoapTransportError(
          'timeout',
          `AFIP no respondió en ${timeoutMs / 1000}s`
        )
      );
    });

    req.on('error', (err) => {
      logger.warn(
        { host: destino.hostname, error: err.message },
        'afip.transport_error'
      );
      reject(new SoapTransportError('network', `No se pudo hablar con AFIP: ${err.message}`));
    });

    req.write(body, 'utf8');
    req.end();
  });
}

/** Adaptador con la forma que espera `WsaaClient` (LoginCms). */
export function createLoginCmsTransport(): {
  send(url: string, cmsBase64: string): Promise<string>;
} {
  return {
    send: async (url, cmsBase64) =>
      postSoap({ url, body: buildLoginCmsBody(cmsBase64) }),
  };
}

/** Envelope de `loginCms`. Vive acá porque es puro transporte. */
function buildLoginCmsBody(cmsBase64: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">' +
    '<soapenv:Header/><soapenv:Body><wsaa:loginCms>' +
    `<wsaa:in0>${cmsBase64}</wsaa:in0>` +
    '</wsaa:loginCms></soapenv:Body></soapenv:Envelope>'
  );
}

/**
 * Adaptador con la forma que espera `Wsfev1Client`.
 *
 * OJO al orden: la interfaz es `(url, soapAction, body)`, no `(url, body,
 * soapAction)`. Invertirlos compila igual — los tres son string — y manda el
 * XML como SOAPAction. AFIP contesta un error de transporte que no se parece
 * en nada a la causa.
 */
export function createWsfev1Transport(): {
  send(url: string, soapAction: string, body: string): Promise<string>;
} {
  return {
    send: async (url, soapAction, body) => postSoap({ url, body, soapAction }),
  };
}
