/**
 * Las etiquetas de mes de la serie de Clientes, leídas en la hora del comercio.
 *
 * Entre las 21:00 y la medianoche del último día del mes, UTC ya está en el mes
 * siguiente. Con etiquetas en UTC, durante esas tres horas la serie entera se
 * corre un lugar: la compra de hoy cae en un mes que el comercio todavía no
 * empezó, y "activos del mes" dice 0.
 */
import { describe, expect, it } from 'vitest';
import { mesesDelComercio } from '@/lib/domain/fecha-comercio';

describe('mesesDelComercio', () => {
  it('devuelve n meses, del más viejo al actual', () => {
    const m = mesesDelComercio(3, new Date('2026-09-14T15:00:00Z'));
    expect(m).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('🔴 el 30/09 a las 22:00 en Ushuaia el mes actual sigue siendo septiembre', () => {
    // 2026-10-01T01:00Z = 30/09 22:00 en Ushuaia (UTC-3).
    const m = mesesDelComercio(12, new Date('2026-10-01T01:00:00Z'));
    expect(m.at(-1)).toBe('2026-09');
    expect(m[0]).toBe('2025-10');
  });

  it('cruza el año', () => {
    // 2027-01-01T02:59Z = 31/12 23:59 en Ushuaia.
    const m = mesesDelComercio(2, new Date('2027-01-01T02:59:00Z'));
    expect(m).toEqual(['2026-11', '2026-12']);
  });

  it('el primer instante del mes local ya es el mes nuevo', () => {
    // 2026-10-01T03:00Z = 01/10 00:00 en Ushuaia.
    expect(mesesDelComercio(1, new Date('2026-10-01T03:00:00Z'))).toEqual(['2026-10']);
  });
});
