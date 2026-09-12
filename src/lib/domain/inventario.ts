/**
 * Valuación del inventario de bienes de cambio — la cuenta, sin DB.
 *
 * Ítem 8 del pedido de la contadora: *"Inventario de bienes de cambio
 * VALORIZADO al cierre (fecha adq., detalle, importe de compra)"*.
 *
 * ── EL MÉTODO NO LO ELEGIMOS NOSOTROS ─────────────────────────────────────
 * Se implementa **PEPS** (primero entrado, primero salido): lo que queda en
 * stock son las compras más recientes. Bajo ese supuesto la valuación se
 * deriva caminando las compras hacia atrás desde la fecha de cierre, sin
 * necesidad de guardar capas — la misma razón por la que `expense_items` no
 * tiene `remaining_qty`.
 *
 * 🔴 Cuál método corresponde es **decisión del estudio**, no una consecuencia
 * técnica (CLAUDE.md §22.6). Por eso `METODO_VALUACION` se exporta y la salida
 * lo DECLARA: un total sin método no se puede auditar. Cambiarlo es cambiar
 * esta función y nada más.
 *
 * ── LO QUE NO SE INVENTA ──────────────────────────────────────────────────
 * Si las compras registradas no cubren el stock, las unidades que sobran NO se
 * valorizan como si se hubieran comprado: quedan en `sin_compra_qty`, al costo
 * DECLARADO (`products.cost`) y marcadas como tales. Siempre van a existir —
 * el stock con el que el comercio arrancó, los ajustes de entrada, lo que
 * regularizó la migration 0035 — así que esconderlas dentro del total sería
 * darle a la contadora un número prolijo que no puede cotejar contra ningún
 * papel.
 *
 * Todo con Decimal: es plata (CLAUDE.md §9.8).
 */
import Decimal from 'decimal.js';

/** El supuesto bajo el que se valoriza. Va en la pantalla y en el CSV. */
export const METODO_VALUACION = 'PEPS' as const;

/**
 * La zona del comercio. Duplicada a propósito de `panel.report.ts`: este
 * módulo es puro y no importa nada de la capa de lectura.
 */
const TZ_COMERCIO = 'America/Argentina/Ushuaia';

/**
 * El día al que se saca la foto del inventario: el último del período, pero
 * **acotado a hoy**.
 *
 * ── POR QUÉ ACOTADO ───────────────────────────────────────────────────────
 * Valorizar el futuro sería mostrar el stock de hoy con la etiqueta del 30 de
 * septiembre. Para el grano "ejercicio" —el que le importa al estudio— el
 * período ya cerró y el tope no se usa nunca.
 *
 * ── POR QUÉ NO ALCANZA CON `toISOString()` ────────────────────────────────
 * `toISOString()` da el día en UTC. Ushuaia está tres horas atrás: a las 21:00
 * del 12/09, UTC ya está en el 13/09, y la pantalla diría "al 13 de
 * septiembre" mostrando el stock de hoy. El día se lee desde la zona del
 * comercio, igual que toda otra frontera de tiempo del sistema.
 *
 * `hasta` es EXCLUSIVE y siempre medianoche UTC (ver `periodoDe`), así que de
 * ese lado el día se lee en UTC — restarle 24 h da exactamente el último día
 * del período, sin zona de por medio.
 */
export function fechaDeLaFoto(hasta: Date, ahora: Date = new Date()): string {
  const finPeriodo = new Date(hasta.getTime() - 86_400_000);
  const diaFin = finPeriodo.toISOString().slice(0, 10);
  // 'en-CA' formatea como AAAA-MM-DD, que es lo que la query espera.
  const diaHoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_COMERCIO,
  }).format(ahora);
  // Comparar los strings alcanza: AAAA-MM-DD ordena lexicográficamente.
  return diaFin < diaHoy ? diaFin : diaHoy;
}

export interface CompraDelProducto {
  /** 'AAAA-MM-DD' — la fecha del comprobante, que es la de adquisición. */
  fecha: string;
  qty: string;
  /** Costo unitario NETO de IVA recuperable (ver `expense_items`). */
  unit_cost: string;
  /** Para que cada lote se pueda rastrear hasta su papel. */
  comprobante: string | null;
}

/** Una capa de stock que SÍ tiene comprobante detrás. */
export interface LoteValorizado {
  fecha: string;
  qty: string;
  unit_cost: string;
  importe: string;
  comprobante: string | null;
}

