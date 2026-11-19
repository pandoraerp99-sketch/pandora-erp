/**
 * Reglas puras de pedidos (ADR-0029): total por línea con HALF_EVEN, qué
 * transiciones de estado existen, qué tipo de cobro es cada uno y los estados
 * derivados (señado, saldado, vencido) que la pantalla muestra.
 */
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  estadoDerivado,
  puedePasar,
  tipoDeCobro,
  totalDeLinea,
  totalDelPedido,
} from '@/lib/domain/pedidos';

const d = (x: string) => new Decimal(x);

describe('totalDeLinea — HALF_EVEN a centavos, una vez por línea', () => {
  it('3,2 m × $1.234,57 = 3950,624 → 3950,62', () => {
    expect(totalDeLinea({ quantity: '3.2', unit_price: '1234.57' }).toFixed(2)).toBe('3950.62');
  });
  it('el medio centavo va al PAR: 0,125 → 0,12 y 0,135 → 0,14', () => {
    expect(totalDeLinea({ quantity: '0.5', unit_price: '0.25' }).toFixed(2)).toBe('0.12');
    expect(totalDeLinea({ quantity: '0.5', unit_price: '0.27' }).toFixed(2)).toBe('0.14');
  });
  it('el total es la suma de las líneas YA redondeadas', () => {
    // Sin redondear por línea daría 0,25 + 0,25 = 0,50; redondeando cada una
    // a par da 0,12 + 0,12 = 0,24. El total tiene que cerrar con lo que se ve.
    const lineas = [
      { quantity: '0.5', unit_price: '0.25' },
      { quantity: '0.5', unit_price: '0.25' },
    ];
    expect(totalDelPedido(lineas).toFixed(2)).toBe('0.24');
  });
});

describe('puedePasar — transiciones', () => {
  it('hacia adelante y cancelar mientras vive', () => {
    expect(puedePasar('tomado', 'en_preparacion')).toBe(true);
    expect(puedePasar('en_preparacion', 'listo')).toBe(true);
    expect(puedePasar('listo', 'entregado')).toBe(true);
    expect(puedePasar('listo', 'cancelado')).toBe(true);
    expect(puedePasar('listo', 'en_preparacion')).toBe(true);
  });
  it('entregado y cancelado son terminales', () => {
    for (const hacia of ['tomado', 'en_preparacion', 'listo', 'entregado', 'cancelado'] as const) {
      expect(puedePasar('entregado', hacia)).toBe(false);
      expect(puedePasar('cancelado', hacia)).toBe(false);
    }
  });
  it('no se vuelve a "tomado"', () => {
    expect(puedePasar('listo', 'tomado')).toBe(false);
    expect(puedePasar('en_preparacion', 'tomado')).toBe(false);
  });
});

describe('tipoDeCobro — se deriva, no se elige', () => {
  it('el primero es seña; si paga todo de una, es saldo', () => {
    expect(tipoDeCobro(d('0'), d('100'), d('1000'))).toBe('sena');
    expect(tipoDeCobro(d('0'), d('1000'), d('1000'))).toBe('saldo');
  });
  it('después: a cuenta, o saldo si lo deja en cero', () => {
    expect(tipoDeCobro(d('100'), d('200'), d('1000'))).toBe('parcial');
    expect(tipoDeCobro(d('100'), d('900'), d('1000'))).toBe('saldo');
  });
});

describe('estadoDerivado', () => {
  const base = { total: '1000', cobrado: '0', pickup_date: '2026-11-20', hoy: '2026-11-18' } as const;
  it('señado y saldo', () => {
    const e = estadoDerivado({ ...base, status: 'tomado', cobrado: '300' });
    expect(e.conSena).toBe(true);
    expect(e.saldado).toBe(false);
    expect(e.saldo.toFixed(2)).toBe('700.00');
  });
  it('vencido sólo si sigue vivo', () => {
    expect(estadoDerivado({ ...base, status: 'listo', hoy: '2026-11-21' }).vencido).toBe(true);
    expect(estadoDerivado({ ...base, status: 'entregado', hoy: '2026-11-21' }).vencido).toBe(false);
    expect(estadoDerivado({ ...base, status: 'listo', hoy: '2026-11-20' }).vencido).toBe(false);
    expect(estadoDerivado({ ...base, status: 'listo', hoy: '2026-11-20' }).retiraHoy).toBe(true);
  });
  it('sin fecha de retiro nunca vence', () => {
    expect(estadoDerivado({ ...base, status: 'tomado', pickup_date: null, hoy: '2030-01-01' }).vencido).toBe(false);
  });
  it('saldado cuando lo cobrado cubre el total', () => {
    expect(estadoDerivado({ ...base, status: 'listo', cobrado: '1000' }).saldado).toBe(true);
  });
});
