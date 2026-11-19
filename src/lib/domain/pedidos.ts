/**
 * Pedidos — reglas puras (sin DB). ADR-0029.
 *
 * Lo usan el service (que decide) y la pantalla (que sólo previsualiza). Por
 * eso NO importa nada que arrastre `env`: usa decimal.js directo, con el modo
 * de redondeo escrito en cada operación en vez de depender de una config
 * global que el bundle del cliente no tiene.
 */
import Decimal from 'decimal.js';
import type { OrderStatus, OrderPaymentKind } from '../db/schema/orders.js';

/** Redondeo del proyecto (ADR-0005): HALF_EVEN, a centavos. */
const aCentavos = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

export interface LineaPedido {
  quantity: string;
  unit_price: string;
}

/** cantidad × precio, redondeado a centavos. Una vez por línea (PER_LINE). */
export function totalDeLinea(l: LineaPedido): Decimal {
  return aCentavos(new Decimal(l.quantity).times(new Decimal(l.unit_price)));
}

/** Suma de las líneas YA redondeadas: así el total cierra con el detalle. */
export function totalDelPedido(lineas: readonly LineaPedido[]): Decimal {
  return lineas.reduce((acc, l) => acc.plus(totalDeLinea(l)), new Decimal(0));
}

/**
 * Transiciones permitidas. Hacia adelante, más cancelar mientras está vivo.
 *
 * `entregado` y `cancelado` son terminales. Volver de `listo` a
 * `en_preparacion` se permite: pasa ("avisé que estaba listo y faltaba una
 * pieza") y no toca plata.
 */
const TRANSICIONES: Record<OrderStatus, readonly OrderStatus[]> = {
  tomado: ['en_preparacion', 'listo', 'entregado', 'cancelado'],
  en_preparacion: ['listo', 'entregado', 'cancelado'],
  listo: ['en_preparacion', 'entregado', 'cancelado'],
  entregado: [],
  cancelado: [],
};

export function puedePasar(desde: OrderStatus, hacia: OrderStatus): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

export const ESTADOS_VIVOS: readonly OrderStatus[] = ['tomado', 'en_preparacion', 'listo'];

export function estaVivo(s: OrderStatus): boolean {
  return ESTADOS_VIVOS.includes(s);
}

/**
 * Qué tipo de cobro es. Se deriva, no se elige: el primero es la seña, el
 * que deja el saldo en cero es el saldo, el resto es a cuenta.
 */
export function tipoDeCobro(
  cobradoAntes: Decimal,
  importe: Decimal,
  total: Decimal
): OrderPaymentKind {
  if (cobradoAntes.isZero()) {
    return importe.eq(total) ? 'saldo' : 'sena';
  }
  return cobradoAntes.plus(importe).eq(total) ? 'saldo' : 'parcial';
}

export interface EstadoDerivado {
  /** Tiene al menos un cobro. */
  conSena: boolean;
  /** Lo cobrado cubre el total (y el total es mayor a cero). */
  saldado: boolean;
  /** Pasó la fecha de retiro y sigue vivo. */
  vencido: boolean;
  /** Retira hoy y sigue vivo. */
  retiraHoy: boolean;
  saldo: Decimal;
}

/**
 * `hoy` es el día DEL COMERCIO ('AAAA-MM-DD', ver domain/fecha-comercio). Se
 * recibe de afuera para que la regla no dependa del reloj ni del huso de quien
 * la ejecuta.
 */
export function estadoDerivado(p: {
  status: OrderStatus;
  total: string;
  cobrado: string;
  pickup_date: string | null;
  hoy: string;
}): EstadoDerivado {
  const total = new Decimal(p.total);
  const cobrado = new Decimal(p.cobrado);
  const vivo = estaVivo(p.status);
  return {
    conSena: cobrado.gt(0),
    saldado: total.gt(0) && cobrado.gte(total),
    vencido: vivo && p.pickup_date !== null && p.pickup_date < p.hoy,
    retiraHoy: vivo && p.pickup_date === p.hoy,
    saldo: Decimal.max(total.minus(cobrado), 0),
  };
}
