/**
 * Proyección de cierre de mes — capa pura.
 *
 * Lo que cuidan estos tests, en orden de peligro:
 *   1. La compuerta: con pocos días del mes NO hay número.
 *   2. Hoy no entra en la base (un día a medio andar arrastra el promedio).
 *   3. La base no puede ser más larga que la historia del comercio.
 *   4. Un día cerrado cuenta como día transcurrido, no se saltea.
 *   5. La proyección contiene a lo que ya pasó, no lo reemplaza.
 */
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  proyectarCierre,
  diasDelMes,
  DIAS_MINIMOS,
  type DiaSerie,
} from '@/lib/reporting/cierre-de-mes';

/** Días consecutivos 'AAAA-MM-DD' terminando en `hasta`, con los totales dados. */
function serie(hasta: string, totales: string[]): DiaSerie[] {
  const fin = Date.UTC(
    Number(hasta.slice(0, 4)),
    Number(hasta.slice(5, 7)) - 1,
    Number(hasta.slice(8, 10))
  );
  return totales.map((total, i) => {
    const d = new Date(fin - (totales.length - 1 - i) * 86400000);
    return { dia: d.toISOString().slice(0, 10), total };
  });
}

/** N días de `monto` terminando en `hasta`. */
const parejo = (hasta: string, n: number, monto: string) =>
  serie(hasta, Array(n).fill(monto));

describe('diasDelMes', () => {
  it('conoce los meses de 30 y 31', () => {
    expect(diasDelMes('2026-09-11')).toBe(30);
    expect(diasDelMes('2026-10-01')).toBe(31);
  });

  it('febrero común y febrero bisiesto', () => {
    expect(diasDelMes('2026-02-15')).toBe(28);
    expect(diasDelMes('2028-02-15')).toBe(29);
  });

  it('diciembre no se pasa de año', () => {
    expect(diasDelMes('2026-12-31')).toBe(31);
  });
});

describe('la compuerta', () => {
  it('con menos de 7 días terminados NO hay número', () => {
    // Estamos el día 5: hay 4 días terminados (1 al 4).
    const p = proyectarCierre(parejo('2026-09-05', 10, '1000'), '2026-09-05', 400);
    expect(p.estado).toBe('sin_base');
    expect(p.proyectado).toBeNull();
    expect(p.promedioDiario).toBeNull();
  });

  it('dice cuántos días faltan para poder proyectar', () => {
    const p = proyectarCierre(parejo('2026-09-05', 10, '1000'), '2026-09-05', 400);
    expect(p.diasBase).toBe(4);
    expect(p.diasParaPoder).toBe(DIAS_MINIMOS - 4);
  });

  it('el día 1 del mes no tiene nada terminado', () => {
    const p = proyectarCierre(parejo('2026-09-01', 30, '1000'), '2026-09-01', 400);
    expect(p.diasBase).toBe(0);
    expect(p.diasParaPoder).toBe(7);
    expect(p.estado).toBe('sin_base');
  });

  it('aun sin número, lo facturado en los días terminados SÍ se sabe', () => {
    const p = proyectarCierre(parejo('2026-09-05', 10, '1000'), '2026-09-05', 400);
    expect(p.acumuladoCompletos).toBe('4000.0000');
  });

  it('justo en 7 días terminados ya proyecta', () => {
    const p = proyectarCierre(parejo('2026-09-08', 20, '1000'), '2026-09-08', 400);
    expect(p.diasBase).toBe(7);
    expect(p.estado).toBe('proyectada');
  });
});

describe('hoy no entra en la base', () => {
  it('un día de hoy flojo NO baja el promedio', () => {
    // 10 días terminados a 1000 y hoy (día 11) apenas 50: el promedio tiene que
    // seguir siendo 1000. Si hoy entrara, daría 913 y la proyección caería sola
    // a medida que avanza la mañana.
    const s = serie('2026-09-11', [...Array(10).fill('1000'), '50']);
    const p = proyectarCierre(s, '2026-09-11', 400);
    expect(p.diasBase).toBe(10);
    expect(p.promedioDiario).toBe('1000.0000');
  });

  it('hoy cuenta como día que FALTA', () => {
    const p = proyectarCierre(parejo('2026-09-11', 20, '1000'), '2026-09-11', 400);
    // Septiembre tiene 30 días; terminaron 10 (el 1 al 10) → faltan 20, con hoy.
    expect(p.diasQueFaltan).toBe(20);
    expect(p.diasBase + p.diasQueFaltan).toBe(p.diasDelMes);
  });
});

