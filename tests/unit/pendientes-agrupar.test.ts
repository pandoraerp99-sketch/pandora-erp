/**
 * T-TASK-03 — agrupado de pendientes y pendientes derivados.
 *
 * Son comparaciones de fechas, que es donde se esconden los errores de un día:
 * "vencido" por un día de más significa que el comercio abre y ve en rojo algo
 * que vence recién hoy.
 *
 * Las fechas de la prueba están escritas a mano a propósito. Calcularlas con
 * `new Date()` haría que el test dependiera del día en que corre y del huso de
 * la máquina — que es exactamente el error que este código evita.
 */
import { describe, expect, it } from 'vitest';
import {
  agruparPendientes,
  derivarPendientes,
  grupoDe,
} from '../../src/lib/tasks/agrupar.js';

const HOY = '2026-09-10'; // jueves

describe('T-TASK-03 — en qué grupo cae cada fecha', () => {
  it('ayer es vencido', () => {
    expect(grupoDe('2026-09-09', HOY)).toBe('vencido');
  });

  it('hoy es hoy, no vencido', () => {
    // El error de un día clásico: mostrar en rojo lo que vence recién hoy.
    expect(grupoDe(HOY, HOY)).toBe('hoy');
  });

  it('mañana tiene grupo propio', () => {
    expect(grupoDe('2026-09-11', HOY)).toBe('manana');
  });

  it('pasado mañana y hasta 7 días es "esta semana"', () => {
    expect(grupoDe('2026-09-12', HOY)).toBe('semana');
    expect(grupoDe('2026-09-17', HOY)).toBe('semana');
  });

  it('el día 8 ya es "más adelante"', () => {
    expect(grupoDe('2026-09-18', HOY)).toBe('despues');
  });

  it('sin fecha tiene su propio grupo', () => {
    expect(grupoDe(null, HOY)).toBe('sin_fecha');
  });

  it('cruzando el fin de mes sigue contando bien', () => {
    // Si acá se usara `new Date(iso)` el corrimiento de huso se vería justo acá.
    expect(grupoDe('2026-10-01', '2026-09-30')).toBe('manana');
    expect(grupoDe('2026-10-07', '2026-09-30')).toBe('semana');
    expect(grupoDe('2026-10-08', '2026-09-30')).toBe('despues');
  });

  it('cruzando el fin de año también', () => {
    expect(grupoDe('2027-01-01', '2026-12-31')).toBe('manana');
    expect(grupoDe('2026-12-30', '2026-12-31')).toBe('vencido');
  });
});

describe('T-TASK-03 — armado de los grupos', () => {
  const t = (due: string | null, titulo: string) => ({ due_date: due, titulo });

  it('los ordena vencido → hoy → mañana → semana → después → sin fecha', () => {
    const grupos = agruparPendientes(
      [
        t(null, 'gasista'),
        t('2026-09-25', 'lejano'),
        t('2026-09-09', 'atrasado'),
        t(HOY, 'de hoy'),
        t('2026-09-13', 'domingo'),
        t('2026-09-11', 'de mañana'),
      ],
      HOY
    );
    expect(grupos.map((g) => g.grupo)).toEqual([
      'vencido',
      'hoy',
      'manana',
      'semana',
      'despues',
      'sin_fecha',
    ]);
  });

  it('no devuelve grupos vacíos', () => {
    const grupos = agruparPendientes([t(HOY, 'una sola')], HOY);
    // Un título "Vencido" sobre una lista vacía asusta por nada.
    expect(grupos.length).toBe(1);
    expect(grupos[0]?.etiqueta).toBe('Hoy');
  });

  it('respeta el orden que traían adentro de cada grupo', () => {
    const grupos = agruparPendientes(
      [t('2026-09-05', 'primero'), t('2026-09-07', 'segundo')],
      HOY
    );
    expect(grupos[0]?.items.map((i) => i.titulo)).toEqual(['primero', 'segundo']);
  });

  it('una lista vacía no devuelve nada', () => {
    expect(agruparPendientes([], HOY)).toEqual([]);
  });
});

describe('T-TASK-03 — pendientes derivados', () => {
  it('sin caja abierta no hay nada que avisar', () => {
    expect(derivarPendientes(null, HOY)).toEqual([]);
  });

  it('la caja abierta HOY no es un pendiente: es lo normal', () => {
    expect(derivarPendientes(HOY, HOY)).toEqual([]);
  });

  it('la caja abierta de AYER sí, y manda a /caja', () => {
    const d = derivarPendientes('2026-09-09', HOY);
    expect(d.length).toBe(1);
    expect(d[0]?.titulo).toContain('09/09/2026');
    expect(d[0]?.href).toBe('/caja');
  });

  it('el derivado no tiene forma de tarea: no se puede tachar', () => {
    const d = derivarPendientes('2026-09-09', HOY);
    // Si tuviera `id` y `done_at` alguien lo iba a mandar a completeTask y el
    // service iba a decir "no existe". No se resuelve tachándolo.
    expect(d[0]).not.toHaveProperty('id');
    expect(d[0]).not.toHaveProperty('done_at');
  });
});
