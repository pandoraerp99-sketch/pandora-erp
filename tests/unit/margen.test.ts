/**
 * Margen bruto histórico — capa pura.
 *
 * Lo que estos tests cuidan, en orden de peligro:
 *   1. Que una línea sin costo NO se convierta en margen (ni 0, ni 100%, ni
 *      descartada en silencio).
 *   2. Que el porcentaje se calcule sobre lo facturado CON COSTO y no sobre el
 *      total del período — si se mezclan, los dos números quedan uno al lado
 *      del otro sin reconciliar y nadie tiene cómo notarlo.
 *   3. Que ninguna división por cero llegue a pantalla como `Infinity`.
 *   4. Que un margen negativo se muestre negativo. Vender bajo costo es
 *      exactamente lo que hay que ver.
 */
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  calcularMargen,
  rentabilidadDe,
  colorDelMargen,
  decirPct,
  decirMargen,
  MARGEN_SANO,
  type CrudoMargen,
} from '@/lib/reporting/margen';

const crudo = (p: Partial<CrudoMargen> = {}): CrudoMargen => ({
  facturado_total: '1000.0000',
  facturado_con_costo: '1000.0000',
  costo: '600.0000',
  lineas_total: 10,
  lineas_con_costo: 10,
  ...p,
});

describe('calcularMargen — el estado antes que el número', () => {
  it('sin una sola línea con costo NO devuelve número', () => {
    const m = calcularMargen(
      crudo({ facturado_con_costo: '0', costo: '0', lineas_con_costo: 0 })
    );
    expect(m.estado).toBe('sin_datos');
    expect(m.margen).toBeNull();
    expect(m.margenPct).toBeNull();
  });

  it('sin datos NO devuelve margen 0 — que sería "vendió al costo"', () => {
    const m = calcularMargen(
      crudo({ facturado_con_costo: '0', costo: '0', lineas_con_costo: 0 })
    );
    expect(m.margen).not.toBe('0.0000');
    expect(m.margen).not.toBe('0');
  });

  it('sin datos igual dice cuánto se facturó: el hueco se ve', () => {
    const m = calcularMargen(
      crudo({ facturado_con_costo: '0', costo: '0', lineas_con_costo: 0 })
    );
    expect(m.facturadoTotal).toBe('1000.0000');
    expect(m.lineasSinCosto).toBe(10);
  });

  it('todas con costo → completo', () => {
    const m = calcularMargen(crudo());
    expect(m.estado).toBe('completo');
    expect(m.lineasSinCosto).toBe(0);
    expect(m.margen).toBe('400.0000');
  });

  it('algunas sin costo → parcial, y dice qué porción cubre', () => {
    const m = calcularMargen(
      crudo({
        facturado_total: '1000.0000',
        facturado_con_costo: '600.0000',
        costo: '400.0000',
        lineas_total: 10,
        lineas_con_costo: 6,
      })
    );
    expect(m.estado).toBe('parcial');
    expect(m.lineasSinCosto).toBe(4);
    expect(m.coberturaPct?.toFixed(1)).toBe('60.0');
  });
});

describe('calcularMargen — el denominador', () => {
  it('el % sale sobre lo facturado CON COSTO, no sobre el total', () => {
    // 600 facturado con costo, 400 de costo → margen 200 → 33,3% sobre 600.
    // Si se calculara sobre los 1000 del total daría 20%, que es otro número
    // y no se correspondería con los $200 que se muestran al lado.
    const m = calcularMargen(
      crudo({
        facturado_total: '1000.0000',
        facturado_con_costo: '600.0000',
        costo: '400.0000',
        lineas_total: 10,
        lineas_con_costo: 6,
      })
    );
    expect(m.margen).toBe('200.0000');
    expect(m.margenPct?.toFixed(1)).toBe('33.3');
    expect(m.margenPct?.toFixed(1)).not.toBe('20.0');
  });

  it('los pesos y el % reconcilian: margen = facturadoConCosto × pct', () => {
    const m = calcularMargen(
      crudo({ facturado_con_costo: '875.0000', costo: '500.0000' })
    );
    const reconstruido = new Decimal(m.facturadoConCosto)
      .times(m.margenPct!)
      .dividedBy(100);
    expect(reconstruido.toFixed(4)).toBe(m.margen);
  });
});

