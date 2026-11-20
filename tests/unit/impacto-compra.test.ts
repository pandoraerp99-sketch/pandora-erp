import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  fletePorUnidad,
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

describe('fletePorUnidad (misma fórmula que el servidor)', () => {
  const r = (qty: string, costo: string) => ({ qty: d(qty), costo: d(costo) });

  it('reparte por valor: 10 × $1.000 y 5 × $2.000 con $2.000 de flete', () => {
    const [a, b] = fletePorUnidad([r('10', '1000'), r('5', '2000')], d('2000'));
    expect(a!.toString()).toBe('100');
    expect(b!.toString()).toBe('200');
  });

  it('las partes suman EXACTO el flete, aunque no den redondo', () => {
    const rs = [r('3', '1000'), r('7', '333.33'), r('1', '0.01')];
    const partes = fletePorUnidad(rs, d('1000'));
    const total = rs.reduce((acc, x, i) => acc.plus(x.qty.times(partes[i]!)), d('0'));
    expect(total.toDecimalPlaces(10).toString()).toBe('1000');
  });

  it('un renglón incompleto no recibe parte ni entra en la suma', () => {
    const [a, b] = fletePorUnidad([r('10', '1000'), { qty: null, costo: d('5') }], d('500'));
    expect(a!.toString()).toBe('50');
    expect(b).toBeNull();
  });

  it('sin flete, o sin artículos con valor, no hay parte', () => {
    expect(fletePorUnidad([r('10', '1000')], null)).toEqual([null]);
    expect(fletePorUnidad([r('10', '0')], d('500'))).toEqual([null]);
  });

  it('el impacto suma el flete al costo nuevo y lo informa', () => {
    const i = uno([renglon({ costo: d('1000'), flete: d('100') })]);
    expect(i.costoDespues!.toString()).toBe('1100');
    expect(i.fleteUnitario!.toString()).toBe('100');
  });

  it('una factura más vieja no cambia el costo, aunque traiga flete', () => {
    const i = uno([renglon({ costo: d('1000'), flete: d('100') })], '2026-09-01');
    expect(i.motivo).toBe('compra_mas_nueva');
    expect(i.costoDespues!.toString()).toBe('920');
  });
});
