import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  impactoDeCompra,
  margenSobrePrecio,
  type RenglonCompra,
} from '../../src/lib/domain/impacto-compra';

const d = (v: string) => new Decimal(v);
const renglon = (c: Partial<RenglonCompra>): RenglonCompra => ({
  productId: 'cinta',
  qty: d('10'),
  costo: d('1008'),
  precio: '1600',
  stock: '48',
  costoActual: '920',
  ultimaCompra: '2026-10-01',
  ...c,
});
const uno = (rs: RenglonCompra[], fecha = '2026-11-19') => impactoDeCompra(rs, fecha).get('cinta')!;

describe('margenSobrePrecio', () => {
  it('(precio − costo) / precio, sobre el precio sin IVA', () => {
    expect(margenSobrePrecio('1600', '920')!.toFixed(2)).toBe('42.50');
  });
  it('sin costo o con precio 0 no hay margen', () => {
    expect(margenSobrePrecio('1600', null)).toBeNull();
    expect(margenSobrePrecio('0', '100')).toBeNull();
  });
  it('vender por debajo del costo da margen negativo', () => {
    expect(margenSobrePrecio('100', '120')!.toFixed(0)).toBe('-20');
  });
});

describe('impactoDeCompra', () => {
  it('una compra más nueva fija el costo, suma stock y mueve el margen', () => {
    const i = uno([renglon({})]);
    expect(i.motivo).toBe('cambia');
    expect(i.stockDespues.toString()).toBe('58');
    expect(i.costoDespues!.toString()).toBe('1008');
    expect(i.variacionCosto!.toFixed(2)).toBe('9.57');
    expect(i.margenAntes!.toFixed(2)).toBe('42.50');
    expect(i.margenDespues!.toFixed(2)).toBe('37.00');
  });

  it('una factura ANTERIOR a la última compra no cambia el costo (pero sí suma stock)', () => {
    const i = uno([renglon({})], '2026-09-15');
    expect(i.motivo).toBe('compra_mas_nueva');
    expect(i.costoDespues!.toString()).toBe('920');
    expect(i.variacionCosto).toBeNull();
    expect(i.stockDespues.toString()).toBe('58');
  });

  it('con la MISMA fecha que la última compra, gana esta (se carga después)', () => {
    expect(uno([renglon({})], '2026-10-01').motivo).toBe('cambia');
  });

  it('el mismo producto en dos renglones: costo del de más abajo, stock de los dos', () => {
    const i = uno([
      renglon({ qty: d('10'), costo: d('800') }),
      renglon({ qty: d('5'), costo: d('780') }),
    ]);
    expect(i.costoDespues!.toString()).toBe('780');
    expect(i.stockDespues.toString()).toBe('63');
    expect(i.repetido).toBe(true);
  });

  it('nunca comprado: el costo nuevo es el de esta compra, sin variación', () => {
    const i = uno([renglon({ costoActual: null, ultimaCompra: null })]);
    expect(i.motivo).toBe('cambia');
    expect(i.costoAntes).toBeNull();
    expect(i.variacionCosto).toBeNull();
    expect(i.margenAntes).toBeNull();
    expect(i.margenDespues!.toFixed(2)).toBe('37.00');
  });

  it('sin costo escrito todavía: no se inventa nada', () => {
    const i = uno([renglon({ costo: null })]);
    expect(i.motivo).toBe('sin_costo');
    expect(i.costoDespues!.toString()).toBe('920');
  });

  it('producto sin precio: hay costo pero no margen', () => {
    const i = uno([renglon({ precio: '0' })]);
    expect(i.costoDespues!.toString()).toBe('1008');
    expect(i.margenDespues).toBeNull();
  });

  it('separa productos distintos', () => {
    const m = impactoDeCompra(
      [renglon({}), renglon({ productId: 'tijera', stock: '2', qty: d('20') })],
      '2026-11-19'
    );
    expect(m.size).toBe(2);
    expect(m.get('tijera')!.stockDespues.toString()).toBe('22');
  });
});
