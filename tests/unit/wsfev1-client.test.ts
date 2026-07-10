import { describe, expect, it, vi } from 'vitest';
import {
  Wsfev1Client,
  type AfipAuthProvider,
  type Wsfev1Transport,
} from '@/lib/integrations/afip/wsfev1-client';
import type { Wsfev1DetRequest } from '@/lib/fiscal/projection/wsfev1';

const authProvider: AfipAuthProvider = {
  getAuth: vi.fn(async () => ({ token: 'T', sign: 'S', cuit: '23414479359' })),
};

const det: Wsfev1DetRequest = {
  Concepto: 1,
  DocTipo: 99,
  DocNro: 0,
  CbteDesde: 15,
  CbteHasta: 15,
  CbteFch: '20260710',
  ImpTotal: '1210.00',
  ImpTotConc: '0.00',
  ImpNeto: '1000.00',
  ImpOpEx: '0.00',
  ImpIVA: '210.00',
  ImpTrib: '0.00',
  MonId: 'PES',
  MonCotiz: '1',
  Iva: [{ Id: 5, BaseImp: '1000.00', Importe: '210.00' }],
};

function ultimoResp(nro: number): string {
  return (
    '<FECompUltimoAutorizadoResult>' +
    `<PtoVta>2</PtoVta><CbteTipo>6</CbteTipo><CbteNro>${nro}</CbteNro><Errors/>` +
    '</FECompUltimoAutorizadoResult>'
  );
}
function caeApproved(): string {
  return (
    '<FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp>' +
    '<FeDetResp><FECAEDetResponse><CbteDesde>15</CbteDesde><Resultado>A</Resultado>' +
    '<CAE>75123456789012</CAE><CAEFchVto>20260720</CAEFchVto><Observaciones/>' +
    '</FECAEDetResponse></FeDetResp><Errors/></FECAESolicitarResult>'
  );
}
function caeRejected(): string {
  return (
    '<FECAESolicitarResult><FeCabResp><Resultado>R</Resultado></FeCabResp>' +
    '<FeDetResp><FECAEDetResponse><Resultado>R</Resultado><CAE/>' +
    '<Observaciones><Obs><Code>10016</Code><Msg>mal informado</Msg></Obs></Observaciones>' +
    '</FECAEDetResponse></FeDetResp><Errors/></FECAESolicitarResult>'
  );
}

describe('Wsfev1Client.getLastAuthorized', () => {
  it('devuelve el último número + usa URL homo + SOAPAction correctos', async () => {
    const transport: Wsfev1Transport = { send: vi.fn(async () => ultimoResp(14)) };
    const client = new Wsfev1Client({ authProvider, transport });

    const last = await client.getLastAuthorized('t1', 'homologacion', 2, 6);

    expect(last).toBe(14); // próximo a emitir = 15
    expect(transport.send).toHaveBeenCalledWith(
      'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
      'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
      expect.stringContaining('<ar:CbteTipo>6</ar:CbteTipo>')
    );
  });

  it('fail-closed si la respuesta trae Errors', async () => {
    const errXml =
      '<FECompUltimoAutorizadoResult><Errors><Err><Code>600</Code><Msg>no auth</Msg></Err></Errors></FECompUltimoAutorizadoResult>';
    const transport: Wsfev1Transport = { send: vi.fn(async () => errXml) };
    const client = new Wsfev1Client({ authProvider, transport });
    await expect(client.getLastAuthorized('t1', 'homologacion', 2, 6)).rejects.toThrow();
  });
});

describe('Wsfev1Client.requestCae', () => {
  it('APROBADO → outcome issued + CAE + raw', async () => {
    const transport: Wsfev1Transport = { send: vi.fn(async () => caeApproved()) };
    const client = new Wsfev1Client({ authProvider, transport });

    const r = await client.requestCae('t1', 'homologacion', 2, 6, det);

    expect(r.outcome).toBe('issued');
    expect(r.cae).toBe('75123456789012');
    expect(r.caeVto).toBe('20260720');
    expect(r.raw).toContain('FECAESolicitarResult');
  });

  it('RECHAZADO → outcome rejected, NO lanza (lo maneja el caller)', async () => {
    const transport: Wsfev1Transport = { send: vi.fn(async () => caeRejected()) };
    const client = new Wsfev1Client({ authProvider, transport });

    const r = await client.requestCae('t1', 'homologacion', 2, 6, det);

    expect(r.outcome).toBe('rejected');
    expect(r.cae).toBeNull();
  });

  it('propaga fallas de transporte (timeout/red)', async () => {
    const transport: Wsfev1Transport = {
      send: vi.fn(async () => {
        throw new Error('ETIMEDOUT');
      }),
    };
    const client = new Wsfev1Client({ authProvider, transport });
    await expect(client.requestCae('t1', 'homologacion', 2, 6, det)).rejects.toThrow(
      'ETIMEDOUT'
    );
  });
});
