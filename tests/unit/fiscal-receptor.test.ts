import { describe, expect, it } from 'vitest';
import {
  buildReceptor,
  docTipoFromCustomer,
  receptorConditionFrom,
} from '@/lib/fiscal/receptor';

describe('docTipoFromCustomer', () => {
  it('mapea los tipos de documento a códigos AFIP', () => {
    expect(docTipoFromCustomer('CUIT')).toBe(80);
    expect(docTipoFromCustomer('CUIL')).toBe(86);
    expect(docTipoFromCustomer('DNI')).toBe(96);
    expect(docTipoFromCustomer('none')).toBe(99);
    expect(docTipoFromCustomer(null)).toBe(99);
  });
});

describe('receptorConditionFrom', () => {
  it('interpreta el texto libre de condición fiscal, default consumidor final', () => {
    expect(receptorConditionFrom('Responsable Inscripto')).toBe('responsable_inscripto');
    expect(receptorConditionFrom('RI')).toBe('responsable_inscripto');
    expect(receptorConditionFrom('Monotributista')).toBe('monotributo');
    expect(receptorConditionFrom('IVA Exento')).toBe('exento');
    expect(receptorConditionFrom('Consumidor Final')).toBe('consumidor_final');
    expect(receptorConditionFrom(null)).toBe('consumidor_final');
    expect(receptorConditionFrom('')).toBe('consumidor_final');
  });
});

describe('buildReceptor', () => {
  it('consumidor final sin identificar → 99 / 0 / código 5', () => {
    const r = buildReceptor({ doc_type: 'none', doc_number: null, tax_condition: null });
    expect(r).toEqual({
      doc_tipo: 99,
      doc_nro: '0',
      condicion_iva_id: 5,
      condition: 'consumidor_final',
    });
  });

  it('CUIT de un responsable inscripto → 80 / dígitos / código 1', () => {
    const r = buildReceptor({
      doc_type: 'CUIT',
      doc_number: '30-71868423-0',
      tax_condition: 'Responsable Inscripto',
    });
    expect(r.doc_tipo).toBe(80);
    expect(r.doc_nro).toBe('30718684230');
    expect(r.condicion_iva_id).toBe(1);
    expect(r.condition).toBe('responsable_inscripto');
  });

  it('monotributo receptor → código 6', () => {
    const r = buildReceptor({
      doc_type: 'CUIT',
      doc_number: '20111111112',
      tax_condition: 'Monotributo',
    });
    expect(r.condicion_iva_id).toBe(6);
    expect(r.condition).toBe('monotributo');
  });
});
