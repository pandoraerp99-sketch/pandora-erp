/**
 * Ajuste manual de stock — la regla, pura y sin imports de DB.
 *
 * La importan el service (para escribir el movimiento) y la pantalla (para
 * dibujar los botones de motivo). Que sea el MISMO catálogo es lo que impide que
 * la pantalla ofrezca un motivo que el libro rechaza, o al revés.
 *
 * ── MERMA Y CORRECCIÓN SON COSAS DISTINTAS ────────────────────────────────
 * Una merma es mercadería que se perdió: rotura, vencimiento, robo. Sólo resta,
 * y queda como `type = 'loss'`. Una corrección es el número que estaba mal:
 * recuento, error de carga. Puede ir para cualquier lado, y queda como
 * `type = 'adjustment'`. El bloque de merma del Panel lee `loss`; si todo fuera
 * `adjustment` con texto libre, no podría separar una rotura de un recuento.
 *
 * El motivo exacto (rotura / vencimiento / robo) va además en su propia columna
 * (`stock_movements.motivo`, migration 0038): es la distinción que dice "hay un
 * problema de robo", y es un dato con reloj — lo que se cargue sin él no se
 * puede reclasificar después.
 *
 * Decisiones: RESEARCH-BRIEF-ajuste-de-stock.md §5.
 */
import Decimal from 'decimal.js';

export const MOTIVOS_AJUSTE = {
  rotura: { label: 'Rotura', grupo: 'merma', type: 'loss', detalleObligatorio: false },
  vencimiento: { label: 'Vencimiento', grupo: 'merma', type: 'loss', detalleObligatorio: false },
  robo: { label: 'Robo / faltante', grupo: 'merma', type: 'loss', detalleObligatorio: false },
  recuento: { label: 'Recuento', grupo: 'correccion', type: 'adjustment', detalleObligatorio: false },
  error_carga: { label: 'Error de carga', grupo: 'correccion', type: 'adjustment', detalleObligatorio: false },
  otro: { label: 'Otro', grupo: 'correccion', type: 'adjustment', detalleObligatorio: true },
} as const;

export type MotivoAjuste = keyof typeof MOTIVOS_AJUSTE;

/** Los de merma, en el orden en que se muestran. La DB repite la lista en su CHECK. */
export const MOTIVOS_MERMA = ['rotura', 'vencimiento', 'robo'] as const satisfies readonly MotivoAjuste[];
/** Los de corrección, en el orden en que se muestran. */
export const MOTIVOS_CORRECCION = ['recuento', 'error_carga', 'otro'] as const satisfies readonly MotivoAjuste[];

export class AjusteInvalidoError extends Error {
  constructor(
    /** El campo del formulario al que se le muestra el mensaje. */
    public readonly campo: 'motivo' | 'delta' | 'detalle',
    message: string
  ) {
    super(message);
    this.name = 'AjusteInvalidoError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface PedidoDeAjuste {
  motivo: MotivoAjuste;
  /** Cuánto suma o resta: "-2", "4", "1.5". Nunca el stock final. */
  delta: string;
  detalle?: string;
}

export interface PlanDeAjuste {
  type: 'loss' | 'adjustment';
  direction: 'in' | 'out';
  /** Siempre positiva: el signo va en `direction`. */
  qty: string;
  motivo: MotivoAjuste;
  /** El texto que queda en el libro: "Rotura" o "Rotura · se cayó el pack". */
  reason: string;
}

const DETALLE_MAX = 200;

export function planDeAjuste(pedido: PedidoDeAjuste): PlanDeAjuste {
  if (!Object.hasOwn(MOTIVOS_AJUSTE, pedido.motivo)) {
    throw new AjusteInvalidoError('motivo', 'Elegí un motivo de la lista');
  }
  const motivo = MOTIVOS_AJUSTE[pedido.motivo];

  // Formato estricto antes de tocar Decimal: "1e3" es un número válido para
  // Decimal y un tipeo para una pantalla de stock.
  if (!/^-?\d+(\.\d{1,4})?$/.test(pedido.delta)) {
    throw new AjusteInvalidoError('delta', 'La cantidad tiene que ser un número (hasta 4 decimales)');
  }
  const delta = new Decimal(pedido.delta);
  if (delta.isZero()) {
    throw new AjusteInvalidoError('delta', 'Un ajuste de 0 no cambia nada');
  }
  if (motivo.grupo === 'merma' && delta.isPositive()) {
    throw new AjusteInvalidoError(
      'delta',
      `${motivo.label} es merma: sólo puede restar stock`
    );
  }

  const detalle = (pedido.detalle ?? '').trim();
  if (motivo.detalleObligatorio && detalle.length === 0) {
    throw new AjusteInvalidoError('detalle', 'Con "Otro" contá qué pasó');
  }
  if (detalle.length > DETALLE_MAX) {
    throw new AjusteInvalidoError('detalle', `El detalle no puede pasar de ${DETALLE_MAX} caracteres`);
  }

  return {
    type: motivo.type,
    direction: delta.isNegative() ? 'out' : 'in',
    qty: delta.abs().toString(),
    motivo: pedido.motivo,
    reason: detalle.length > 0 ? `${motivo.label} · ${detalle}` : motivo.label,
  };
}
