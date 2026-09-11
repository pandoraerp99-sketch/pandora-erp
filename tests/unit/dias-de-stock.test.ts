/**
 * T-STOCK-10 — días de stock restantes.
 *
 * Es la primera proyección del sistema, y las proyecciones tienen un sesgo
 * documentado: se leen como promesa. Lo que se protege acá son las dos formas
 * en que este cálculo miente **al lado optimista**, que son las dos que una
 * implementación ingenua tiene mal mientras todo el resto pasa:
 *
 *   1. **Stock en cero da 0 días y parece lo más urgente.** No lo es: el
 *      quiebre YA pasó. "Te quedan 0 días" dice "comprá ya"; la verdad es
 *      "hace rato que no tenés y venís perdiendo ventas". Son dos cosas
 *      distintas y se actúa distinto.
 *
 *   2. **Vendido = 0 da una división por cero.** En JS eso es `Infinity`, que
 *      renderiza como "Infinity días" o —peor— como un número enorme que se
 *      lee como "tenés de sobra". No hay velocidad que medir: es otra cosa.
 *
 * Y una tercera, de la ventana: dividir las ventas de 3 días por 30 triplica
 * para abajo la velocidad de todos los productos, o sea que exagera los días
 * que quedan. Justo cuando el comercio tiene menos con qué darse cuenta.
 */
import { describe, expect, it } from 'vitest';
import {
  clasificar,
  coberturaDeHistoria,
  decirDias,
  esParaElPanel,
  MINIMO_DIAS_HISTORIA,
  VENTANA_DIAS,
  ventanaEfectiva,
} from '../../src/lib/stock/dias-de-stock.js';

describe('T-STOCK-10 — clasificación', () => {
  it('stock en cero es SIN STOCK, nunca "0 días"', () => {
    // La trampa principal del §8.b del brief.
    expect(clasificar(0, 0)).toBe('sin_stock');
    expect(clasificar(0, null)).toBe('sin_stock');
  });

  it('stock negativo también es sin stock', () => {
    // No debería pasar (hay anti-oversell), pero si pasa no se dibuja
    // "-3 días" ni se lo trata como holgado.
    expect(clasificar(-3, 0)).toBe('sin_stock');
  });

  it('sin ventas en la ventana NO es "infinitos días"', () => {
    // `dias === null` es lo que devuelve la consulta cuando la velocidad es 0.
    expect(clasificar(20, null)).toBe('sin_rotacion');
  });

  it('pocos días es "se acaba"', () => {
    expect(clasificar(10, 4)).toBe('se_acaba');
    expect(clasificar(10, 0.5)).toBe('se_acaba');
  });

  it('muchos días es holgado', () => {
    expect(clasificar(100, 45)).toBe('holgado');
  });

  it('el límite entre se_acaba y holgado no deja un hueco', () => {
    // Sea cual sea el umbral, ningún valor puede quedar sin clasificar.
    for (const d of [0.1, 1, 3, 6.9, 7, 7.1, 8, 14, 100]) {
      expect(['se_acaba', 'holgado']).toContain(clasificar(50, d));
    }
  });
});

describe('T-STOCK-10 — la ventana no puede ser más larga que la historia', () => {
  it('con historia de sobra usa la ventana completa', () => {
    expect(ventanaEfectiva(365)).toBe(VENTANA_DIAS);
  });

  it('con poca historia usa la historia, no la ventana', () => {
    // Dividir 3 días de ventas por 30 daría una velocidad 10 veces menor, o
    // sea 10 veces MAS días de stock de los que hay. Miente para arriba.
    expect(ventanaEfectiva(3)).toBe(3);
  });

  it('nunca devuelve cero: sería una división por cero', () => {
    expect(ventanaEfectiva(0)).toBe(1);
    expect(ventanaEfectiva(-5)).toBe(1);
  });

  it('en el borde exacto usa la ventana', () => {
    expect(ventanaEfectiva(VENTANA_DIAS)).toBe(VENTANA_DIAS);
    expect(ventanaEfectiva(VENTANA_DIAS - 1)).toBe(VENTANA_DIAS - 1);
  });
});

