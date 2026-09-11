/**
 * Margen bruto histórico — capa pura.
 *
 * **Qué margen es éste.** El que se calcula con el costo que el producto tenía
 * CUANDO SE VENDIÓ (`sale_items.unit_cost_snapshot`, migration 0031). No es el
 * "margen actual" de la pantalla de Productos, que compara el precio de hoy
 * contra el costo de hoy: ése sirve para decidir un precio, éste para saber
 * qué dejó un mes que ya pasó. Subir el precio de compra hoy NO puede cambiar
 * lo que dejó marzo, y eso es exactamente lo que esta separación protege.
 *
 * ── LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO ────────────────────────────────
 * Una línea sin costo cargado NO se puede convertir en margen. Ni en 0 (sería
 * decir que se vendió al costo), ni en 100% (sería decir que se regaló el
 * producto), ni descartándola en silencio — que es la peor de las tres, porque
 * el número sobreviviente parece completo y no lo es.
 *
 * La salida son TRES ESTADOS, no un número con asterisco:
 *   - `sin_datos`  → ninguna línea del período tiene costo. No hay número.
 *   - `parcial`    → hay número, y viene con qué porción de lo facturado cubre.
 *   - `completo`   → todas las líneas tienen costo.
 *
 * Mismo patrón que `sin_rotacion` en días de stock y que los días sin dato del
 * calendario: el hueco se muestra, no se rellena.
 *
 * ── EL DENOMINADOR ─────────────────────────────────────────────────────────
 * El porcentaje de margen se calcula SIEMPRE sobre lo facturado de las líneas
 * que tienen costo, nunca sobre el total del período. Si los pesos de margen
 * salieran de un subconjunto y el "facturado" del total, los dos números
 * quedarían uno al lado del otro sin reconciliar, y el lector no tendría cómo
 * notarlo. `coberturaPct` es lo que dice cuánto abarca ese subconjunto.
 */
import Decimal from 'decimal.js';

export type EstadoMargen = 'sin_datos' | 'parcial' | 'completo';

/** Lo que devuelve el SQL, crudo. Toda la plata en string (CLAUDE.md §9). */
export interface CrudoMargen {
  /** Σ `line_subtotal` de TODAS las líneas cerradas del período. */
  facturado_total: string;
  /** Σ `line_subtotal` sólo de las líneas que tienen costo congelado. */
  facturado_con_costo: string;
  /** Σ `unit_cost_snapshot × quantity` de esas mismas líneas. */
  costo: string;
  lineas_total: number;
  lineas_con_costo: number;
}

export interface Margen {
  estado: EstadoMargen;
  /** Plata. `null` si `estado === 'sin_datos'`. Puede ser NEGATIVO. */
  margen: string | null;
  /** Sobre `facturadoConCosto`, nunca sobre el total. `null` si no hay dato. */
  margenPct: Decimal | null;
  facturadoConCosto: string;
  costo: string;
  /** Lo facturado del período entero, tenga costo o no. Es el contexto. */
  facturadoTotal: string;
  /** Qué porción de lo FACTURADO tiene costo. `null` si no se facturó nada. */
  coberturaPct: Decimal | null;
  lineasSinCosto: number;
  lineasTotal: number;
}

/**
 * Divide sólo cuando el divisor sirve.
 *
 * Existe para que la división por cero no llegue nunca a pantalla: en JS
 * `1/0` es `Infinity`, que no falla, no avisa y se lee como un número enorme.
 * Es el mismo agujero que en días de stock se tapó con un `nullif` en SQL.
 */
function porcentaje(parte: Decimal, todo: Decimal): Decimal | null {
  if (todo.isZero() || todo.isNegative()) return null;
  return parte.dividedBy(todo).times(100);
}

