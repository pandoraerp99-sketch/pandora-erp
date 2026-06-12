import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  money,
  moneyAdd,
  moneyMultiply,
  moneyRound,
  moneyToStorage,
  moneyEq,
  moneySum,
  withinTolerance,
} from '@/lib/money/decimal';
import { formatARS, formatNumber, formatPercent } from '@/lib/money/format';
import { MoneyError } from '@/lib/multi_tenant/errors';

describe('money() factory', () => {
  it('acepta string', () => {
    const m = money('1234.5678');
    expect(m).toBeInstanceOf(Decimal);
    expect(m.toString()).toBe('1234.5678');
  });

  it('acepta number', () => {
    const m = money(42);
    expect(m.eq(new Decimal(42))).toBe(true);
  });

  it('rechaza NaN', () => {
    expect(() => money(NaN)).toThrow(MoneyError);
  });

  it('rechaza Infinity', () => {
    expect(() => money(Infinity)).toThrow(MoneyError);
    expect(() => money(-Infinity)).toThrow(MoneyError);
  });

  it('rechaza string invalido', () => {
    expect(() => money('abc')).toThrow(MoneyError);
  });

  it('rechaza overflow', () => {
    expect(() => money('999999999999999999999')).toThrow(MoneyError);
  });
});

describe('arithmetic helpers', () => {
  it('moneyAdd suma exacta sin float errors', () => {
    const result = moneyAdd('0.1', '0.2');
    expect(result.toString()).toBe('0.3');
  });

  it('moneyMultiply con IVA 21% exacto', () => {
    const subtotal = '1000.00';
    const taxRate = '0.21';
    const tax = moneyMultiply(subtotal, taxRate);
    expect(tax.toString()).toBe('210');
  });

  it('moneySum array', () => {
    const items = ['10.50', '20.75', '5.00'];
    const total = moneySum(items);
    expect(total.toString()).toBe('36.25');
  });
});

describe('moneyRound HALF_EVEN', () => {
  it('redondea 0.5 a par mas cercano (2.5 -> 2)', () => {
    expect(moneyRound('2.5', 0).toString()).toBe('2');
  });

  it('redondea 0.5 a par mas cercano (3.5 -> 4)', () => {
    expect(moneyRound('3.5', 0).toString()).toBe('4');
  });

  it('redondea a 2 decimales', () => {
    expect(moneyRound('210.005', 2).toString()).toBe('210');
    expect(moneyRound('210.015', 2).toString()).toBe('210.02');
  });
});

describe('storage serialization', () => {
  it('moneyToStorage devuelve 4 decimales', () => {
    expect(moneyToStorage('100')).toBe('100.0000');
    expect(moneyToStorage('100.5')).toBe('100.5000');
  });

  // T-MONEY-07: round-trip Decimal → string → Decimal sin pérdida.
  // CLAUDE.md §9.9 (Sprint 5 cierre estructural 2026-06-11 — explicit mapping
  // to satisfy ROADMAP §1033 gating item).
  it('round-trip Decimal → string → Decimal sin pérdida de precisión (T-MONEY-07)', () => {
    // Casos canónicos que ejercitan la frontera entre Decimal y string:
    //   - enteros simples
    //   - decimales con 1-4 dígitos
    //   - cantidades de IVA típicas (21%, 10.5%)
    //   - valores límite cercanos a overflow
    const cases = [
      '0',
      '100',
      '100.5',
      '0.0001',
      '0.4321',
      '1234.5678',
      '999999999999999.9999', // límite numeric(19,4)
      '21.00',
      '10.50',
    ];
    for (const original of cases) {
      const stored = moneyToStorage(original);
      const restored = moneyToStorage(stored); // segundo paso para asegurar idempotencia
      expect(restored).toBe(stored);
      // moneyEq confirma que no hubo pérdida semántica (0.30 === 0.3)
      expect(moneyEq(original, stored)).toBe(true);
      expect(moneyEq(stored, restored)).toBe(true);
    }
  });
});

describe('moneyEq', () => {
  it('compara correctamente sin precision loss', () => {
    expect(moneyEq('0.30', '0.30')).toBe(true);
    expect(moneyEq('0.1', '0.10')).toBe(true);
    expect(moneyEq('0.3', '0.30000')).toBe(true);
  });
});

describe('withinTolerance', () => {
  it('detecta diferencia dentro de tolerancia default $0.50', () => {
    expect(withinTolerance('100.00', '100.25')).toBe(true);
    expect(withinTolerance('100.00', '100.50')).toBe(true);
    expect(withinTolerance('100.00', '100.51')).toBe(false);
  });
});

describe('formatARS', () => {
  it('formatea con simbolo $ y locale es-AR', () => {
    const result = formatARS(1234.56);
    expect(result).toMatch(/\$/);
    expect(result).toContain('1.234');
    expect(result).toContain('56');
  });

  it('handles null/undefined con dash', () => {
    expect(formatARS(null)).toBe('—');
    expect(formatARS(undefined)).toBe('—');
  });

  it('sin decimales cuando se pide', () => {
    const result = formatARS(1234.56, { decimals: false });
    expect(result).not.toContain('56');
  });
});

describe('formatNumber', () => {
  it('formatea entero con separador es-AR', () => {
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('handles null', () => {
    expect(formatNumber(null)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('formatea porcentaje con decimal', () => {
    const result = formatPercent(12.4, 1);
    expect(result).toContain('12,4');
    expect(result).toContain('%');
  });
});
