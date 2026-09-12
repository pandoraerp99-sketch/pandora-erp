/**
 * Valuación del inventario de bienes de cambio — la cuenta pura.
 *
 * Ítem 8 del pedido de la contadora: *"Inventario de bienes de cambio
 * VALORIZADO al cierre (fecha adq., detalle, importe de compra)"*.
 *
 * ── POR QUÉ ES UNA FUNCIÓN PURA ───────────────────────────────────────────
 * Toda la parte difícil de esto es aritmética con fechas y capas, y no
 * necesita DB para equivocarse. Separada, cada caso borde se prueba en
 * milisegundos y se puede leer como lo que es: una regla contable.
 *
 * ── LO QUE SE ESTÁ PROBANDO ───────────────────────────────────────────────
 * Bajo PEPS, las unidades que quedan son las de las compras MÁS RECIENTES,
 * caminadas hacia atrás desde la fecha de cierre. Lo que no llega a cubrirse
 * con compras registradas NO se inventa: queda aparte, como "sin compra
 * asociada", que es el estado que siempre va a existir (stock de apertura,
 * ajustes de entrada, lo regularizado por la migration 0035).
 */
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  valorizarProducto,
  METODO_VALUACION,
  fechaDeLaFoto,
} from '@/lib/domain/inventario';

const compra = (fecha: string, qty: string, costo: string) => ({
  fecha,
  qty,
  unit_cost: costo,
  comprobante: `F ${fecha}`,
});

