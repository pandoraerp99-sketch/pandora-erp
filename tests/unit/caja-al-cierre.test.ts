/**
 * Ítem 1 de la contadora: saldo de caja a la fecha de cierre.
 *
 * Lo que se prueba acá no es la suma (es una suma): es **cuándo NO hay que dar
 * un número**. Una caja abierta no tiene efectivo contado, y el balance pide
 * plata contada.
 */
import { describe, expect, it } from 'vitest';
import {
  armarCajaAlCierre,
  type ArqueoDePunto,
  type CajaAbierta,
} from '../../src/lib/domain/caja-al-cierre.js';

const arqueo = (
  punto: number,
  fecha: string,
  contado: string,
  descuadre = '0'
): ArqueoDePunto => ({ punto, fecha, contado, descuadre });

const abierta = (punto: number, desde: string, cerroDespues: string | null = null): CajaAbierta => ({
  punto,
  desde,
  cerroDespues,
});

describe('caja al cierre — los cuatro estados', () => {
  it('cuenta el arqueo del día cuando se cerró esa fecha', () => {
    const caja = armarCajaAlCierre({
      fechaCierre: '2026-07-31',
      arqueos: [arqueo(1, '2026-07-31', '349000.0000')],
      abiertas: [],
    });

    expect(caja.estado).toBe('contado');
    expect(caja.total).toBe('349000.0000');
    expect(caja.puntos).toHaveLength(1);
  });

  it('marca "anterior" y conserva la fecha si el último arqueo es de otro día', () => {
    const caja = armarCajaAlCierre({
      fechaCierre: '2026-07-31',
      arqueos: [arqueo(1, '2026-07-29', '120000.0000')],
      abiertas: [],
    });

    expect(caja.estado).toBe('anterior');
    expect(caja.total).toBe('120000.0000');
    // La fecha del arqueo viaja: sin ella, el número dice ser del 31 y es del 29.
    expect(caja.puntos[0]!.fecha).toBe('2026-07-29');
  });

  it('sin ningún cierre hasta la fecha no inventa un cero', () => {
    const caja = armarCajaAlCierre({
      fechaCierre: '2026-07-31',
      arqueos: [],
      abiertas: [],
    });

    expect(caja.estado).toBe('sin_datos');
    // $0 se leería como "la caja estaba vacía", que es otra afirmación.
    expect(caja.total).toBeNull();
  });

  it('una caja abierta al cierre NO emite monto', () => {
    const caja = armarCajaAlCierre({
      fechaCierre: '2026-07-31',
      arqueos: [],
      abiertas: [abierta(1, '2026-07-31')],
    });

    expect(caja.total).toBeNull();
    expect(caja.estado).toBe('sin_datos');
    expect(caja.abiertas[0]).toMatchObject({ punto: 1, cerroDespues: null });
  });

  it('una caja que se contó recién después del cierre sigue siendo un hueco', () => {
    const caja = armarCajaAlCierre({
      fechaCierre: '2026-07-31',
      arqueos: [arqueo(1, '2026-07-30', '80000.0000')],
      abiertas: [abierta(2, '2026-07-31', '2026-08-02')],
    });

    // El punto 2 no suma: al 31/07 esa plata todavía no se había contado.
    expect(caja.total).toBe('80000.0000');
    expect(caja.abiertas[0]!.cerroDespues).toBe('2026-08-02');
  });
});

describe('caja al cierre — varios puntos de venta', () => {
  it('suma el último arqueo de cada caja y deja el desglose a la vista', () => {
    const caja = armarCajaAlCierre({
      fechaCierre: '2026-07-31',
      arqueos: [arqueo(2, '2026-07-31', '50000.5000'), arqueo(1, '2026-07-31', '349000.0000')],
      abiertas: [],
    });

    expect(caja.total).toBe('399000.5000');
    // Orden estable por punto: la pantalla y el CSV listan lo mismo.
    expect(caja.puntos.map((p) => p.punto)).toEqual([1, 2]);
  });

  it('con una caja arqueada otro día, el estado es "anterior" aunque la otra sea del día', () => {
    const caja = armarCajaAlCierre({
      fechaCierre: '2026-07-31',
      arqueos: [arqueo(1, '2026-07-31', '10000.0000'), arqueo(2, '2026-07-15', '2000.0000')],
      abiertas: [],
    });

    expect(caja.estado).toBe('anterior');
    expect(caja.total).toBe('12000.0000');
  });

  it('dos arqueos del mismo punto es un error de programación, no un dato raro', () => {
    expect(() =>
      armarCajaAlCierre({
        fechaCierre: '2026-07-31',
        arqueos: [arqueo(1, '2026-07-31', '100.0000'), arqueo(1, '2026-07-30', '90.0000')],
        abiertas: [],
      })
    ).toThrow(/punto de venta 1/);
  });

  it('no usa aritmética de punto flotante', () => {
    const caja = armarCajaAlCierre({
      fechaCierre: '2026-07-31',
      arqueos: [arqueo(1, '2026-07-31', '0.1000'), arqueo(2, '2026-07-31', '0.2000')],
      abiertas: [],
    });

    // 0.1 + 0.2 con Number daría 0.30000000000000004.
    expect(caja.total).toBe('0.3000');
  });
});
