/**
 * WSAA — cliente de orquestación: obtiene credenciales (token + sign) con
 * cache get-or-refresh, aislado por (tenant, environment) (ADR-0019 S13).
 *
 * Dependencias INYECTADAS (signer, transport, cache, clock) → testeable con
 * fakes sin cert ni red. Las implementaciones reales (firma CMS con el cert,
 * fetch a LoginCms, cache en tabla wsaa_tokens) se enchufan aparte.
 *
 * CLAUDE.md §17.2: cache 12h + refresh proactivo; token/sign son SECRET
 * (nunca loguear).
 */
import type { AfipEnvironment } from '../../db/schema/_common.js';
import { AFIP_SERVICE_WSFE, WSAA_URL } from './wsaa-endpoints.js';
import { buildTra, parseLoginCmsResponse, type WsaaCredentials } from './wsaa-tra.js';

/** Firma el TRA (CMS/PKCS#7) con el cert del tenant → base64. */
export interface TraSigner {
  sign(traXml: string): Promise<string>;
}

/** Transporte SOAP a LoginCms: manda el CMS, devuelve el XML de respuesta. */
export interface LoginCmsTransport {
  send(url: string, cmsBase64: string): Promise<string>;
}

/** Cache de tokens WSAA (mapea a la tabla wsaa_tokens). */
export interface WsaaTokenCache {
  get(tenantId: string, environment: AfipEnvironment): Promise<WsaaCredentials | null>;
  save(
    tenantId: string,
    environment: AfipEnvironment,
    creds: WsaaCredentials
  ): Promise<void>;
}

export interface WsaaClientDeps {
  signer: TraSigner;
  transport: LoginCmsTransport;
  cache: WsaaTokenCache;
  now?: () => Date;
  service?: string;
  /** Refrescar si faltan menos de N segundos para expirar. Default 600. */
  refreshMarginSeconds?: number;
}

/** El par que se manda en cada llamada al WS de negocio (WSFEv1, Padrón). */
export interface WsaaAuth {
  token: string;
  sign: string;
}

/** true si las credenciales expiran dentro del margen (o ya expiraron). */
export function isCredentialsExpiring(
  creds: WsaaCredentials,
  now: Date,
  marginSeconds: number
): boolean {
  return creds.expiresAt.getTime() - now.getTime() <= marginSeconds * 1000;
}

/**
 * Envelope SOAP para el método loginCms de WSAA (puro).
 */
export function buildLoginCmsEnvelope(cmsBase64: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">' +
    '<soapenv:Header/>' +
    '<soapenv:Body><wsaa:loginCms>' +
    `<wsaa:in0>${cmsBase64}</wsaa:in0>` +
    '</wsaa:loginCms></soapenv:Body></soapenv:Envelope>'
  );
}

export class WsaaClient {
  private readonly signer: TraSigner;
  private readonly transport: LoginCmsTransport;
  private readonly cache: WsaaTokenCache;
  private readonly now: () => Date;
  private readonly service: string;
  private readonly refreshMarginSeconds: number;

  constructor(deps: WsaaClientDeps) {
    this.signer = deps.signer;
    this.transport = deps.transport;
    this.cache = deps.cache;
    this.now = deps.now ?? (() => new Date());
    this.service = deps.service ?? AFIP_SERVICE_WSFE;
    this.refreshMarginSeconds = deps.refreshMarginSeconds ?? 600;
  }

  /**
   * Devuelve credenciales válidas: del cache si no están por expirar, si no
   * ejecuta el flujo WSAA completo (TRA → firma → LoginCms → parse → cache).
   */
  async getCredentials(
    tenantId: string,
    environment: AfipEnvironment
  ): Promise<WsaaAuth> {
    const cached = await this.cache.get(tenantId, environment);
    if (cached && !isCredentialsExpiring(cached, this.now(), this.refreshMarginSeconds)) {
      return { token: cached.token, sign: cached.sign };
    }
    return this.refresh(tenantId, environment);
  }

  private async refresh(
    tenantId: string,
    environment: AfipEnvironment
  ): Promise<WsaaAuth> {
    const tra = buildTra(this.service, this.now());
    const cms = await this.signer.sign(tra);
    const soap = await this.transport.send(WSAA_URL[environment], cms);
    const creds = parseLoginCmsResponse(soap);
    await this.cache.save(tenantId, environment, creds);
    return { token: creds.token, sign: creds.sign };
  }
}
