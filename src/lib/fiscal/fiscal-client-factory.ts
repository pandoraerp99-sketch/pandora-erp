/**
 * Factory del cliente WSFEv1 (CaeRequester) por tenant.
 *
 * Arma la cadena real: certificado del tenant → firma CMS del TRA → WSAA (con
 * cache en base) → WSFEv1 sobre TLS 1.2+.
 *
 * Devuelve `null` cuando el tenant **todavía no cargó su certificado**. Eso NO
 * es un error: es el estado normal antes del onboarding, y aguas abajo se
 * traduce en emisión diferida — el cobro no se bloquea y la venta queda
 * `pending` (fail-closed A-2). Es lo que hace que el POS ande hoy sin AFIP.
 *
 * ⚠️ TLS (CLAUDE.md §11.4, no negociable): los transportes fijan
 * `minVersion: 'TLSv1.2'` + `rejectUnauthorized: true`. Por ese canal viajan
 * el certificado X.509 y el token WSAA del tenant. Ver `soap-transport.ts` y
 * el test T-SEC-06.
 */
import { WsaaClient } from '../integrations/afip/wsaa-client.js';
import { Wsfev1Client } from '../integrations/afip/wsfev1-client.js';
import {
  createLoginCmsTransport,
  createWsfev1Transport,
} from '../integrations/afip/soap-transport.js';
import { createTraSigner } from '../integrations/afip/tra-signer.js';
import { createWsaaTokenCache } from '../integrations/afip/wsaa-token-cache.js';
import type { AfipEnvironment } from '../db/schema/_common.js';
import { env } from '../env.js';
import { logger } from '../observability/logger.js';
import { getAfipCredentials } from './afip-credentials.js';
import type { CaeRequester } from './emit-invoice.js';

/**
 * Cliente listo para emitir, o `null` si el tenant no tiene certificado.
 *
 * El environment sale del entorno del SERVIDOR, no de un parámetro: así no
 * existe la posibilidad de que una llamada pida "produccion" desde un deploy
 * de homologación (ADR-0019 S13, aislamiento duro).
 */
export async function getCaeRequester(
  tenantId: string
): Promise<CaeRequester | null> {
  const environment = env.AFIP_ENVIRONMENT as AfipEnvironment;

  const cred = await getAfipCredentials(tenantId, environment);
  if (cred === null) {
    logger.info(
      { tenant_id: tenantId, environment },
      'afip.no_credentials_emission_deferred'
    );
    return null;
  }

  const wsaa = new WsaaClient({
    signer: createTraSigner({
      certPem: cred.certPem,
      privateKeyPem: cred.privateKeyPem,
    }),
    transport: createLoginCmsTransport(),
    cache: createWsaaTokenCache(),
  });

  const wsfev1 = new Wsfev1Client({
    authProvider: {
      async getAuth(tid, envr) {
        const creds = await wsaa.getCredentials(tid, envr);
        // El CUIT sale del CERTIFICADO, no de `companies.cuit`. AFIP valida
        // que el Cuit del request sea el del cert que firmó: si alguien
        // corrige un tipeo en la ficha de la empresa, la emisión tiene que
        // seguir andando con el CUIT real, o fallar por la razón correcta.
        return { token: creds.token, sign: creds.sign, cuit: cred.cuit };
      },
    },
    transport: createWsfev1Transport(),
  });

  return {
    requestCae: (tid, envr, ptoVta, cbteTipo, det) =>
      wsfev1.requestCae(tid, envr, ptoVta, cbteTipo, det),
  };
}
