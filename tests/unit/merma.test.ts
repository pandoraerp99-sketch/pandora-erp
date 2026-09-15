/**
 * Merma y valor del stock — capa pura (RESEARCH-BRIEF-panel §8.e).
 *
 * Los estados se prueban ACÁ y no en la pantalla: la base de dev tiene una sola
 * merma real, así que "sin merma", "unidades sin costo" y el desglose de varios
 * motivos no se pueden ver en una captura. Mismo criterio que margen.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  calcularMerma,
  calcularValorStock,
  type CrudoMermaMotivo,
  type CrudoMermaProducto,
} from '@/lib/reporting/merma';

const motivo = (m: Partial<CrudoMermaMotivo> & { motivo: string }): CrudoMermaMotivo => ({
  unidades: '0.0000',
  unidades_sin_costo: '0.0000',
  costo: '0.0000',
  filas: 1,
  ...m,
});

const producto = (p: Partial<CrudoMermaProducto> & { nombre: string }): CrudoMermaProducto => ({
  product_id: p.nombre,
  unidades: '1.0000',
  costo: '100.0000',
  ...p,
});

describe('calcularMerma', () => {
  it('sin filas: estado sin_merma, sin pesos inventados', () => {
    const m = calcularMerma([], []);
    expect(m.estado).toBe('sin_merma');
    expect(m.costo).toBeNull();
    expect(m.porMotivo).toEqual([]);
    expect(m.productos).toEqual([]);
  });

  it('todo con costo: completo, total = suma de motivos', () => {
    const m = calcularMerma(
      [
        motivo({ motivo: 'rotura', unidades: '2.0000', costo: '4800.0000' }),
        motivo({ motivo: 'vencimiento', unidades: '5.0000', costo: '1200.0000', filas: 3 }),
      ],
      [producto({ nombre: 'Yerba', unidades: '2.0000', costo: '4800.0000' })]
    );
    expect(m.estado).toBe('completo');
    expect(m.costo).toBe('6000.0000');
    expect(m.unidades).toBe('7.0000');
    expect(m.unidadesSinCosto).toBe('0.0000');
    expect(m.movimientos).toBe(4);
  });

  it('🔴 unidades sin costo: parcial, y los pesos NO las cuentan como cero', () => {
    const m = calcularMerma(
      [
        motivo({ motivo: 'robo', unidades: '3.0000', unidades_sin_costo: '3.0000', costo: '0.0000' }),
        motivo({ motivo: 'rotura', unidades: '1.0000', costo: '500.0000' }),
      ],
      []
    );
    expect(m.estado).toBe('parcial');
    expect(m.costo).toBe('500.0000');
    expect(m.unidadesSinCosto).toBe('3.0000');
  });

  it('🔴 TODA la merma sin costo: hay merma, pero no hay pesos', () => {
    const m = calcularMerma(
      [motivo({ motivo: 'robo', unidades: '3.0000', unidades_sin_costo: '3.0000' })],
      []
    );
    // No es "sin_merma": se perdieron 3 unidades. Y no es $0: no se sabe cuánto.
    expect(m.estado).toBe('sin_costo');
    expect(m.costo).toBeNull();
    expect(m.unidades).toBe('3.0000');
  });

  it('por motivo: ordenado por pesos, con su parte del total', () => {
    const m = calcularMerma(
      [
        motivo({ motivo: 'rotura', unidades: '1.0000', costo: '250.0000' }),
        motivo({ motivo: 'vencimiento', unidades: '4.0000', costo: '750.0000' }),
      ],
      []
    );
    expect(m.porMotivo.map((x) => x.motivo)).toEqual(['vencimiento', 'rotura']);
    expect(m.porMotivo[0]?.participacionPct?.toNumber()).toBe(75);
    expect(m.porMotivo[1]?.participacionPct?.toNumber()).toBe(25);
  });

  it('participación sin pesos (todo sin costo): null, nunca Infinity ni NaN', () => {
    const m = calcularMerma(
      [motivo({ motivo: 'robo', unidades: '2.0000', unidades_sin_costo: '2.0000' })],
      []
    );
    expect(m.porMotivo[0]?.participacionPct).toBeNull();
  });

  it('productos: los 3 que más pierden, y los sin costo van al final (no arriba por $0)', () => {
    const m = calcularMerma(
      [motivo({ motivo: 'rotura', unidades: '10.0000', costo: '900.0000' })],
      [
        producto({ nombre: 'Chico', costo: '100.0000' }),
        producto({ nombre: 'Sin costo', costo: null }),
        producto({ nombre: 'Grande', costo: '500.0000' }),
        producto({ nombre: 'Medio', costo: '300.0000' }),
      ]
    );
    expect(m.productos.map((p) => p.nombre)).toEqual(['Grande', 'Medio', 'Chico']);
  });

  it('un producto sin costo igual aparece si entra en los 3', () => {
    const m = calcularMerma(
      [motivo({ motivo: 'robo', unidades: '2.0000', unidades_sin_costo: '1.0000', costo: '100.0000' })],
      [
        producto({ nombre: 'Con costo', costo: '100.0000' }),
        producto({ nombre: 'Sin costo', costo: null }),
      ]
    );
    expect(m.productos.map((p) => [p.nombre, p.costo])).toEqual([
      ['Con costo', '100.0000'],
      ['Sin costo', null],
    ]);
  });
});

describe('calcularValorStock', () => {
  it('sin productos con stock: sin_stock', () => {
    const v = calcularValorStock({ valor: '0.0000', productos_con_stock: 0, productos_sin_costo: 0 });
    expect(v.estado).toBe('sin_stock');
    expect(v.valor).toBeNull();
  });

  it('todos con costo: completo', () => {
    const v = calcularValorStock({ valor: '163900.0000', productos_con_stock: 7, productos_sin_costo: 0 });
    expect(v.estado).toBe('completo');
    expect(v.valor).toBe('163900.0000');
  });

  it('🔴 algunos sin costo: parcial, con cuántos faltan', () => {
    const v = calcularValorStock({ valor: '50000.0000', productos_con_stock: 7, productos_sin_costo: 2 });
    expect(v.estado).toBe('parcial');
    expect(v.valor).toBe('50000.0000');
    expect(v.productosSinCosto).toBe(2);
  });

  it('🔴 ninguno con costo: hay stock pero no hay pesos (no $0)', () => {
    const v = calcularValorStock({ valor: '0.0000', productos_con_stock: 3, productos_sin_costo: 3 });
    expect(v.estado).toBe('sin_costo');
    expect(v.valor).toBeNull();
  });
});
