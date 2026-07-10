import { describe, expect, it } from 'vitest';
import {
  buildFecaeSolicitarEnvelope,
  buildFecompUltimoAutorizadoEnvelope,
  type AfipAuth,
} from '@/lib/integrations/afip/wsfev1-request';
import { projectToWSFEv1 } from '@/lib/fiscal/projection/wsfev1';
import { calculateSaleTotals, type SaleItemInput } from '@/lib/domain/calculation';
import { CONDICION_IVA_RECEPTOR, DOC_TIPO } from '@/lib/fiscal/afip-codes';

const auth: AfipAuth = { token: 'TOK+base64', sign: 'SIGN/base64==', cuit: '23414479359' };

const item = (o: Partial<SaleItemInput> = {}): SaleItemInput => ({
  product_id: 'p1',
  product_name_snapshot: 'Producto',
  unit_price: '1000.00',
  quantity: '1',
  tax_rate: '21',
  tdf_exempt: false,
  ...o,
});

function detB() {
  return projectToWSFEv1({
    totals: calculateSaleTotals([item()]),
    invoice_type: 'B',
    sale_point: 2,
    invoice_number: 15,
    cbte_fecha: '20260710',
    receptor: {
      doc_tipo: DOC_TIPO.CONSUMIDOR_FINAL,
      doc_nro: '0',
      condicion_iva_id: CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
    },
  });
}

describe('buildFecaeSolicitarEnvelope', () => {
  it('incluye Auth, FeCabReq y los campos del detalle', () => {
    const xml = buildFecaeSolicitarEnvelope(auth, 2, 6, detB());
    expect(xml).toContain('<ar:Token>TOK+base64</ar:Token>');
    expect(xml).toContain('<ar:Sign>SIGN/base64==</ar:Sign>');
    expect(xml).toContain('<ar:Cuit>23414479359</ar:Cuit>');
    expect(xml).toContain('<ar:PtoVta>2</ar:PtoVta>');
    expect(xml).toContain('<ar:CbteTipo>6</ar:CbteTipo>');
    expect(xml).toContain('<ar:ImpNeto>1000.00</ar:ImpNeto>');
    expect(xml).toContain('<ar:ImpIVA>210.00</ar:ImpIVA>');
    expect(xml).toContain('<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>');
    expect(xml).toContain(
      '<ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>1000.00</ar:BaseImp><ar:Importe>210.00</ar:Importe></ar:AlicIva>'
    );
  });

  it('respeta el ORDEN XSD: ImpTrib antes de ImpIVA, MonId antes de CondicionIVAReceptorId', () => {
    const xml = buildFecaeSolicitarEnvelope(auth, 2, 6, detB());
    expect(xml.indexOf('<ar:ImpTrib>')).toBeLessThan(xml.indexOf('<ar:ImpIVA>'));
    expect(xml.indexOf('<ar:ImpIVA>')).toBeLessThan(xml.indexOf('<ar:MonId>'));
    expect(xml.indexOf('<ar:MonCotiz>')).toBeLessThan(
      xml.indexOf('<ar:CondicionIVAReceptorId>')
    );
    expect(xml.indexOf('<ar:CondicionIVAReceptorId>')).toBeLessThan(xml.indexOf('<ar:Iva>'));
  });

  it('Tipo C: sin <ar:Iva> y sin CondicionIVAReceptorId si no se informa', () => {
    const detC = projectToWSFEv1({
      totals: calculateSaleTotals([item({ tax_rate: '0' })]),
      invoice_type: 'C',
      sale_point: 2,
      invoice_number: 15,
      cbte_fecha: '20260710',
      receptor: { doc_tipo: DOC_TIPO.CONSUMIDOR_FINAL, doc_nro: '0' },
    });
    const xml = buildFecaeSolicitarEnvelope(auth, 2, 11, detC);
    expect(xml).not.toContain('<ar:Iva>');
    expect(xml).not.toContain('<ar:CondicionIVAReceptorId>');
    expect(xml).toContain('<ar:ImpNeto>1000.00</ar:ImpNeto>');
  });
});

describe('buildFecompUltimoAutorizadoEnvelope', () => {
  it('incluye Auth + PtoVta + CbteTipo', () => {
    const xml = buildFecompUltimoAutorizadoEnvelope(auth, 2, 6);
    expect(xml).toContain('FECompUltimoAutorizado');
    expect(xml).toContain('<ar:PtoVta>2</ar:PtoVta>');
    expect(xml).toContain('<ar:CbteTipo>6</ar:CbteTipo>');
    expect(xml).toContain('<ar:Cuit>23414479359</ar:Cuit>');
  });
});
