/**
 * T-PER-01 — el período del ejercicio comercial.
 *
 * ── POR QUE ESTO SE TESTEA TANTO ──────────────────────────────────────────
 * Es aritmética de fechas con un año que no arranca en enero, y el resultado
 * define QUÉ FILAS se le mandan a la contadora. Un mes corrido en un borde
 * manda un balance con doce meses equivocados, y el archivo se ve
 * perfectamente bien formado igual.
 *
 * El caso de referencia es el pedido real: ROMERO & RUIZ SAS cierra el 31/07, y
 * el ejercicio N° 2 va del 01/08/2025 al 31/07/2026
 * (EVIDENCIA-pedido-contadora-2026-09.md).
 */
import { describe, expect, it } from 'vitest';
import {
  GRANOS,
  periodoDe,
  periodoDeEjercicio,
} from '@/lib/services/reporting/accountant.report';

/** 'AAAA-MM-DD' de un Date, en UTC. */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const el = (s: string) => new Date(`${s}T12:00:00.000Z`);

describe('T-PER-01 — ejercicio comercial', () => {
  it('EL CASO REAL: cierra el 31/07, en septiembre de 2026 devuelve 01/08/2025 → 31/07/2026', () => {
    // Textual del pedido: "ejercicio regular N° 2 iniciado el 01/08/2025 y
    // finalizado el 31/07/2026". Si este test se pone rojo, el export deja de
    // coincidir con lo que la contadora pidió por escrito.
    const p = periodoDeEjercicio(7, el('2026-09-09'));
    expect(iso(p.desde)).toBe('2025-08-01');
    // `hasta` es EXCLUSIVE: el 01/08 no entra, el 31/07 sí.
    expect(iso(p.hasta)).toBe('2026-08-01');
    expect(p.etiqueta).toBe('ejercicio 01/08/2025 al 31/07/2026');
  });

  it('devuelve el ejercicio CERRADO, no el que está en curso', () => {
    // El 09/09/2026 el ejercicio en curso arrancó el 01/08/2026. Ése no sirve
    // todavía: un ejercicio tiene destinatario cuando terminó.
    const p = periodoDeEjercicio(7, el('2026-09-09'));
    expect(iso(p.desde)).not.toBe('2026-08-01');
    expect(p.hasta.getTime()).toBeLessThanOrEqual(el('2026-09-09').getTime());
  });

  it('antes de llegar al mes de cierre, el último cerrado es el del año anterior', () => {
    // En mayo de 2026 todavía no cerró el ejercicio que termina el 31/07/2026,
    // así que el último cerrado es el del 31/07/2025.
    const p = periodoDeEjercicio(7, el('2026-05-20'));
    expect(iso(p.desde)).toBe('2024-08-01');
    expect(iso(p.hasta)).toBe('2025-08-01');
  });

  it('EL BORDE: el día del cierre todavía NO cierra ese ejercicio', () => {
    // El 31/07/2026 el ejercicio está terminando pero no terminó: el último
    // cerrado sigue siendo el anterior. Tomarlo un día antes daría un balance
    // de un ejercicio que aún no existe.
    const ultimoDia = periodoDeEjercicio(7, el('2026-07-31'));
    expect(iso(ultimoDia.hasta)).toBe('2025-08-01');

    // Y al día siguiente sí.
    const diaSiguiente = periodoDeEjercicio(7, el('2026-08-01'));
    expect(iso(diaSiguiente.desde)).toBe('2025-08-01');
    expect(iso(diaSiguiente.hasta)).toBe('2026-08-01');
  });

  it('cierre en DICIEMBRE: el ejercicio es el año calendario anterior', () => {
    // Diciembre es el caso donde el mes siguiente cae en OTRO año. Si el
    // cálculo no rodara bien, daría un mes 13.
    const p = periodoDeEjercicio(12, el('2026-09-09'));
    expect(iso(p.desde)).toBe('2025-01-01');
    expect(iso(p.hasta)).toBe('2026-01-01');
    expect(p.etiqueta).toBe('ejercicio 01/01/2025 al 31/12/2025');
  });

  it('cierre en ENERO: arranca en febrero del año anterior', () => {
    const p = periodoDeEjercicio(1, el('2026-09-09'));
    expect(iso(p.desde)).toBe('2025-02-01');
    expect(iso(p.hasta)).toBe('2026-02-01');
  });

  it('un ejercicio SIEMPRE dura doce meses, cierre cualquiera', () => {
    for (let mes = 1; mes <= 12; mes++) {
      const p = periodoDeEjercicio(mes, el('2026-09-09'));
      const meses =
        (p.hasta.getUTCFullYear() - p.desde.getUTCFullYear()) * 12 +
        (p.hasta.getUTCMonth() - p.desde.getUTCMonth());
      expect(meses, `cierre en el mes ${mes}`).toBe(12);
      expect(p.desde.getUTCDate(), `cierre en el mes ${mes}`).toBe(1);
      expect(p.hasta.getUTCDate(), `cierre en el mes ${mes}`).toBe(1);
    }
  });

  it('el último día del rango es el último del mes de cierre, febrero incluido', () => {
    // Febrero es el único mes donde "el último día" cambia de año a año. Como
    // `hasta` es exclusive y cae el día 1, esto sale solo — el test está para
    // que siga saliendo solo si alguien lo reescribe con aritmética de días.
    // 2024 es bisiesto: parado en junio de 2024, el último cierre de febrero
    // fue el 29.
    const bisiesto = periodoDeEjercicio(2, el('2024-06-01'));
    expect(iso(new Date(bisiesto.hasta.getTime() - 86400000))).toBe('2024-02-29');
    // 2025 no lo es: el 28.
    const comun = periodoDeEjercicio(2, el('2025-06-01'));
    expect(iso(new Date(comun.hasta.getTime() - 86400000))).toBe('2025-02-28');
  });

  it('un mes de cierre inválido explota, no devuelve un rango raro', () => {
    // Un rango silenciosamente mal es peor que un error: el CSV sale igual.
    expect(() => periodoDeEjercicio(0)).toThrow(RangeError);
    expect(() => periodoDeEjercicio(13)).toThrow(RangeError);
    expect(() => periodoDeEjercicio(7.5)).toThrow(RangeError);
    expect(() => periodoDeEjercicio(Number.NaN)).toThrow(RangeError);
  });
});

