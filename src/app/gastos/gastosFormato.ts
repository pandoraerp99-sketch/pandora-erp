/**
 * Vocabulario compartido de /gastos: categorías, medios de pago y formatos.
 *
 * Vive aparte para que el alta (`CargarGasto.tsx`) y el libro
 * (`GastosClient.tsx`) usen EXACTAMENTE las mismas listas: dos copias de las
 * categorías o de los medios terminan divergiendo, y el medio que falte en
 * una pantalla no se puede elegir (ya pasó con `cuenta_corriente`).
 */
import { diaDelComercio } from '@/lib/domain/fecha-comercio';

/** Categorías tomadas del pedido de la contadora (schema `expenses`). */
export const CATEGORIAS: Array<{ valor: string; label: string }> = [
  { valor: 'alquiler', label: 'Alquiler' },
  { valor: 'seguros', label: 'Seguros' },
  { valor: 'servicios', label: 'Servicios' },
  { valor: 'impuestos_y_tasas', label: 'Impuestos y tasas' },
  { valor: 'honorarios', label: 'Honorarios' },
  { valor: 'mercaderia', label: 'Mercadería' },
  { valor: 'otros', label: 'Otros' },
];
export const catLabel = (v: string) => CATEGORIAS.find((c) => c.valor === v)?.label ?? v;

/**
 * El color va por CLASE, no inline.
 *
 * La primera versión pasaba el hex por `style`, y un color inline no puede
 * tener variante de tema: en oscuro quedaban las siete pills con texto oscuro
 * sobre fondo oscuro, ilegibles (medido, no supuesto). Las variables viven en
 * `gastosCss.ts`, con su bloque para cada tema.
 */
export const catClase = (v: string) =>
  CATEGORIAS.some((c) => c.valor === v) ? `cat-${v}` : 'cat-otros';

/**
 * Esta lista NO deriva de `EXPENSE_PAYMENT_METHODS` a propósito: el const del
 * servidor es el contrato de la base, y la pantalla necesita además la etiqueta
 * en castellano y el orden en que se ofrece. Lo que sí hay que sostener a mano
 * es que ningún medio del servidor quede sin ofrecerse — que es exactamente lo
 * que pasó con `cuenta_corriente` entre el 17 y el 18 de septiembre: el libro
 * de proveedores estaba entero y la deuda no podía nacer desde ninguna pantalla.
 */
export const MEDIOS: Array<{ valor: string; label: string }> = [
  { valor: 'efectivo', label: 'Efectivo' },
  { valor: 'transferencia', label: 'Transferencia' },
  { valor: 'debito', label: 'Débito' },
  { valor: 'credito', label: 'Crédito' },
  { valor: 'cuenta_corriente', label: 'A cuenta corriente (queda debiendo)' },
  { valor: 'otro', label: 'Otro' },
];
export const medioLabel = (v: string) => MEDIOS.find((m) => m.valor === v)?.label ?? v;

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});
/** Sólo presentación: el cálculo ya vino hecho del servidor, en Decimal. */
export const plata = (v: string) => PESOS.format(Number(v));

/** 'AAAA-MM-DD' → '12 sep'. Sin `new Date()`: parsear la fecha suelta la corre
 *  un día para atrás en cualquier huso al oeste de UTC (el nuestro lo es). */
export function fechaCorta(iso: string): string {
  const MESES = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ];
  const [, m, d] = iso.split('-');
  const mes = MESES[Number(m) - 1] ?? '';
  return `${Number(d)} ${mes}`;
}

/**
 * Hoy en 'AAAA-MM-DD' del COMERCIO, para el valor por defecto del formulario.
 * No el del reloj que renderiza: en el server es UTC, y a las 22:00 proponía
 * mañana — una fecha que el service rechaza por futura en una compra.
 */
export function hoyLocal(): string {
  return diaDelComercio();
}
