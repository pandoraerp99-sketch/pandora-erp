/**
 * T-TASK-01 — cuándo vuelve a vencer una tarea que se repite.
 *
 * ── LAS DOS COSAS QUE ESTA REGLA TIENE QUE LOGRAR A LA VEZ ────────────────
 *
 * 1) NO FABRICAR UNA PILA. Si una tarea diaria vence el viernes y se tacha el
 *    lunes, avanzar "un día desde el vencimiento" deja sábado, domingo y lunes
 *    vencidos. El lunes a la mañana el comercio abre y encuentra cuatro tareas
 *    rojas que en realidad son una. Eso hace que la lista se ignore, y una
 *    lista de pendientes que se ignora es peor que no tenerla.
 *
 * 2) NO PERDER EL ANCLA. "Pagar el alquiler el 10" tiene que seguir cayendo el
 *    10. Avanzar desde la fecha en que se tachó (que es la otra solución obvia
 *    al problema 1) hace que pagar tarde el 12 mueva el vencimiento al 12, y
 *    al mes siguiente al 14: la fecha se va corriendo sola hasta no significar
 *    nada.
 *
 * La regla que cumple las dos: avanzar DESDE EL VENCIMIENTO, de a un paso, y
 * seguir avanzando hasta pasar el día en que se tachó. Se saltean las
 * ocurrencias perdidas en vez de acumularlas, y el día del mes no se mueve.
 */
import { describe, expect, it } from 'vitest';
import { proximaFecha } from '../../src/lib/tasks/recurrencia.js';

describe('T-TASK-01 — próxima fecha de una tarea recurrente', () => {
  describe('diaria', () => {
    it('tachada el mismo día que vencía → vence mañana', () => {
      expect(proximaFecha('2026-09-10', 'diaria', '2026-09-10')).toBe('2026-09-11');
    });

    it('vencía el viernes y se tachó el lunes → UNA sola, el martes', () => {
      // El caso que motiva toda la regla: sábado, domingo y lunes se saltean.
      expect(proximaFecha('2026-09-11', 'diaria', '2026-09-14')).toBe('2026-09-15');
    });

    it('cruza el fin de mes', () => {
      expect(proximaFecha('2026-09-30', 'diaria', '2026-09-30')).toBe('2026-10-01');
    });

    it('cruza el fin de año', () => {
      expect(proximaFecha('2026-12-31', 'diaria', '2026-12-31')).toBe('2027-01-01');
    });

    it('tachada ANTES de vencer → igual avanza un paso desde el vencimiento', () => {
      expect(proximaFecha('2026-09-20', 'diaria', '2026-09-10')).toBe('2026-09-21');
    });
  });

  describe('semanal', () => {
    it('mantiene el día de la semana', () => {
      // 2026-09-10 es jueves.
      expect(proximaFecha('2026-09-10', 'semanal', '2026-09-10')).toBe('2026-09-17');
    });

    it('dos semanas tarde → sigue cayendo jueves, no se acumulan', () => {
      expect(proximaFecha('2026-09-10', 'semanal', '2026-09-25')).toBe('2026-10-01');
    });
  });

  describe('mensual', () => {
    it('mantiene el día del mes', () => {
      expect(proximaFecha('2026-09-10', 'mensual', '2026-09-10')).toBe('2026-10-10');
    });

    it('pagar tarde NO corre la fecha del mes siguiente', () => {
      // Se pagó el 12 lo que vencía el 10: el mes que viene sigue venciendo el 10.
      expect(proximaFecha('2026-09-10', 'mensual', '2026-09-12')).toBe('2026-10-10');
    });

    it('el 31 en un mes de 30 cae el último día', () => {
      expect(proximaFecha('2026-01-31', 'mensual', '2026-01-31')).toBe('2026-02-28');
    });

    it('y el mes siguiente VUELVE al 31: el ancla no se pierde', () => {
      // Esta es la que distingue "recortar cada paso" de "recordar el ancla".
      expect(proximaFecha('2026-01-31', 'mensual', '2026-02-28')).toBe('2026-03-31');
    });

    it('febrero de un año bisiesto', () => {
      expect(proximaFecha('2028-01-31', 'mensual', '2028-01-31')).toBe('2028-02-29');
    });

    it('cruza el año', () => {
      expect(proximaFecha('2026-12-15', 'mensual', '2026-12-15')).toBe('2027-01-15');
    });

    it('un año entero sin tachar sigue cayendo el mismo día', () => {
      expect(proximaFecha('2026-01-31', 'mensual', '2026-12-05')).toBe('2026-12-31');
    });
  });

  it('rechaza una fecha con formato inesperado en vez de inventar una', () => {
    expect(() => proximaFecha('10/09/2026', 'diaria', '2026-09-10')).toThrow();
  });
});
