/**
 * Qué le hace una compra de mercadería a cada producto, ANTES de registrarla:
 * stock, costo y margen. Lógica pura, sin base.
 *
 * Es la parte "costos" de la carga al estilo "Recibidas" del mockup
 * (`facturas-v4.html`): el momento de revisar el precio de venta es cuando
 * entra un costo nuevo, y hasta ahora nadie lo mostraba.
 *
 * ── TIENE QUE DECIR LO MISMO QUE VA A GUARDAR EL SERVIDOR ─────────────────
 * `products.cost` queda en el de la ÚLTIMA compra vigente, ordenada por fecha
 * del comprobante, después por cuándo se cargó y después por renglón
 * (`recalcularCostoUltimaCompra`). De ahí salen las tres reglas de acá:
 *   - una factura con fecha ANTERIOR a la última compra no cambia el costo;
 *   - una con la MISMA fecha sí lo cambia (se cargó después: gana);
 *   - el mismo producto en dos renglones: el costo es el del renglón de más
 *     abajo, y el stock suma los dos.
 *
 * ── EL MARGEN ─────────────────────────────────────────────────────────────
 * Sobre el precio de venta del producto, que se guarda SIN IVA (el IVA se
 * suma al vender, `calculateLine`). Es la misma cuenta que Productos y que el
 * margen bruto del Panel (sobre el neto de la línea): las tres pantallas
 * tienen que mostrar el mismo número para el mismo producto.
 */
import Decimal from 'decimal.js';

/** (precio − costo) / precio, en %. `null` sin costo o con precio 0. */
export function margenSobrePrecio(
  precio: Decimal.Value | null | undefined,
  costo: Decimal.Value | null | undefined
): Decimal | null {
  if (precio === null || precio === undefined || costo === null || costo === undefined) return null;
  const p = new Decimal(precio);
  if (p.lte(0)) return null;
  return p.minus(costo).dividedBy(p).times(100);
}

export interface RenglonCompra {
  productId: string;
  /** Cantidad del renglón; `null` si todavía no se escribió bien. */
  qty: Decimal | null;
  /** Costo unitario neto del renglón; `null` si todavía no se escribió bien. */
  costo: Decimal | null;
  /** Precio de venta actual del producto (sin IVA). */
  precio: string;
  stock: string;
  /** Costo actual del producto (`products.cost`); `null` si no tiene. */
  costoActual: string | null;
  /** Fecha de la última compra vigente ('AAAA-MM-DD'); `null` si nunca se compró. */
  ultimaCompra: string | null;
}

export type MotivoCosto =
  /** Esta compra fija el costo nuevo. */
  | 'cambia'
  /** Hay una compra más nueva: el costo queda como está. */
  | 'compra_mas_nueva'
  /** Falta el costo en el renglón: todavía no se sabe. */
  | 'sin_costo';

export interface ImpactoProducto {
  stockAntes: Decimal;
  stockDespues: Decimal;
  costoAntes: Decimal | null;
  costoDespues: Decimal | null;
  motivo: MotivoCosto;
  /** Variación del costo en %; `null` si no hay costo anterior o no cambia. */
  variacionCosto: Decimal | null;
  margenAntes: Decimal | null;
  margenDespues: Decimal | null;
  /** El producto aparece en más de un renglón de esta compra. */
  repetido: boolean;
}

/**
 * Impacto por producto. Los renglones van en el orden de la factura: el de
 * más abajo es el de mayor número de renglón.
 */
export function impactoDeCompra(
  renglones: RenglonCompra[],
  fechaCompra: string
): Map<string, ImpactoProducto> {
  const porProducto = new Map<string, RenglonCompra[]>();
  for (const r of renglones) {
    const lista = porProducto.get(r.productId) ?? [];
    lista.push(r);
    porProducto.set(r.productId, lista);
  }

  const out = new Map<string, ImpactoProducto>();
  for (const [id, lista] of porProducto) {
    const base = lista[0]!;
    const stockAntes = new Decimal(base.stock);
    const entra = lista.reduce((acc, r) => acc.plus(r.qty ?? 0), new Decimal(0));
    const costoAntes = base.costoActual === null ? null : new Decimal(base.costoActual);

    // El del renglón de más abajo con costo escrito: es el que gana el empate.
    const ultimoConCosto = [...lista].reverse().find((r) => r.costo !== null);
    const costoCompra = ultimoConCosto?.costo ?? null;

    let motivo: MotivoCosto;
    if (costoCompra === null) motivo = 'sin_costo';
    else if (base.ultimaCompra !== null && fechaCompra < base.ultimaCompra)
      motivo = 'compra_mas_nueva';
    else motivo = 'cambia';

    const costoDespues = motivo === 'cambia' ? costoCompra : costoAntes;
    const variacionCosto =
      motivo === 'cambia' && costoAntes !== null && costoAntes.gt(0) && costoCompra !== null
        ? costoCompra.minus(costoAntes).dividedBy(costoAntes).times(100)
        : null;

    out.set(id, {
      stockAntes,
      stockDespues: stockAntes.plus(entra),
      costoAntes,
      costoDespues,
      motivo,
      variacionCosto,
      margenAntes: margenSobrePrecio(base.precio, costoAntes),
      margenDespues: margenSobrePrecio(base.precio, costoDespues),
      repetido: lista.length > 1,
    });
  }
  return out;
}