describe('la base no puede ser más larga que la historia', () => {
  it('un comercio que abrió hace 3 días ni siquiera llega a la base', () => {
    // Días 1..7 en cero porque el local no existía; 8, 9 y 10 a 1000.
    // La historia topea la base en 3, y 3 < 7 → la compuerta gana. Es lo
    // correcto: un local con tres días de vida no tiene cómo saber su mes.
    const s = serie('2026-09-11', [
      ...Array(7).fill('0'), '1000', '1000', '1000', '400',
    ]);
    const p = proyectarCierre(s, '2026-09-11', 3);
    expect(p.diasBase).toBe(3);
    expect(p.estado).toBe('sin_base');
    expect(p.proyectado).toBeNull();
  });

  it('con 8 días de historia y 14 del mes, promedia sobre los últimos 8', () => {
    // Los primeros 6 días del mes en cero (no existía), después 8 a 1000.
    const s = serie('2026-09-15', [
      ...Array(6).fill('0'), ...Array(8).fill('1000'), '400',
    ]);
    const p = proyectarCierre(s, '2026-09-15', 8);
    expect(p.diasBase).toBe(8);
    expect(p.promedioDiario).toBe('1000.0000');
  });

  it('NO le atribuye facturación a los días en que el local no existía', () => {
    // Éste es el único escenario donde `acumulado + ritmo × faltan` y el
    // run-rate puro `ritmo × díasDelMes` dan distinto, y por eso existe:
    // el local abrió el día 7, así que los días 1 a 6 facturaron CERO de
    // verdad. Multiplicar el ritmo sano por los 30 días del mes inventaría
    // 6 días de ventas que nunca pasaron.
    const s = serie('2026-09-15', [
      ...Array(6).fill('0'), ...Array(8).fill('1000'), '400',
    ]);
    const p = proyectarCierre(s, '2026-09-15', 8);
    // 8.000 reales + 16 días que faltan × 1.000 = 24.000.
    expect(p.acumuladoCompletos).toBe('8000.0000');
    expect(p.diasQueFaltan).toBe(16);
    expect(p.proyectado).toBe('24000.0000');
    // El run-rate puro daría 30.000: 6.000 de más, inventados.
    expect(p.proyectado).not.toBe('30000.0000');
  });

  it('sin ese tope el promedio quedaría casi a la mitad', () => {
    const s = serie('2026-09-15', [
      ...Array(6).fill('0'), ...Array(8).fill('1000'), '400',
    ]);
    // Con historia larga promedia sobre los 14 días (6 de ellos en cero).
    const p = proyectarCierre(s, '2026-09-15', 400);
    expect(p.diasBase).toBe(14);
    expect(p.promedioDiario).toBe('571.4286');
  });

  it('con 3 días de historia y menos de 7 del mes, no proyecta', () => {
    const s = serie('2026-09-11', [
      ...Array(8).fill('0'), '1000', '1000', '400',
    ]);
    const p = proyectarCierre(s, '2026-09-11', 2);
    expect(p.estado).toBe('sin_base');
    expect(p.diasBase).toBe(2);
  });
});

describe('un día cerrado es un día transcurrido', () => {
  it('los domingos en cero cuentan en el denominador', () => {
    // 8 días: 6 a 1200 y 2 domingos en 0 → promedio 900, no 1200.
    const s = serie('2026-09-09', [
      '1200', '1200', '0', '1200', '1200', '1200', '0', '1200', '999',
    ]);
    const p = proyectarCierre(s, '2026-09-09', 400);
    expect(p.diasBase).toBe(8);
    expect(p.promedioDiario).toBe('900.0000');
  });
});

describe('la proyección contiene a lo que ya pasó', () => {
  it('proyectado = acumulado de los terminados + ritmo × lo que falta', () => {
    const p = proyectarCierre(parejo('2026-09-11', 20, '1000'), '2026-09-11', 400);
    // 10 días × 1000 = 10.000 acumulado; faltan 20 días × 1000 = 20.000.
    expect(p.acumuladoCompletos).toBe('10000.0000');
    expect(p.proyectado).toBe('30000.0000');
  });

  it('nunca proyecta MENOS de lo que ya se facturó', () => {
    const p = proyectarCierre(parejo('2026-09-11', 20, '1000'), '2026-09-11', 400);
    expect(new Decimal(p.proyectado!).gte(p.acumuladoCompletos)).toBe(true);
  });

  it('reconcilia: (proyectado − acumulado) / diasQueFaltan = promedio', () => {
    const s = serie('2026-09-11', [
      '800', '1500', '0', '2200', '900', '1100', '0', '1700', '1300', '500', '77',
    ]);
    const p = proyectarCierre(s, '2026-09-11', 400);
    const porDia = new Decimal(p.proyectado!)
      .minus(p.acumuladoCompletos)
      .dividedBy(p.diasQueFaltan);
    expect(porDia.toFixed(4)).toBe(p.promedioDiario);
  });
});

describe('sólo mira el mes corriente', () => {
  it('los días del mes pasado NO entran ni en la base ni en el acumulado', () => {
    // 20 días terminando el 10 de septiembre: los primeros 11 son de agosto.
    const s = serie('2026-09-10', Array(20).fill('1000'));
    const p = proyectarCierre(s, '2026-09-10', 400);
    expect(p.diasBase).toBe(9); // del 1 al 9 de septiembre
    expect(p.acumuladoCompletos).toBe('9000.0000');
  });

  it('un mes de 31 días proyecta sobre 31', () => {
    const p = proyectarCierre(parejo('2026-10-11', 31, '1000'), '2026-10-11', 400);
    expect(p.diasDelMes).toBe(31);
    expect(p.diasBase).toBe(10);
    expect(p.diasQueFaltan).toBe(21);
  });
});

describe('bordes que no pueden explotar', () => {
  it('sin ventas en todo el mes proyecta cero, no NaN', () => {
    const p = proyectarCierre(parejo('2026-09-11', 20, '0'), '2026-09-11', 400);
    expect(p.estado).toBe('proyectada');
    expect(p.promedioDiario).toBe('0.0000');
    expect(p.proyectado).toBe('0.0000');
  });

  it('historia en cero (nunca vendió) no proyecta', () => {
    const p = proyectarCierre(parejo('2026-09-11', 20, '0'), '2026-09-11', 0);
    expect(p.estado).toBe('sin_base');
    expect(p.diasBase).toBe(0);
  });

  it('el último día del mes: no quedan días por delante', () => {
    const p = proyectarCierre(parejo('2026-09-30', 30, '1000'), '2026-09-30', 400);
    expect(p.diasQueFaltan).toBe(1); // hoy mismo
    expect(p.diasBase).toBe(29);
  });
});
