/**
 * Cliente WSFEv1 — orquestación (auth + transport inyectables).
 *
 * NO decide fiscal_status: devuelve el `outcome` clasificado para que el
 * servicio de ventas (próximo slice) lo mapee al state machine (§12.2) dentro
 * de la transacción con la numeración (SELECT FOR UPDATE, ADR-0006).
 *
 * Fail-closed: solo `outcome === 'issued'` habilita marcar la venta emitida.
 */
import type { AfipEnvironment } from '../../db/schema/_common.js';
import type { Wsfev1DetRequest } from '../../fiscal/projection/wsfev1.js';
import { FiscalIntegrityError } from '../../multi_tenant/errors.js';
import { WSFEV1_URL } from './wsaa-endpoints.js';
import {
  SOAP_ACTION,
  buildFecaeSolicitarEnvelope,
  buildFecompUltimoAutorizadoEnvelope,
  type AfipAuth,
} from './wsfev1-request.js';
import {
  classifyCaeResult,
  parseFecaeSolicitarResponse,
  parseFecompUltimoAutorizadoResponse,
  type CaeOutcome,
  type FecaeSolicitarResult,
} from './wsfev1-response.js';

/** Provee el Auth (token+sign+cuit) para un tenant/environment. */
export interface AfipAuthProvider {
  getAuth(tenantId: string, environment: AfipEnvironment): Promise<AfipAuth>;
}

/** Transporte SOAP a WSFEv1: manda el body con su SOAPAction, devuelve XML. */
export interface Wsfev1Transport {
  send(url: string, soapAction: string, body: string): Promise<string>;
}

export interface RequestCaeResult extends FecaeSolicitarResult {
  outcome: CaeOutcome;
  /** XML crudo de la respuesta — para persistir en fiscal_snapshots. */
  raw: string;
}

export class Wsfev1Client {
  constructor(
    private readonly deps: {
      authProvider: AfipAuthProvider;
      transport: Wsfev1Transport;
    }
  ) {}

  /**
   * Último número de comprobante autorizado por AFIP para (PtoVta, CbteTipo).
   * El próximo a emitir es este + 1. Base de la numeración y del recovery
   * (FECompUltimoAutorizado, RECONCILIATION-ENGINE §4).
   */
  async getLastAuthorized(
    tenantId: string,
    environment: AfipEnvironment,
    ptoVta: number,
    cbteTipo: number
  ): Promise<number> {
    const auth = await this.deps.authProvider.getAuth(tenantId, environment);
    const body = buildFecompUltimoAutorizadoEnvelope(auth, ptoVta, cbteTipo);
    const raw = await this.deps.transport.send(
      WSFEV1_URL[environment],
      SOAP_ACTION.FECompUltimoAutorizado,
      body
    );
    const parsed = parseFecompUltimoAutorizadoResponse(raw);
    if (parsed.errors.length > 0) {
      throw new FiscalIntegrityError('FECompUltimoAutorizado devolvió errores', {
        errors: parsed.errors,
      });
    }
    if (parsed.cbteNro == null) {
      throw new FiscalIntegrityError('FECompUltimoAutorizado sin CbteNro', {});
    }
    return parsed.cbteNro;
  }

  /**
   * Solicita el CAE para un comprobante ya proyectado (projectToWSFEv1).
   * Devuelve el outcome clasificado + el raw para persistir. NO lanza ante
   * rechazo/observación/error de AFIP (eso lo decide el caller); sí propaga
   * fallas de transporte.
   */
  async requestCae(
    tenantId: string,
    environment: AfipEnvironment,
    ptoVta: number,
    cbteTipo: number,
    det: Wsfev1DetRequest
  ): Promise<RequestCaeResult> {
    const auth = await this.deps.authProvider.getAuth(tenantId, environment);
    const body = buildFecaeSolicitarEnvelope(auth, ptoVta, cbteTipo, det);
    const raw = await this.deps.transport.send(
      WSFEV1_URL[environment],
      SOAP_ACTION.FECAESolicitar,
      body
    );
    const parsed = parseFecaeSolicitarResponse(raw);
    return { ...parsed, outcome: classifyCaeResult(parsed), raw };
  }
}