describe('T-PER-01 — el grano nuevo entra sin romper los otros', () => {
  it('"ejercicio" está en GRANOS, así que la URL lo acepta', () => {
    expect(GRANOS).toContain('ejercicio');
  });

  it('periodoDe("ejercicio", ...) usa el mes de cierre que se le pasa', () => {
    const p = periodoDe('ejercicio', el('2026-09-09'), 7);
    expect(iso(p.desde)).toBe('2025-08-01');
    expect(iso(p.hasta)).toBe('2026-08-01');
  });

  it('sin mes de cierre cae en diciembre, no explota', () => {
    // El default tiene que ser inofensivo: una empresa sin el dato cargado ve
    // el año calendario anterior, que es lo correcto para la mayoría.
    const p = periodoDe('ejercicio', el('2026-09-09'));
    expect(iso(p.desde)).toBe('2025-01-01');
  });

  it('mes, trimestre y año siguen dando lo mismo que antes', () => {
    const f = el('2026-09-09');
    expect(iso(periodoDe('mes', f).desde)).toBe('2026-09-01');
    expect(iso(periodoDe('mes', f).hasta)).toBe('2026-10-01');
    expect(iso(periodoDe('trimestre', f).desde)).toBe('2026-07-01');
    expect(iso(periodoDe('trimestre', f).hasta)).toBe('2026-10-01');
    expect(iso(periodoDe('anio', f).desde)).toBe('2026-01-01');
    expect(iso(periodoDe('anio', f).hasta)).toBe('2027-01-01');
  });

  it('el mes de cierre NO afecta a los otros granos', () => {
    const f = el('2026-09-09');
    for (const g of ['mes', 'trimestre', 'anio'] as const) {
      expect(iso(periodoDe(g, f, 7).desde)).toBe(iso(periodoDe(g, f, 12).desde));
    }
  });
});

/**
 * El período se elige con el calendario del COMERCIO.
 *
 * Ushuaia está tres horas atrás de UTC. Entre las 21:00 y la medianoche del
 * último día de un mes, el reloj UTC ya está en el mes siguiente: sin esto, a
 * esa hora la pantalla de la contadora mostraba el mes que todavía no empezó.
 */
describe('T-PER-01 — el calendario es el del comercio, no el de UTC', () => {
  // 31/07/2026 22:00 en Ushuaia = 01/08/2026 01:00 UTC.
  const nocheDel31deJulio = new Date('2026-08-01T01:00:00.000Z');

  it('a las 22:00 del 31/07 el mes sigue siendo julio', () => {
    const p = periodoDe('mes', nocheDel31deJulio);
    expect(iso(p.desde)).toBe('2026-07-01');
    expect(iso(p.hasta)).toBe('2026-08-01');
  });

  it('a las 22:00 del 30/06 el trimestre sigue siendo el segundo', () => {
    const p = periodoDe('trimestre', new Date('2026-07-01T01:00:00.000Z'));
    expect(iso(p.desde)).toBe('2026-04-01');
  });

  it('a las 22:00 del 31/12 el año sigue siendo el que termina', () => {
    const p = periodoDe('anio', new Date('2027-01-01T01:00:00.000Z'));
    expect(iso(p.desde)).toBe('2026-01-01');
  });

  it('EL BORDE DEL EJERCICIO: a las 22:00 del día de cierre, ese ejercicio todavía no cerró', () => {
    // Cierra el 31/07. A las 22:00 de ese día el ejercicio 2025-2026 está en
    // su última hora: el último CERRADO sigue siendo el anterior.
    const p = periodoDeEjercicio(7, nocheDel31deJulio);
    expect(iso(p.hasta)).toBe('2025-08-01');
  });
});
