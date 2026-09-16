/**
 * Saldo de caja a la fecha de cierre — ítem 1 del pedido de la contadora.
 *
 * Textual del pedido: *"Saldo de caja al cierre del ejercicio"*. Hoy en el papel
 * que le mandan está escrito **a mano**: "$349.000".
 *
 * ── ES PLATA CONTADA, NO PLATA CALCULADA ──────────────────────────────────
 * El único número que este módulo emite es `final_amount`: el efectivo que
 * alguien **contó** al cerrar la caja. Para una sesión que quedó abierta se
 * podría calcular `inicial + movimientos`, y sería aritmética de Pandora
 * presentada como dinero contado. Un balance pide lo segundo. Por eso una caja
 * abierta sale **sin monto**: se muestra el hueco, no se rellena.
 *
 * ── ES EFECTIVO, Y HAY QUE DECIRLO ────────────────────────────────────────
 * `final_amount` es la línea de efectivo del arqueo. Lo cobrado con tarjeta o
 * QR no está en el cajón: es un crédito contra el banco o la billetera (ítem 3
 * del pedido, que Pandora no tiene). Quien muestre este total tiene que
 * aclararlo, o se lee como "toda la plata al cierre" y queda corto.
 *
 * ── SON N CAJAS, NO UNA ───────────────────────────────────────────────────
 * `cash_sessions` va por `(tenant, sale_point)`: puede haber varios puntos de
 * venta. Se toma **el último arqueo de cada punto** hasta la fecha y se suman,
 * con el desglose a la vista. Un número solo se volvería otra cosa en silencio
 * el día que el comercio abra una segunda caja.
 */
import Decimal from 'decimal.js';

/** El último arqueo de un punto de venta hasta la fecha de cierre. */
export interface ArqueoDePunto {
  punto: number;
  /** Día del arqueo en el calendario del comercio, 'AAAA-MM-DD'. */
  fecha: string;
  /** `final_amount`: el efectivo CONTADO al cerrar. */
  contado: string;
  /** El descuadre de ese cierre (puede ser negativo). */
  descuadre: string;
}

/** Una caja que, en el instante del cierre, estaba abierta: nunca se contó. */
export interface CajaAbierta {
  punto: number;
  /** Día en que se abrió. */
  desde: string;
  /** Día en que se cerró, si cerró DESPUÉS del cierre. `null` = sigue abierta. */
  cerroDespues: string | null;
}

/**
 * - `contado`   — todos los puntos se arquearon el mismo día del cierre.
 * - `anterior`  — el arqueo más fresco de algún punto es de antes. Se muestra
 *                 con su fecha: sigue siendo plata contada, pero de otro día.
 * - `sin_datos` — ningún punto tiene un cierre hasta esa fecha.
 */
export type EstadoCaja = 'contado' | 'anterior' | 'sin_datos';

export interface CajaAlCierre {
  /** La fecha pedida, 'AAAA-MM-DD'. */
  fecha: string;
  estado: EstadoCaja;
  /** Suma de lo contado en cada punto. `null` si `sin_datos`. */
  total: string | null;
  puntos: ArqueoDePunto[];
  /** Las que quedaron abiertas. Nunca llevan monto. */
  abiertas: CajaAbierta[];
}

export function armarCajaAlCierre(entrada: {
  /** 'AAAA-MM-DD' — el último día que entra. */
  fechaCierre: string;
  /** Un arqueo por punto de venta como máximo (el más reciente hasta la fecha). */
  arqueos: ArqueoDePunto[];
  abiertas: CajaAbierta[];
}): CajaAlCierre {
  const { fechaCierre, arqueos, abiertas } = entrada;

  // Dos arqueos del mismo punto querría decir que la consulta trajo más de un
  // cierre por caja, y el total los sumaría dos veces dando un número prolijo y
  // mal. Es un error de programación, no un dato raro: se rompe acá.
  const vistos = new Set<number>();
  for (const a of arqueos) {
    if (vistos.has(a.punto)) {
      throw new Error(
        `dos arqueos para el punto de venta ${a.punto}: se esperaba el último de cada uno`
      );
    }
    vistos.add(a.punto);
  }

  if (arqueos.length === 0) {
    return { fecha: fechaCierre, estado: 'sin_datos', total: null, puntos: [], abiertas };
  }

  const total = arqueos.reduce(
    (acc, a) => acc.plus(new Decimal(a.contado)),
    new Decimal(0)
  );
  const todosDelDia = arqueos.every((a) => a.fecha === fechaCierre);

  return {
    fecha: fechaCierre,
    estado: todosDelDia ? 'contado' : 'anterior',
    total: total.toFixed(4),
    // Orden estable por punto: la pantalla y el CSV tienen que listar lo mismo.
    puntos: [...arqueos].sort((a, b) => a.punto - b.punto),
    abiertas: [...abiertas].sort((a, b) => a.punto - b.punto),
  };
}