describe('valorizarProducto — PEPS caminando hacia atrás', () => {
  it('declara el método, para que la salida no lo deje implícito', () => {
    // El método es decisión del estudio (CLAUDE.md §22.6). Pandora implementa
    // uno y lo DICE; un total sin método no se puede auditar.
    expect(METODO_VALUACION).toBe('PEPS');
  });

  it('cubre el stock con la compra más reciente', () => {
    const r = valorizarProducto({
      cantidad: '10',
      costoDeclarado: '900',
      compras: [compra('2026-05-10', '10', '1000'), compra('2026-01-05', '10', '800')],
      fechaCierre: '2026-07-31',
    });

    expect(r.lotes).toHaveLength(1);
    expect(r.lotes[0]?.qty).toBe('10.0000');
    expect(r.lotes[0]?.unit_cost).toBe('1000.0000');
    expect(r.lotes[0]?.fecha).toBe('2026-05-10');
    expect(r.sin_compra_qty).toBe('0.0000');
    expect(r.total).toBe('10000.0000');
  });

  it('🔴 una compra POSTERIOR al cierre no existe todavía', () => {
    // El caso que aparece SIEMPRE, porque el inventario se arma después del
    // cierre: en septiembre se compró, pero al 31/07 esas unidades no estaban.
    // Un `ORDER BY fecha DESC` sin filtro se lo come en silencio y valoriza el
    // stock viejo con el precio nuevo.
    const r = valorizarProducto({
      cantidad: '10',
      costoDeclarado: '900',
      compras: [compra('2026-09-02', '10', '1500'), compra('2026-05-10', '10', '1000')],
      fechaCierre: '2026-07-31',
    });

    expect(r.lotes).toHaveLength(1);
    expect(r.lotes[0]?.fecha).toBe('2026-05-10');
    expect(r.total).toBe('10000.0000');
  });

  it('la compra DEL DÍA del cierre sí entra', () => {
    const r = valorizarProducto({
      cantidad: '5',
      costoDeclarado: null,
      compras: [compra('2026-07-31', '5', '600')],
      fechaCierre: '2026-07-31',
    });
    expect(r.lotes).toHaveLength(1);
    expect(r.total).toBe('3000.0000');
  });

  it('parte con lote y parte sin compra asociada', () => {
    // 25 unidades y una compra de 8: las otras 17 vinieron de antes de que el
    // sistema llevara el libro. No se inventan — se muestran aparte.
    const r = valorizarProducto({
      cantidad: '25',
      costoDeclarado: '2000',
      compras: [compra('2026-07-20', '8', '2400')],
      fechaCierre: '2026-07-31',
    });

    expect(r.lotes).toHaveLength(1);
    expect(r.lotes[0]?.qty).toBe('8.0000');
    expect(r.sin_compra_qty).toBe('17.0000');
    // 8 × 2400 = 19.200 (comprobante) + 17 × 2000 = 34.000 (declarado)
    expect(r.con_compra_total).toBe('19200.0000');
    expect(r.sin_compra_total).toBe('34000.0000');
    expect(r.total).toBe('53200.0000');
  });

  it('varias compras se van consumiendo de la más nueva a la más vieja', () => {
    const r = valorizarProducto({
      cantidad: '15',
      costoDeclarado: '100',
      compras: [
        compra('2026-06-01', '10', '300'),
        compra('2026-03-01', '10', '200'),
        compra('2026-01-01', '10', '100'),
      ],
      fechaCierre: '2026-07-31',
    });

    // 10 de junio + 5 de marzo. La de enero no se toca.
    expect(r.lotes).toHaveLength(2);
    expect(r.lotes[0]?.qty).toBe('10.0000');
    expect(r.lotes[1]?.qty).toBe('5.0000');
    expect(r.lotes[1]?.fecha).toBe('2026-03-01');
    expect(r.sin_compra_qty).toBe('0.0000');
    // 10×300 + 5×200 = 4000
    expect(r.total).toBe('4000.0000');
  });

  it('🔴 sin costo declarado, las unidades quedan AFUERA del total (no en cero)', () => {
    // Cero es un número, y un número falso acá baja el inventario que va al
    // estudio sin que nada avise. Las unidades quedan contadas aparte, en
    // `sin_valorizar_qty`, para que quien muestre el total pueda decir cuánto
    // falta — el hueco se muestra al lado del número, no se rellena ni se come
    // el número (mismo criterio que los tres estados de Rentabilidad).
    const r = valorizarProducto({
      cantidad: '12',
      costoDeclarado: null,
      compras: [],
      fechaCierre: '2026-07-31',
    });

    expect(r.sin_compra_qty).toBe('12.0000');
    expect(r.sin_compra_total).toBeNull();
    expect(r.sin_valorizar_qty).toBe('12.0000');
    expect(r.total).toBe('0.0000');
    expect(r.sin_costo).toBe(true);
  });

  it('🔴 con costo faltante SÓLO para una parte, el resto sí se valoriza', () => {
    // 10 unidades: 4 respaldadas por comprobante y 6 sin compra ni costo. El
    // total dice 4×500=2000 y declara que 6 quedaron afuera. Devolver "no sé"
    // para todo tiraría un dato que sí se tiene.
    const r = valorizarProducto({
      cantidad: '10',
      costoDeclarado: null,
      compras: [compra('2026-06-01', '4', '500')],
      fechaCierre: '2026-07-31',
    });

    expect(r.con_compra_total).toBe('2000.0000');
    expect(r.total).toBe('2000.0000');
    expect(r.sin_valorizar_qty).toBe('6.0000');
    expect(r.sin_costo).toBe(true);
  });

  it('un producto sin stock al cierre no aparece en el inventario', () => {
    const r = valorizarProducto({
      cantidad: '0',
      costoDeclarado: '500',
      compras: [compra('2026-05-10', '10', '1000')],
      fechaCierre: '2026-07-31',
    });
    expect(r.lotes).toHaveLength(0);
    expect(r.sin_compra_qty).toBe('0.0000');
    expect(r.total).toBe('0.0000');
    expect(r.vacio).toBe(true);
  });

  it('🔴 stock negativo se reporta, no se esconde ni se valoriza', () => {
    // No debería pasar (hay anti-oversell), pero si el libro dice -3, el
    // inventario no puede mostrar una cantidad negativa valorizada al costo
    // como si fuera plata que el comercio tiene.
    const r = valorizarProducto({
      cantidad: '-3',
      costoDeclarado: '500',
      compras: [],
      fechaCierre: '2026-07-31',
    });
    expect(r.anomalia).toBe(true);
    // No suma nada al inventario: unidades negativas valorizadas al costo
    // serían plata en contra en el balance del estudio.
    expect(r.total).toBe('0.0000');
    expect(r.sin_valorizar_qty).toBe('-3.0000');
  });

  it('las cantidades decimales no se redondean (se vende por kilo)', () => {
    const r = valorizarProducto({
      cantidad: '2.5',
      costoDeclarado: null,
      compras: [compra('2026-06-01', '3', '1234.5678')],
      fechaCierre: '2026-07-31',
    });
    expect(r.lotes[0]?.qty).toBe('2.5000');
    // 2,5 × 1234,5678 = 3086,4195
    expect(r.total).toBe('3086.4195');
    // Y la cuenta se hace con Decimal, no con Number: 2.5 * 1234.5678 en
    // float da 3086.4194999999995.
    expect(new Decimal(r.total!).eq('3086.4195')).toBe(true);
  });

  it('si las compras cubren de más, sólo se toma lo que hay en stock', () => {
    // Se compraron 100 y quedan 10: no se valorizan las 100.
    const r = valorizarProducto({
      cantidad: '10',
      costoDeclarado: '50',
      compras: [compra('2026-06-01', '100', '70')],
      fechaCierre: '2026-07-31',
    });
    expect(r.lotes[0]?.qty).toBe('10.0000');
    expect(r.total).toBe('700.0000');
  });
});

