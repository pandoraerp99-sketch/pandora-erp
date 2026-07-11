/**
 * Factory del cliente WSFEv1 (CaeRequester) por tenant.
 *
 * Devuelve el cliente listo para emitir, o `null` si todavía NO está configurado
 * (falta el certificado de homologación y/o los adaptadores reales). Mientras
 * devuelva `null`, la emisión se saltea y la venta queda en `pending`
 * (fail-closed A-2: el cobro no se bloquea, la factura se emite después).
 *
 * TODO (slice cert): construir el Wsfev1Client real:
 *   - TraSigner CMS (firma el TRA con el cert del tenant — node-forge)
 *   - LoginCmsTransport + Wsfev1Transport (fetch a WSAA/WSFEv1)
 *   - WsaaTokenCache sobre la tabla wsaa_tokens
 *   - AfipAuthProvider = WsaaClient.getCredentials + cuit de la company
 * Leer environment/cuit/cert de la company. Ver src/lib/fiscal/README.md.
 */
import type { CaeRequester } from './emit-invoice.js';

export async function getCaeRequester(
  _tenantId: string
): Promise<CaeRequester | null> {
  // Sin cert/adaptadores wired → emisión diferida (la venta queda en pending
  // y la resuelve el worker/operador cuando el cliente esté disponible).
  return null;
}
