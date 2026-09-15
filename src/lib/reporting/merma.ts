/**
 * Merma y valor del stock — capa pura (RESEARCH-BRIEF-panel §8.e).
 *
 * El SQL junta el crudo (`merma.report.ts`); acá se decide qué se puede afirmar.
 *
 * ── A QUÉ COSTO ────────────────────────────────────────────────────────────
 * A costo de ÚLTIMA COMPRA (`products.cost`), y la pantalla lo dice. El
 * movimiento de merma no congela el costo, así que esto sirve para el mes en
 * curso y NO para comparar meses: valorizar marzo con el costo de hoy cambiaría
 * un mes cerrado. Si alguna vez se pide la serie, se valoriza por PEPS desde el
 * libro, como el inventario al cierre.
 *
 * ── LA MISMA REGLA QUE MARGEN ──────────────────────────────────────────────
 * Una unidad sin costo cargado NO se convierte en pesos: ni en $0 (diría que no
 * costó nada) ni descartándola en silencio (el total sobreviviente parecería
 * completo). Por eso los estados:
 *
 *   - `sin_merma`  → no hay ninguna merma cargada en el período.
 *   - `sin_costo`  → hay merma, pero ninguna unidad tiene costo: hay unidades,
 *                    no hay pesos.
 *   - `parcial`    → hay pesos, y además unidades que no pudieron valorizarse.
 *   - `completo`   → todo valorizado.
 *
 * "Sin merma" quiere decir "nadie cargó una": que no se haya registrado una
 * rotura no prueba que no la hubo. La pantalla lo dice con esas palabras.
 */
import Decimal from 'decimal.js';

/** Una fila por motivo de merma, del SQL. Plata y unidades en string (§9). */
export interface CrudoMermaMotivo {
  motivo: string;
  /** Todas las unidades perdidas por este motivo. */
  unidades: string;
  /** De esas, las de productos sin costo cargado. */
  unidades_sin_costo: string;
  /** Σ unidades × costo, sólo de las que tienen costo. */
  costo: string;
  filas: number;
}

/** Una fila por producto con merma en el período. */
export interface CrudoMermaProducto {
  product_id: string;
  nombre: string;
  unidades: string;
  /** `null` si el producto no tiene costo cargado. */
  costo: string | null;
}

export type EstadoMerma = 'sin_merma' | 'sin_costo' | 'parcial' | 'completo';

export interface MermaPorMotivo {
  motivo: string;
  unidades: string;
  costo: string;
  movimientos: number;
  /** Parte de los PESOS de la merma. `null` si no hay pesos contra qué medir. */
  participacionPct: Decimal | null;
}

export interface Merma {
  estado: EstadoMerma;
  /** Pesos valorizables. `null` en `sin_merma` y `sin_costo`. */
  costo: string | null;
  unidades: string;
  unidadesSinCosto: string;
  movimientos: number;
  porMotivo: MermaPorMotivo[];
  /** Los que más pierden, como mucho `TOP_PRODUCTOS`. */
  productos: CrudoMermaProducto[];
}

export const TOP_PRODUCTOS = 3;

export function calcularMerma(
  motivos: CrudoMermaMotivo[],
  productos: CrudoMermaProducto[]
): Merma {
  let costo = new Decimal(0);
  let unidades = new Decimal(0);
  let sinCosto = new Decimal(0);
  let movimientos = 0;
  for (const m of motivos) {
    costo = costo.plus(m.costo);
    unidades = unidades.plus(m.unidades);
    sinCosto = sinCosto.plus(m.unidades_sin_costo);
    movimientos += m.filas;
  }

  const estado: EstadoMerma =
    movimientos === 0
      ? 'sin_merma'
      : sinCosto.eq(unidades)
        ? 'sin_costo'
        : sinCosto.gt(0)
          ? 'parcial'
          : 'completo';

  const hayPesos = estado === 'parcial' || estado === 'completo';

  const porMotivo = motivos
    .map((m) => ({
      motivo: m.motivo,
      unidades: m.unidades,
      costo: m.costo,
      movimientos: m.filas,
      // División sólo con divisor que sirve: `1/0` en JS es Infinity, que no
      // falla y se lee como un número enorme.
      participacionPct:
        hayPesos && costo.gt(0) ? new Decimal(m.costo).dividedBy(costo).times(100) : null,
    }))
    .sort((a, b) => new Decimal(b.costo).comparedTo(a.costo));

  // Los sin costo van al final: ordenarlos como $0 los pondría abajo por la
  // razón equivocada y, peor, en empate con uno que de verdad perdió poco.
  const ordenados = [...productos].sort((a, b) => {
    if (a.costo === null && b.costo === null) return 0;
    if (a.costo === null) return 1;
    if (b.costo === null) return -1;
    return new Decimal(b.costo).comparedTo(a.costo);
  });

  return {
    estado,
    costo: hayPesos ? costo.toFixed(4) : null,
    unidades: unidades.toFixed(4),
    unidadesSinCosto: sinCosto.toFixed(4),
    movimientos,
    porMotivo,
    productos: ordenados.slice(0, TOP_PRODUCTOS),
  };
}

/** Del SQL: plata quieta en góndola, a costo de última compra. */
export interface CrudoValorStock {
  /** Σ stock × costo de los productos que tienen costo. */
  valor: string;
  /** Productos activos, con control de stock y stock > 0. */
  productos_con_stock: number;
  /** De esos, los que no tienen costo cargado. */
  productos_sin_costo: number;
}

export type EstadoValorStock = 'sin_stock' | 'sin_costo' | 'parcial' | 'completo';

export interface ValorStock {
  estado: EstadoValorStock;
  valor: string | null;
  productosConStock: number;
  productosSinCosto: number;
}

export function calcularValorStock(crudo: CrudoValorStock): ValorStock {
  const estado: EstadoValorStock =
    crudo.productos_con_stock === 0
      ? 'sin_stock'
      : crudo.productos_sin_costo === crudo.productos_con_stock
        ? 'sin_costo'
        : crudo.productos_sin_costo > 0
          ? 'parcial'
          : 'completo';
  return {
    estado,
    valor: estado === 'parcial' || estado === 'completo' ? new Decimal(crudo.valor).toFixed(4) : null,
    productosConStock: crudo.productos_con_stock,
    productosSinCosto: crudo.productos_sin_costo,
  };
}
