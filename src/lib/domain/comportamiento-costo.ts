/**
 * Fijo / variable / mixto — reglas puras (migration 0045).
 *
 * Es una pregunta de GESTIÓN, distinta de la categoría contable: "si vendo el
 * doble, ¿este costo sube?". Fuente del criterio: OpenStax, Principles of
 * Managerial Accounting, 2.2 (fijo: no cambia en el total en el corto plazo;
 * variable: proporcional a la actividad; mixto: tiene las dos partes).
 *
 * Puro y sin `env`: lo usa también la pantalla para el valor por defecto.
 */
import type { ExpenseCategory } from '../db/schema/expenses.js';

export const COMPORTAMIENTOS = ['fijo', 'variable', 'mixto'] as const;
export type Comportamiento = (typeof COMPORTAMIENTOS)[number];

/**
 * Valor por defecto por categoría. `null` = no hay uno razonable y se elige
 * al cargar:
 * - impuestos_y_tasas mezcla IIBB (variable: porcentaje de lo vendido) con
 *   tasas municipales (fijas). Cómo informarlos es pregunta para la contadora.
 * - otros: por definición, no se sabe.
 * La mercadería NO se clasifica: no es un gasto del mes, es una compra que va
 * al stock y se vuelve costo recién cuando se vende.
 */
export const COMPORTAMIENTO_POR_CATEGORIA: Record<ExpenseCategory, Comportamiento | null> = {
  alquiler: 'fijo',
  seguros: 'fijo',
  honorarios: 'fijo',
  servicios: 'mixto',
  impuestos_y_tasas: null,
  otros: null,
  mercaderia: null,
};

export function seClasifica(categoria: string): boolean {
  return categoria !== 'mercaderia';
}

/** El que vale: el elegido explícitamente, o el de la categoría. */
export function comportamientoEfectivo(
  categoria: string,
  explicito: string | null
): Comportamiento | null {
  if (!seClasifica(categoria)) return null;
  if (explicito && (COMPORTAMIENTOS as readonly string[]).includes(explicito)) {
    return explicito as Comportamiento;
  }
  return COMPORTAMIENTO_POR_CATEGORIA[categoria as ExpenseCategory] ?? null;
}

export const COMPORTAMIENTO_TEXTO: Record<Comportamiento, string> = {
  fijo: 'Fijo',
  variable: 'Variable',
  mixto: 'Mixto',
};