/**
 * La fecha de la foto.
 *
 * El inventario se valoriza al último día del período PERO acotado a hoy: la
 * foto del futuro no existe. Y "hoy" es el día del COMERCIO, no el de UTC —
 * Ushuaia está tres horas atrás, así que entre las 21:00 y la medianoche el
 * reloj UTC ya pasó a mañana. Misma regla que el resto de los reportes: toda
 * frontera de tiempo se mira desde America/Argentina/Ushuaia.
 */
describe('fechaDeLaFoto — el día del comercio, no el de UTC', () => {
  // `periodo.hasta` es EXCLUSIVE y siempre medianoche UTC (ver periodoDe).
  const hasta = (iso: string) => new Date(iso + 'T00:00:00.000Z');

  it('a las 21:30 de Ushuaia la foto sigue siendo la de HOY, no la de mañana', () => {
    // 12/09 21:30 en Ushuaia (UTC-3) = 13/09 00:30 UTC.
    const ahora = new Date('2026-09-13T00:30:00.000Z');
    // Período de septiembre: termina el 01/10, así que el tope es hoy.
    expect(fechaDeLaFoto(hasta('2026-10-01'), ahora)).toBe('2026-09-12');
  });

  it('a media mañana los dos relojes dan el mismo día', () => {
    const ahora = new Date('2026-09-12T14:00:00.000Z'); // 11:00 en Ushuaia
    expect(fechaDeLaFoto(hasta('2026-10-01'), ahora)).toBe('2026-09-12');
  });

  it('si el período ya cerró, la foto es la del cierre y no la de hoy', () => {
    const ahora = new Date('2026-09-12T14:00:00.000Z');
    // Ejercicio cerrado el 31/07: `hasta` exclusive es el 01/08.
    expect(fechaDeLaFoto(hasta('2026-08-01'), ahora)).toBe('2026-07-31');
  });

  it('el último día del período, de noche, no salta al día siguiente', () => {
    // 30/09 22:00 Ushuaia = 01/10 01:00 UTC. El período de septiembre termina
    // ese mismo día: ni el tope ni el reloj pueden correrlo al 01/10.
    const ahora = new Date('2026-10-01T01:00:00.000Z');
    expect(fechaDeLaFoto(hasta('2026-10-01'), ahora)).toBe('2026-09-30');
  });
});
