/**
 * T-CHART-01 — la curva del Panel no puede inventar valores.
 *
 * ── POR QUE ESTE ARCHIVO EXISTE ───────────────────────────────────────────
 * El Panel dibuja las ventas por hora como una curva suave. Una spline común
 * SOBREPASA entre los puntos: después de un pico baja de más y cruza el cero
 * —ventas negativas a una hora en la que no se vendió— y entre dos horas flojas
 * dibuja una loma que sugiere un movimiento que no pasó.
 *
 * Eso no es un detalle de estilo. Un panel se mira de reojo y nadie cruza la
 * curva contra la tabla: el número dibujado se cree.
 *
 * Estos tests son la única forma de afirmar que la curva no miente, en vez de
 * mirarla y decir que se ve bien.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluarMonotona,
  pendientesMonotonas,
  rutaMonotona,
  type Punto,
} from '@/components/charts/monotone';

/** Muestrea la curva densamente y devuelve el mínimo y el máximo dibujados. */
function rango(pts: Punto[], muestrasPorTramo = 60) {
  const m = pendientesMonotonas(pts);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let s = 0; s <= muestrasPorTramo; s++) {
      const x = pts[i]!.x + ((pts[i + 1]!.x - pts[i]!.x) * s) / muestrasPorTramo;
      const y = evaluarMonotona(pts, m, x);
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  return { min, max };
}

const serie = (ys: number[]): Punto[] => ys.map((y, x) => ({ x, y }));

describe('T-CHART-01 — la curva no se sale del rango', () => {
  it('EL CASO QUE MOTIVA TODO: un pico aislado no hace que la curva cruce el cero', () => {
    // Una hora con mucha venta entre dos horas sin nada. Una spline común baja
    // de más al salir del pico y dibuja ventas NEGATIVAS.
    const { min, max } = rango(serie([0, 71500, 0]));
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(71500);
  });

  it('un valle aislado tampoco se pasa para abajo', () => {
    const { min, max } = rango(serie([50000, 0, 50000]));
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(50000);
  });

  it('nunca se sale del rango, con una jornada entera de kiosco', () => {
    // 9 a 21, con los dos picos tipicos: mediodia y la tarde.
    const ys = [8000, 14000, 36200, 52000, 71500, 44000, 19000, 12000, 23000, 41000, 66000, 58000, 31000];
    const { min, max } = rango(serie(ys));
    expect(min).toBeGreaterThanOrEqual(Math.min(...ys));
    expect(max).toBeLessThanOrEqual(Math.max(...ys));
  });

  it('en un tramo la curva se queda entre SUS DOS extremos, no sólo dentro del total', () => {
    // Este es el chequeo fino: que no haya una loma local entre dos puntos
    // consecutivos, aunque esa loma quede dentro del rango global.
    const pts = serie([10, 10, 90, 10, 10]);
    const m = pendientesMonotonas(pts);
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = Math.min(pts[i]!.y, pts[i + 1]!.y);
      const hi = Math.max(pts[i]!.y, pts[i + 1]!.y);
      for (let s = 0; s <= 40; s++) {
        const x = pts[i]!.x + ((pts[i + 1]!.x - pts[i]!.x) * s) / 40;
        const y = evaluarMonotona(pts, m, x);
        expect(y, `tramo ${i} en x=${x.toFixed(2)}`).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(y, `tramo ${i} en x=${x.toFixed(2)}`).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it('dos valores iguales dan un tramo PLANO, sin panza', () => {
    const pts = serie([100, 100, 30]);
    const m = pendientesMonotonas(pts);
    for (let s = 0; s <= 20; s++) {
      expect(evaluarMonotona(pts, m, s / 20)).toBeCloseTo(100, 6);
    }
  });

  it('pasa exactamente por cada punto de la serie', () => {
    // Suavizar no puede correr los datos: el valor de las 13:00 tiene que ser
    // el de las 13:00.
    const ys = [3, 17, 4, 29, 11];
    const pts = serie(ys);
    const m = pendientesMonotonas(pts);
    ys.forEach((y, i) => {
      expect(evaluarMonotona(pts, m, i)).toBeCloseTo(y, 9);
    });
  });

  it('una serie toda en cero se queda en cero', () => {
    const { min, max } = rango(serie([0, 0, 0, 0]));
    expect(min).toBe(0);
    expect(max).toBe(0);
  });

  it('una serie creciente no baja en ningún punto', () => {
    const pts = serie([1, 5, 9, 20, 44]);
    const m = pendientesMonotonas(pts);
    let anterior = -Infinity;
    for (let s = 0; s <= 200; s++) {
      const y = evaluarMonotona(pts, m, (s / 200) * (pts.length - 1));
      expect(y).toBeGreaterThanOrEqual(anterior - 1e-9);
      anterior = y;
    }
  });
});

describe('T-CHART-01 — el path dibujado es la curva evaluada', () => {
  it('los puntos de control salen de las mismas tangentes', () => {
    // Si el <path> se armara con otra cuenta, los tests de arriba estarían
    // probando una curva y la pantalla mostrando otra.
    const pts = serie([0, 10, 0]);
    const m = pendientesMonotonas(pts);
    const d = rutaMonotona(pts);

    // Primer tramo: C c1x c1y, c2x c2y, x1 y1
    const h = 1;
    const c1y = (pts[0]!.y + (m[0]! * h) / 3).toFixed(2);
    const c2y = (pts[1]!.y - (m[1]! * h) / 3).toFixed(2);
    expect(d).toContain(`C 0.33 ${c1y}, 0.67 ${c2y}, 1.00 10.00`);
  });

  it('arranca con un M en el primer punto', () => {
    expect(rutaMonotona(serie([7, 8]))).toMatch(/^M 0.00 7.00 /);
  });

  it('sin puntos devuelve una ruta vacía, no explota', () => {
    expect(rutaMonotona([])).toBe('');
  });

  it('con un solo punto devuelve sólo el M', () => {
    expect(rutaMonotona([{ x: 5, y: 3 }])).toBe('M 5 3');
  });
});
