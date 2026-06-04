import { describe, expect, it } from 'vitest';
import {
  CALCULATION_ENGINE_VERSION,
  calculateLine,
  calculateSaleTotals,
  validateFiscalInvariant,
  type SaleItemInput,
} from '@/lib/domain/calculation';
import { FiscalIntegrityError } from '@/lib/multi_tenant/errors';

const tela = (overrides: Partial<SaleItemInput> = {}): SaleItemInput => ({
  product_id: 'tela-1',
  product_name_snapshot: 'Tela negra',
  unit_price: '500.00',
  quantity: '2',
  tax_rate: '21',
  tdf_exempt: false,
  ...overrides,
});

describe('calculateLine', () => {
  it('calcula linea simple con IVA 21%', () => {
    const r = calculateLine(tela());
    expect(r.line_subtotal).toBe('1000.0000');
    expect(r.line_tax).toBe('210.0000');
    expect(r.line_total).toBe('1210.0000');
  });

  it('linea exenta TDF (Ley 19.640) no genera IVA', () => {
    const r = calculateLine(tela({ tdf_exempt: true }));
    expect(r.line_subtotal).toBe('1000.0000');
    expect(r.line_tax).toBe('0.0000');
    expect(r.line_total).toBe('1000.0000');
  });

  it('rechaza cantidad cero o negativa', () => {
    expect(() => calculateLine(tela({ quantity: '0' }))).toThrow(FiscalIntegrityError);
    expect(() => calculateLine(tela({ quantity: '-1' }))).toThrow(FiscalIntegrityError);
  });

  it('rechaza precio negativo', () => {
    expect(() => calculateLine(tela({ unit_price: '-50' }))).toThrow(FiscalIntegrityError);
  });

  it('rechaza tax_rate fuera de [0,100]', () => {
    expect(() => calculateLine(tela({ tax_rate: '150' }))).toThrow(FiscalIntegrityError);
    expect(() => calculateLine(tela({ tax_rate: '-1' }))).toThrow(FiscalIntegrityError);
  });

  it('cantidad decimal (sederia vende por metro)', () => {
    const r = calculateLine(tela({ quantity: '2.5', unit_price: '400', unit_type: 'metro' }));
    expect(r.line_subtotal).toBe('1000.0000');
    expect(r.line_tax).toBe('210.0000');
  });

  // C-3 — calculation valida quantity entero cuando unit_type='unidad' o 'docena'
  describe('C-3: quantity integer validation by unit_type', () => {
    it('rechaza quantity decimal para unit_type unidad', () => {
      expect(() => calculateLine(tela({ unit_type: 'unidad', quantity: '0.5' }))).toThrow(
        FiscalIntegrityError
      );
      expect(() => calculateLine(tela({ unit_type: 'unidad', quantity: '2.5' }))).toThrow(
        FiscalIntegrityError
      );
    });

    it('rechaza quantity decimal para unit_type docena', () => {
      expect(() => calculateLine(tela({ unit_type: 'docena', quantity: '1.5' }))).toThrow(
        FiscalIntegrityError
      );
    });

    it('acepta quantity entero para unit_type unidad', () => {
      const r = calculateLine(tela({ unit_type: 'unidad', quantity: '3' }));
      expect(r.quantity).toBe('3.0000');
    });

    it('acepta quantity decimal para unit_type metro (sederia)', () => {
      const r = calculateLine(tela({ unit_type: 'metro', quantity: '2.75' }));
      expect(r.quantity).toBe('2.7500');
    });

    it('acepta quantity decimal para kg/gramo/litro', () => {
      expect(() => calculateLine(tela({ unit_type: 'kg', quantity: '0.5' }))).not.toThrow();
      expect(() => calculateLine(tela({ unit_type: 'gramo', quantity: '250' }))).not.toThrow();
      expect(() => calculateLine(tela({ unit_type: 'litro', quantity: '1.5' }))).not.toThrow();
    });

    it('default unit_type es unidad si no se pasa (mas restrictivo)', () => {
      // Si caller olvida pasar unit_type, validacion sigue el caso mas restrictivo.
      expect(() => calculateLine(tela({ quantity: '0.5' }))).toThrow(FiscalIntegrityError);
    });

    it('mensaje de error incluye unit_type para debugging', () => {
      try {
        calculateLine(tela({ unit_type: 'unidad', quantity: '2.5' }));
        expect.fail('debio lanzar');
      } catch (err) {
        expect(err).toBeInstanceOf(FiscalIntegrityError);
        const e = err as FiscalIntegrityError;
        expect(e.messageEs).toContain('unidad');
        expect(e.details).toMatchObject({ unit_type: 'unidad' });
      }
    });
  });
});

describe('calculateSaleTotals', () => {
  it('suma multi-line con misma alicuota', () => {
    const totals = calculateSaleTotals([
      tela({ unit_price: '100', quantity: '1' }),
      tela({ unit_price: '200', quantity: '1' }),
      tela({ unit_price: '300', quantity: '1' }),
    ]);

    expect(totals.subtotal).toBe('600.0000');
    expect(totals.tax_amount).toBe('126.0000');
    expect(totals.total).toBe('726.0000');
    expect(totals.iva_breakdown).toHaveLength(1);
    expect(totals.iva_breakdown[0]?.rate).toBe('21.00');
    expect(totals.iva_breakdown[0]?.base).toBe('600.0000');
    expect(totals.iva_breakdown[0]?.importe).toBe('126.0000');
  });

  it('multi-alicuota arma breakdown por rate', () => {
    const totals = calculateSaleTotals([
      tela({ unit_price: '100', quantity: '1', tax_rate: '21' }),
      tela({ unit_price: '100', quantity: '1', tax_rate: '10.5' }),
    ]);

    expect(totals.iva_breakdown).toHaveLength(2);
    const rates = totals.iva_breakdown.map((e) => e.rate);
    expect(rates).toContain('21.00');
    expect(rates).toContain('10.50');
  });

  it('separa exempt_amount de subtotal gravado', () => {
    const totals = calculateSaleTotals([
      tela({ unit_price: '100', quantity: '1', tdf_exempt: false }),
      tela({ unit_price: '200', quantity: '1', tdf_exempt: true }),
    ]);

    expect(totals.exempt_amount).toBe('200.0000');
    expect(totals.subtotal).toBe('300.0000');
    expect(totals.tax_amount).toBe('21.0000');
    expect(totals.total).toBe('321.0000');
  });

  it('rechaza venta vacia', () => {
    expect(() => calculateSaleTotals([])).toThrow(FiscalIntegrityError);
  });

  it('incluye version del engine + tax policy en output', () => {
    const totals = calculateSaleTotals([tela()]);
    expect(totals.calculation_engine_version).toBe(CALCULATION_ENGINE_VERSION);
    expect(totals.rounding_mode).toBe('HALF_EVEN');
  });
});

describe('validateFiscalInvariant', () => {
  it('valida invariante ImpIVA == sum(Iva[].Importe) en caso normal', () => {
    const totals = calculateSaleTotals([
      tela({ unit_price: '100', quantity: '1' }),
      tela({ unit_price: '200', quantity: '1' }),
    ]);
    expect(() => validateFiscalInvariant(totals)).not.toThrow();
  });

  it('valida invariante subtotal + tax == total', () => {
    const totals = calculateSaleTotals([
      tela({ unit_price: '500', quantity: '2', tdf_exempt: false }),
      tela({ unit_price: '300', quantity: '1', tdf_exempt: true }),
    ]);
    expect(() => validateFiscalInvariant(totals)).not.toThrow();
  });
});
