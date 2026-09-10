/**
 * T-MONEY-08 — lo que una persona escribe cuando escribe plata.
 *
 * ── LO QUE SE PROTEGE ─────────────────────────────────────────────────────
 * El fondo inicial de una caja. Si `12.500,50` se lee como `12,50`, el turno
 * arranca con la plata mal y el descuadre aparece recién al cierre, cuando ya
 * nadie se acuerda de qué se tipeó.
 *
 * El caso que motivó el módulo: `replace(',', '.')` a secas convertía
 * `12.500,50` en `12.500.50`, y el dominio lo rechazaba citando un string que
 * la persona nunca escribió.
 */
import { describe, expect, it } from 'vitest';
import { normalizarMontoTipeado } from '@/lib/money/monto-tipeado';

describe('T-MONEY-08 — normalizarMontoTipeado', () => {
  describe('la forma en que se escribe acá', () => {
    it.each([
      ['12500', '12500'],
      ['12500,50', '12500.50'],
      ['12.500,50', '12500.50'],
      ['1.234.567,89', '1234567.89'],
      ['0,5', '0.5'],
      ['12.500', '12500'],
      ['1.000', '1000'],
    ])('%s -> %s', (entrada, esperado) => {
      expect(normalizarMontoTipeado(entrada)).toBe(esperado);
    });
  });

  describe('la forma en que se escribe en el teclado numérico', () => {
    // Mucha gente tipea el punto del pad como decimal. Con dos decimales no
    // hay ambigüedad posible: 3 dígitos serían miles, 2 no.
    it.each([
      ['12500.50', '12500.50'],
      ['0.5', '0.5'],
      ['12.5', '12.5'],
    ])('%s -> %s', (entrada, esperado) => {
      expect(normalizarMontoTipeado(entrada)).toBe(esperado);
    });
  });

  describe('lo que viene de copiar y pegar', () => {
    it.each([
      ['$ 12.500,50', '12500.50'],
      ['  12500  ', '12500'],
      ['$12500', '12500'],
    ])('%s -> %s', (entrada, esperado) => {
      expect(normalizarMontoTipeado(entrada)).toBe(esperado);
    });
  });

  describe('lo que no se puede leer devuelve null, no un número inventado', () => {
    it.each([['', 'vacío'], ['abc', 'letras'], ['1,2,3', 'dos comas'],
             ['12.50.30', 'dos puntos decimales'], ['--5', 'signos'],
             ['1e5', 'notación científica'], [',', 'sólo separador']])(
      '%s (%s)',
      (entrada) => {
        expect(normalizarMontoTipeado(entrada)).toBeNull();
      }
    );
  });

  /**
   * La ambigüedad real: `12.500` puede ser doce mil quinientos o doce con
   * medio. Se resuelve por la forma —tres dígitos = miles— y la pantalla
   * TIENE que mostrar el monto ya interpretado antes de confirmar. Este test
   * fija la regla para que nadie la cambie sin darse cuenta.
   */
  it('tres dígitos después del punto se leen como miles', () => {
    expect(normalizarMontoTipeado('12.500')).toBe('12500');
    expect(normalizarMontoTipeado('12.50')).toBe('12.50');
  });

  it('lo que devuelve siempre lo acepta el dominio', () => {
    const entradas = ['12500', '12.500,50', '$ 1.234.567,89', '0,5', '12500.50'];
    for (const e of entradas) {
      const r = normalizarMontoTipeado(e);
      expect(r).not.toBeNull();
      // El mismo patrón estricto de `normalizeCashAmount`.
      expect(/^-?\d+(\.\d+)?$/.test(r!)).toBe(true);
    }
  });
});