export function calcularMargen(crudo: CrudoMargen): Margen {
  const facturadoTotal = new Decimal(crudo.facturado_total);
  const facturadoConCosto = new Decimal(crudo.facturado_con_costo);
  const costo = new Decimal(crudo.costo);

  const lineasSinCosto = crudo.lineas_total - crudo.lineas_con_costo;
  const cobertura = porcentaje(facturadoConCosto, facturadoTotal);

  // Sin una sola línea con costo no hay margen que mostrar. Se contesta ACÁ,
  // antes de cualquier división, igual que "stock <= 0" en días de stock.
  if (crudo.lineas_con_costo === 0) {
    return {
      estado: 'sin_datos',
      margen: null,
      margenPct: null,
      facturadoConCosto: '0',
      costo: '0',
      facturadoTotal: crudo.facturado_total,
      coberturaPct: cobertura,
      lineasSinCosto,
      lineasTotal: crudo.lineas_total,
    };
  }

  const margen = facturadoConCosto.minus(costo);

  return {
    estado: lineasSinCosto === 0 ? 'completo' : 'parcial',
    // `toFixed(4)` y no `toString()`: es plata y viaja como string con la
    // misma escala que la columna numeric(19,4).
    margen: margen.toFixed(4),
    margenPct: porcentaje(margen, facturadoConCosto),
    facturadoConCosto: facturadoConCosto.toFixed(4),
    costo: costo.toFixed(4),
    facturadoTotal: crudo.facturado_total,
    coberturaPct: cobertura,
    lineasSinCosto,
    lineasTotal: crudo.lineas_total,
  };
}

/**
 * Una línea de la tabla "Rentabilidad por producto".
 *
 * `margenPct` es `null` cuando el producto se vendió sin costo cargado: la
 * fila igual aparece —con lo facturado, que sí se sabe— y dice que del margen
 * no hay dato. Sacarla de la lista la volvería invisible justo para quien
 * tendría que ir a cargarle el costo.
 */
export interface ProductoRentable {
  product_id: string;
  nombre: string;
  facturado: string;
  margen: string | null;
  margenPct: Decimal | null;
}

export interface CrudoProducto {
  product_id: string;
  nombre: string;
  facturado: string;
  costo: string | null;
}

export function rentabilidadDe(fila: CrudoProducto): ProductoRentable {
  if (fila.costo === null) {
    return {
      product_id: fila.product_id,
      nombre: fila.nombre,
      facturado: fila.facturado,
      margen: null,
      margenPct: null,
    };
  }
  const facturado = new Decimal(fila.facturado);
  const margen = facturado.minus(fila.costo);
  return {
    product_id: fila.product_id,
    nombre: fila.nombre,
    facturado: fila.facturado,
    margen: margen.toFixed(4),
    margenPct: porcentaje(margen, facturado),
  };
}

/**
 * Cómo se pinta un margen.
 *
 * El corte NO se inventó acá: sale del guard de Ofertas, que es la autoridad
 * visual y ya decide sobre el margen (`ofertas.html`):
 *
 *     if (worst < 0)       -> 'bad'   "Vende bajo costo"
 *     else if (worst < 15) -> 'tight' "Margen ajustado"
 *     else                 -> 'ok'    "Margen sano"
 *
 * Se copia el umbral Y las palabras para que un 14% signifique lo mismo en las
 * dos pantallas. Si mañana el comercio quiere mover el 15, se mueve en un solo
 * lugar y las dos lo siguen.
 *
 * `sin_dato` es su propio estado y NO se pinta de rojo: "no sé" no es "mal".
 * Pintarlo de rojo empujaría a corregir un precio que puede estar perfecto.
 */
export type ColorMargen = 'sano' | 'ajustado' | 'bajo_costo' | 'sin_dato';

/** Debajo de esto el margen es "ajustado". Igual que en `ofertas.html`. */
export const MARGEN_SANO = 15;

export function colorDelMargen(pct: Decimal | null): ColorMargen {
  if (pct === null) return 'sin_dato';
  if (pct.lt(0)) return 'bajo_costo';
  if (pct.lt(MARGEN_SANO)) return 'ajustado';
  return 'sano';
}

/** El rótulo, con las mismas palabras que Ofertas. */
export function decirMargen(pct: Decimal | null): string {
  const color = colorDelMargen(pct);
  if (color === 'sin_dato') return 'Sin costo cargado';
  if (color === 'bajo_costo') return 'Vende bajo costo';
  return color === 'ajustado'
    ? `Margen ajustado · ${decirPct(pct)}`
    : `Margen sano · ${decirPct(pct)}`;
}

/** Un porcentaje para mostrar: un decimal, coma, sin inventar precisión. */
export function decirPct(pct: Decimal | null): string {
  if (pct === null) return 'sin dato';
  return `${pct.toFixed(1).replace('.', ',')}%`;
}