describe('T-STOCK-10 — la compuerta de historia real', () => {
  it('sin una sola venta no alcanza, y lo dice', () => {
    const c = coberturaDeHistoria(0);
    expect(c.alcanza).toBe(false);
    expect(c.faltanDias).toBe(MINIMO_DIAS_HISTORIA);
  });

  it('con menos del mínimo no alcanza y dice cuánto falta', () => {
    const c = coberturaDeHistoria(5);
    expect(c.alcanza).toBe(false);
    expect(c.faltanDias).toBe(MINIMO_DIAS_HISTORIA - 5);
  });

  it('justo en el mínimo ya alcanza', () => {
    expect(coberturaDeHistoria(MINIMO_DIAS_HISTORIA).alcanza).toBe(true);
    expect(coberturaDeHistoria(MINIMO_DIAS_HISTORIA).faltanDias).toBe(0);
  });

  it('con historia de sobra alcanza y no falta nada', () => {
    const c = coberturaDeHistoria(400);
    expect(c.alcanza).toBe(true);
    expect(c.faltanDias).toBe(0);
  });
});

describe('T-STOCK-10 — qué llega al panel', () => {
  const fila = (estado: string, stock: number, minimo: number | null) =>
    ({ estado, stock, minimo }) as Parameters<typeof esParaElPanel>[0];

  it('lo que se acabó y lo que se está por acabar, siempre', () => {
    expect(esParaElPanel(fila('sin_stock', 0, null))).toBe(true);
    expect(esParaElPanel(fila('se_acaba', 3, null))).toBe(true);
  });

  it('lo holgado no ocupa lugar', () => {
    expect(esParaElPanel(fila('holgado', 300, 10))).toBe(false);
  });

  it('sin rotación con stock de sobra NO va: es capital dormido, otra charla', () => {
    // En un comercio real la mayor parte del catálogo no vende en 30 días. Si
    // esto entrara, el bloque arrancaría con cuarenta filas el primer día y
    // nadie lo volvería a mirar.
    expect(esParaElPanel(fila('sin_rotacion', 20, 5))).toBe(false);
  });

  it('sin rotación y además abajo del mínimo SI va', () => {
    expect(esParaElPanel(fila('sin_rotacion', 2, 5))).toBe(true);
  });

  it('sin rotación sin mínimo definido no va: no hay con qué decir que es poco', () => {
    // 20001 de 20009 productos no tienen mínimo cargado. Sin ese dato no se
    // puede afirmar que 2 unidades sean pocas.
    expect(esParaElPanel(fila('sin_rotacion', 2, null))).toBe(false);
  });
});

describe('T-STOCK-10 — cómo se dice el número de días', () => {
  it('abajo de un día no finge precisión', () => {
    expect(decirDias(0.4)).toBe('menos de un día');
    expect(decirDias(0.99)).toBe('menos de un día');
  });

  it('NO aplasta 1,1 · 1,3 y 1,9 en un mismo "1 día"', () => {
    // El bug que se vio en la captura: la lista está ORDENADA por urgencia y
    // la etiqueta borraba justo la diferencia que define si comprar hoy o
    // mañana. Los tres decían "1 día".
    const tres = [decirDias(1.06), decirDias(1.31), decirDias(1.98)];
    expect(new Set(tres).size).toBe(3);
    expect(tres).toEqual(['1,1 días', '1,3 días', '2,0 días']);
  });

  it('el uno exacto se dice en singular y sin decimal', () => {
    expect(decirDias(1)).toBe('1 día');
  });

  it('arriba de 3 días el decimal no aporta y se redondea para abajo', () => {
    // Nadie compra distinto por 5,4 en vez de 5. Y para abajo es el lado
    // seguro de errar en un aviso de faltante.
    expect(decirDias(5.4)).toBe('5 días');
    expect(decirDias(5.9)).toBe('5 días');
    expect(decirDias(30)).toBe('30 días');
  });

  it('usa coma decimal, no punto', () => {
    // Es la pantalla en español rioplatense.
    expect(decirDias(2.5)).toContain(',');
    expect(decirDias(2.5)).not.toContain('.');
  });
});
