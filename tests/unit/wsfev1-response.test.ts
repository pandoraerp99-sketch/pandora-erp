import { describe, expect, it } from 'vitest';
import {
  classifyCaeResult,
  parseFecaeSolicitarResponse,
  parseFecompUltimoAutorizadoResponse,
} from '@/lib/integrations/afip/wsfev1-response';

function fecaeResponse(opts: {
  resultado: string;
  cae?: string;
  caeVto?: string;
  obs?: Array<{ code: string; msg: string }>;
  errors?: Array<{ code: string; msg: string }>;
}): string {
  const obsXml = opts.obs
    ? `<Observaciones>${opts.obs
        .map((o) => `<Obs><Code>${o.code}</Code><Msg>${o.msg}</Msg></Obs>`)
        .join('')}</Observaciones>`
    : '<Observaciones/>';
  const errXml = opts.errors
    ? `<Errors>${opts.errors
        .map((e) => `<Err><Code>${e.code}</Code><Msg>${e.msg}</Msg></Err>`)
        .join('')}</Errors>`
    : '<Errors/>';
  return (
    '<soap:Envelope><soap:Body>' +
    '<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>' +
    '<FeCabResp><Cuit>23414479359</Cuit><PtoVta>2</PtoVta><CbteTipo>6</CbteTipo>' +
    `<CantReg>1</CantReg><Resultado>${opts.resultado}</Resultado><Reproceso>N</Reproceso></FeCabResp>` +
    '<FeDetResp><FECAEDetResponse>' +
    '<Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro>' +
    '<CbteDesde>15</CbteDesde><CbteHasta>15</CbteHasta><CbteFch>20260710</CbteFch>' +
    `<Resultado>${opts.resultado}</Resultado>` +
    (opts.cae ? `<CAE>${opts.cae}</CAE>` : '<CAE/>') +
    (opts.caeVto ? `<CAEFchVto>${opts.caeVto}</CAEFchVto>` : '<CAEFchVto/>') +
    obsXml +
    '</FECAEDetResponse></FeDetResp>' +
    errXml +
    '</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>'
  );
}

describe('parseFecaeSolicitarResponse + classifyCaeResult', () => {
  it('APROBADO con CAE, sin observaciones → issued', () => {
    const r = parseFecaeSolicitarResponse(
      fecaeResponse({ resultado: 'A', cae: '75123456789012', caeVto: '20260720' })
    );
    expect(r.resultado).toBe('A');
    expect(r.cae).toBe('75123456789012');
    expect(r.caeVto).toBe('20260720');
    expect(r.cbteDesde).toBe(15);
    expect(r.observaciones).toEqual([]);
    expect(classifyCaeResult(r)).toBe('issued');
  });

  it('RECHAZADO → rejected (número quemado)', () => {
    const r = parseFecaeSolicitarResponse(
      fecaeResponse({
        resultado: 'R',
        obs: [{ code: '10016', msg: 'Comprobante mal informado' }],
      })
    );
    expect(r.resultado).toBe('R');
    expect(r.cae).toBeNull();
    expect(classifyCaeResult(r)).toBe('rejected');
  });

  it('APROBADO con observaciones → observed (A-7, revisión manual)', () => {
    const r = parseFecaeSolicitarResponse(
      fecaeResponse({
        resultado: 'A',
        cae: '75123456789012',
        caeVto: '20260720',
        obs: [{ code: '10063', msg: 'Dato observado' }],
      })
    );
    expect(r.cae).toBe('75123456789012');
    expect(r.observaciones).toEqual([{ code: '10063', msg: 'Dato observado' }]);
    expect(classifyCaeResult(r)).toBe('observed');
  });

  it('ERROR de request (Errors a nivel result) → error', () => {
    const r = parseFecaeSolicitarResponse(
      fecaeResponse({
        resultado: 'R',
        errors: [{ code: '600', msg: 'CUIT no autorizado al WS' }],
      })
    );
    expect(r.errors).toEqual([{ code: '600', msg: 'CUIT no autorizado al WS' }]);
    expect(classifyCaeResult(r)).toBe('error');
  });

  it('APROBADO sin CAE → error (fail-closed: no se asume emisión)', () => {
    const r = parseFecaeSolicitarResponse(fecaeResponse({ resultado: 'A' }));
    expect(r.cae).toBeNull();
    expect(classifyCaeResult(r)).toBe('error');
  });
});

describe('parseFecompUltimoAutorizadoResponse', () => {
  it('extrae el último número autorizado', () => {
    const xml =
      '<soap:Envelope><soap:Body>' +
      '<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">' +
      '<FECompUltimoAutorizadoResult><PtoVta>2</PtoVta><CbteTipo>6</CbteTipo>' +
      '<CbteNro>14</CbteNro><Errors/></FECompUltimoAutorizadoResult>' +
      '</FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>';
    const r = parseFecompUltimoAutorizadoResponse(xml);
    expect(r.ptoVta).toBe(2);
    expect(r.cbteTipo).toBe(6);
    expect(r.cbteNro).toBe(14); // próximo a emitir = 15
    expect(r.errors).toEqual([]);
  });
});
