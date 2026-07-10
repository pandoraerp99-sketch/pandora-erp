import { describe, expect, it } from 'vitest';
import { selectInvoiceType } from '@/lib/fiscal/invoice-type';

describe('selectInvoiceType', () => {
  it('Monotributo emisor SIEMPRE emite C (nunca A/B)', () => {
    expect(selectInvoiceType('monotributo', 'consumidor_final')).toBe('C');
    expect(selectInvoiceType('monotributo', 'responsable_inscripto')).toBe('C');
    expect(selectInvoiceType('monotributo', 'monotributo')).toBe('C');
    expect(selectInvoiceType('monotributo', 'exento')).toBe('C');
  });

  it('RI emisor a consumidor final → B', () => {
    expect(selectInvoiceType('responsable_inscripto', 'consumidor_final')).toBe('B');
  });

  it('RI emisor a sujeto con condición fiscal → A', () => {
    expect(selectInvoiceType('responsable_inscripto', 'responsable_inscripto')).toBe('A');
    expect(selectInvoiceType('responsable_inscripto', 'monotributo')).toBe('A');
    expect(selectInvoiceType('responsable_inscripto', 'exento')).toBe('A');
  });

  it('IVA liberado (Ley 19.640) se comporta como RI para tipo de comprobante', () => {
    expect(selectInvoiceType('iva_liberado', 'consumidor_final')).toBe('B');
    expect(selectInvoiceType('iva_liberado', 'responsable_inscripto')).toBe('A');
  });
});