export interface ValuacionProducto {
  lotes: LoteValorizado[];
  /** Unidades que ninguna compra registrada explica. */
  sin_compra_qty: string;
  /** Valorizadas al costo DECLARADO. `null` si no hay costo cargado. */
  sin_compra_total: string | null;
  /** Unidades respaldadas por un comprobante. Con Decimal: sumar `qty` con
   *  `Number` acumula error de float y 12 unidades salen 12.000000000000002. */
  con_compra_qty: string;
  con_compra_total: string;
  /**
   * Lo que SÍ se pudo valorizar de este producto.
   *
   * Cuando faltan costos, esto es un total **parcial** y `sin_valorizar_qty`
   * dice cuánto quedó afuera. No se devuelve `null`: un producto sin costo no
   * puede dejar en "no sé" al inventario entero — la contadora necesita el
   * número de lo que sí se sabe, con la exclusión imposible de pasar por alto
   * al lado. Mismo criterio que los tres estados de Rentabilidad.
   */
  total: string;
  /** Unidades que no se pudieron valorizar (sin compra y sin costo). */
  sin_valorizar_qty: string;
  /** No tenía stock a la fecha: no entra al inventario. */
  vacio: boolean;
  /** Hay unidades sin compra y sin costo declarado. */
  sin_costo: boolean;
  /** El libro dice una cantidad negativa. No debería pasar nunca. */
  anomalia: boolean;
}

export interface EntradaValuacion {
  /** Stock a la fecha de cierre, reconstruido desde el libro. */
  cantidad: string;
  /** `products.cost` — declarado, no verificable contra un comprobante. */
  costoDeclarado: string | null;
  compras: CompraDelProducto[];
  /** 'AAAA-MM-DD'. Las compras posteriores no existían todavía. */
  fechaCierre: string;
}

const CERO = '0.0000';

export function valorizarProducto(entrada: EntradaValuacion): ValuacionProducto {
  const cantidad = new Decimal(entrada.cantidad);

  if (cantidad.isNegative()) {
    // Fail loud. Una cantidad negativa valorizada al costo entraría al
    // inventario del estudio como plata en contra, y el anti-oversell dice que
    // esto no puede pasar: si pasó, hay algo roto que hay que mirar, no
    // maquillar.
    return {
      lotes: [],
      sin_compra_qty: cantidad.toFixed(4),
      sin_compra_total: null,
      con_compra_qty: CERO,
      con_compra_total: CERO,
      total: CERO,
      sin_valorizar_qty: cantidad.toFixed(4),
      vacio: false,
      sin_costo: false,
      anomalia: true,
    };
  }

  if (cantidad.isZero()) {
    return {
      lotes: [],
      sin_compra_qty: CERO,
      sin_compra_total: CERO,
      con_compra_qty: CERO,
      con_compra_total: CERO,
      total: CERO,
      sin_valorizar_qty: CERO,
      vacio: true,
      sin_costo: false,
      anomalia: false,
    };
  }

  // Sólo las compras que ya habían ocurrido al cierre, de la más nueva a la
  // más vieja. El filtro por fecha es el que evita valorizar el stock de julio
  // con el precio de septiembre — y como las fechas son 'AAAA-MM-DD', comparar
  // como texto es comparar cronológicamente.
  const disponibles = entrada.compras
    .filter((c) => c.fecha <= entrada.fechaCierre)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

  const lotes: LoteValorizado[] = [];
  let porCubrir = cantidad;
  let conCompra = new Decimal(0);

  for (const c of disponibles) {
    if (porCubrir.lte(0)) break;
    const deEsta = Decimal.min(porCubrir, new Decimal(c.qty));
    if (deEsta.lte(0)) continue;
    const importe = deEsta.times(c.unit_cost);
    lotes.push({
      fecha: c.fecha,
      qty: deEsta.toFixed(4),
      unit_cost: new Decimal(c.unit_cost).toFixed(4),
      importe: importe.toFixed(4),
      comprobante: c.comprobante,
    });
    conCompra = conCompra.plus(importe);
    porCubrir = porCubrir.minus(deEsta);
  }

  const sinCompra = porCubrir;
  const hayCosto = entrada.costoDeclarado !== null;
  const sinCostoReal = sinCompra.gt(0) && !hayCosto;

  const sinCompraTotal = sinCostoReal
    ? null
    : sinCompra.times(entrada.costoDeclarado ?? '0').toFixed(4);

  return {
    lotes,
    sin_compra_qty: sinCompra.toFixed(4),
    sin_compra_total: sinCompraTotal,
    con_compra_qty: cantidad.minus(sinCompra).toFixed(4),
    con_compra_total: conCompra.toFixed(4),
    // El total suma lo que se pudo valorizar. Si faltó un costo, las unidades
    // afectadas van en `sin_valorizar_qty` y NO entran acá: el número queda
    // corto a propósito, y quien lo muestre tiene que decir cuánto falta.
    total: conCompra.plus(sinCompraTotal ?? 0).toFixed(4),
    sin_valorizar_qty: sinCostoReal ? sinCompra.toFixed(4) : CERO,
    vacio: false,
    sin_costo: sinCostoReal,
    anomalia: false,
  };
}
