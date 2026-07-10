/**
 * Endpoints WSAA + WSFEv1 por environment (ADR-0019 S13 hard isolation).
 * Homologación y producción NUNCA se mezclan.
 */
import type { AfipEnvironment } from '../../db/schema/_common.js';

export const WSAA_URL: Readonly<Record<AfipEnvironment, string>> = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};

export const WSFEV1_URL: Readonly<Record<AfipEnvironment, string>> = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};

/** Servicio de negocio para el TRA. F0 = wsfe (WSFEv1). */
export const AFIP_SERVICE_WSFE = 'wsfe';
