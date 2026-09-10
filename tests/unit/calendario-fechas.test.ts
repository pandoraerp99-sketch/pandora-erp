/**
 * T-CAL-01 — la aritmética de fechas del calendario.
 *
 * ── LO QUE SE PROTEGE ─────────────────────────────────────────────────────
 * Que el mes arranque en el día de semana correcto y que "hoy" caiga en la
 * celda de hoy. Suena trivial y es justo donde este proyecto se tropieza:
 * `new Date('2026-09-10')` es medianoche UTC, que en Ushuaia es el 9 a las
 * 21:00. Un calendario armado así se ve perfecto en una captura y está corrido
 * un día.
 */
import { describe, expect, it } from 'vitest';
import {
  claveDeDia,
  diaDeSemanaLunesPrimero,
  diasDelMes,
  moverMes,
  partesDeFecha,
} from '@/lib/calendar/fechas';

describe('T-CAL-01 — fechas del calendario', () => {
  describe('el mes arranca donde tiene que arrancar', () => {
    // Verificado contra almanaque. Lunes = 0.
    it.each([
      [2026, 9, 1, 'martes'],
      [2026, 6, 0, 'lunes'],
      [2026, 7, 2, 'miércoles'],
      [2026, 8, 5, 'sábado'],
      [2026, 10, 3, 'jueves'],
      [2026, 11, 6, 'domingo'],
      [2027, 1, 4, 'viernes'],
    ])('el 1/%i-%i cae en índice %i (%s)', (anio, mes, esperado) => {
      expect(diaDeSemanaLunesPrimero(anio, mes, 1)).toBe(esperado);
    });

    /**
     * El test que importa: la zona horaria de la máquina NO puede cambiar el
     * resultado. Con `new Date(iso).getDay()` este test fallaría en cualquier
     * huso al oeste de Greenwich.
     */
    it('no depende del huso de la máquina que lo corre', () => {
      const tz = process.env.TZ;
      const resultados: number[] = [];
      for (const zona of ['UTC', 'America/Argentina/Ushuaia', 'Pacific/Kiritimati']) {
        process.env.TZ = zona;
        resultados.push(diaDeSemanaLunesPrimero(2026, 9, 1));
      }
      process.env.TZ = tz;
      expect(new Set(resultados).size).toBe(1);
      expect(resultados[0]).toBe(1); // martes
    });
  });

  describe('días del mes', () => {
    it.each([
      [2026, 2, 28],
      [2028, 2, 29], // bisiesto
      [2000, 2, 29], // bisiesto secular (divisible por 400)
      [1900, 2, 28], // NO bisiesto (divisible por 100 y no por 400)
      [2026, 4, 30],
      [2026, 12, 31],
    ])('%i-%i tiene %i días', (anio, mes, esperado) => {
      expect(diasDelMes(anio, mes)).toBe(esperado);
    });
  });

  describe('partes y clave', () => {
    it('ida y vuelta sin perder nada', () => {
      const iso = '2026-09-01';
      const [a, m, d] = partesDeFecha(iso);
      expect(claveDeDia(a, m, d)).toBe(iso);
    });

    it('rellena con cero para que la clave ordene como texto', () => {
      // El componente compara claves con `>` para saber si un día es futuro.
      // Sin el padding, '2026-9-2' > '2026-10-1' sería verdadero.
      expect(claveDeDia(2026, 9, 2)).toBe('2026-09-02');
      expect(claveDeDia(2026, 10, 1) > claveDeDia(2026, 9, 2)).toBe(true);
      expect(claveDeDia(2026, 1, 15) > claveDeDia(2025, 12, 31)).toBe(true);
    });

    it('una fecha con formato raro no pasa en silencio', () => {
      expect(() => partesDeFecha('2026-9-1')).toThrow();
      expect(() => partesDeFecha('no es fecha')).toThrow();
    });
  });

  describe('navegación de meses', () => {
    it('cruza el fin de año en las dos direcciones', () => {
      expect(moverMes(2026, 12, 1)).toEqual({ anio: 2027, mes: 1 });
      expect(moverMes(2026, 1, -1)).toEqual({ anio: 2025, mes: 12 });
    });

    it('doce pasos vuelven al mismo mes, un año después', () => {
      let v = { anio: 2026, mes: 5 };
      for (let i = 0; i < 12; i++) v = moverMes(v.anio, v.mes, 1);
      expect(v).toEqual({ anio: 2027, mes: 5 });
    });
  });
});