describe('calcularMargen — divisiones que no pueden explotar', () => {
  it('facturado con costo en 0 NO da Infinity', () => {
    const m = calcularMargen(
      crudo({ facturado_con_costo: '0', costo: '0', lineas_con_costo: 3 })
    );
    expect(m.margenPct).toBeNull();
    expect(m.margen).toBe('0.0000');
  });

  it('sin nada facturado, la cobertura es null y no 0%', () => {
    const m = calcularMargen(
      crudo({
        facturado_total: '0',
        facturado_con_costo: '0',
        costo: '0',
        lineas_total: 0,
        lineas_con_costo: 0,
      })
    );
    expect(m.coberturaPct).toBeNull();
  });
});

describe('calcularMargen — vender bajo costo se ve', () => {
  it('un margen negativo NO se recorta a 0', () => {
    const m = calcularMargen(
      crudo({ facturado_con_costo: '100.0000', costo: '130.0000' })
    );
    expect(m.margen).toBe('-30.0000');
    expect(new Decimal(m.margen!).isNegative()).toBe(true);
    expect(m.margenPct?.toFixed(1)).toBe('-30.0');
  });
});

describe('rentabilidadDe — la fila por producto', () => {
  it('un producto sin costo SIGUE en la lista, con el margen en null', () => {
    // Sacarlo lo volvería invisible justo para quien tendría que cargarle el
    // costo, y además haría que la suma de la tabla no cierre con el total.
    const f = rentabilidadDe({
      product_id: 'p1',
      nombre: 'Caramelo suelto',
      facturado: '5000.0000',
      costo: null,
    });
    expect(f.facturado).toBe('5000.0000');
    expect(f.margen).toBeNull();
    expect(f.margenPct).toBeNull();
  });

  it('con costo calcula margen y porcentaje', () => {
    const f = rentabilidadDe({
      product_id: 'p2',
      nombre: 'Coca 500',
      facturado: '1000.0000',
      costo: '580.0000',
    });
    expect(f.margen).toBe('420.0000');
    expect(f.margenPct?.toFixed(1)).toBe('42.0');
  });

  it('un producto regalado no divide por cero', () => {
    const f = rentabilidadDe({
      product_id: 'p3',
      nombre: 'Muestra gratis',
      facturado: '0',
      costo: '0',
    });
    expect(f.margenPct).toBeNull();
  });
});

describe('colorDelMargen — el umbral es el de ofertas.html', () => {
  it('el corte es 15, igual que la maqueta', () => {
    expect(MARGEN_SANO).toBe(15);
  });

  it('justo en 15 ya es sano', () => {
    expect(colorDelMargen(new Decimal('15'))).toBe('sano');
  });

  it('14,9 es ajustado', () => {
    expect(colorDelMargen(new Decimal('14.9'))).toBe('ajustado');
  });

  it('0 es ajustado, no bajo costo: vender al costo no es perder', () => {
    expect(colorDelMargen(new Decimal('0'))).toBe('ajustado');
  });

  it('cualquier negativo es bajo costo', () => {
    expect(colorDelMargen(new Decimal('-0.01'))).toBe('bajo_costo');
  });

  it('sin dato NO se pinta como pérdida', () => {
    expect(colorDelMargen(null)).toBe('sin_dato');
    expect(colorDelMargen(null)).not.toBe('bajo_costo');
  });
});

describe('cómo se dice', () => {
  it('el porcentaje va con coma, como todo el resto de la app', () => {
    expect(decirPct(new Decimal('33.333'))).toBe('33,3%');
  });

  it('sin dato se dice, no se deja en blanco', () => {
    expect(decirPct(null)).toBe('sin dato');
  });

  it('usa las mismas palabras que Ofertas', () => {
    expect(decirMargen(new Decimal('34'))).toBe('Margen sano · 34,0%');
    expect(decirMargen(new Decimal('11'))).toBe('Margen ajustado · 11,0%');
    expect(decirMargen(new Decimal('-5'))).toBe('Vende bajo costo');
    expect(decirMargen(null)).toBe('Sin costo cargado');
  });
});
