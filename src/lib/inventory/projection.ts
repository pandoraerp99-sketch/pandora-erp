/**
 * Inventory projection — snapshot inmutable Product → SaleItem.
 * Sprint 3 ROADMAP Inventory T-INV-07.
 *
 * **Responsabilidad:** dado un `Product` (mutable) + qty, producir un snapshot
 * **autosuficiente** del estado del producto AL MOMENTO de la venta. El snapshot
 * vive en `sales.items[]` y es inmutable post-emisión (CLAUDE.md §16.5).
 *
 * **Filosofía snapshot autosuficiente (ADR-0023 generalizado):**
 * Si dentro de 10 años AFIP audita una factura del 2026, el snapshot debe
 * permitir reproducir el cálculo SIN consultar el producto actual (que puede
 * haber cambiado de precio/IVA/nombre o haber sido borrado).
 *
 * **Lo que NO hace este módulo F0:**
 * - Cálculo IVA per-line vs per-bracket (PENDIENTE contadora A-1).
 *   `line_subtotal` / `line_iva` / `line_total` se calculan en Sprint 5 (Sales)
 *   o Sprint 6 (Fiscal Projection Layer) cuando A-1 esté cerrado.
 * - Aplicación de Ley 19.640 (PENDIENTE contadora A-10). El snapshot guarda
 *   `tdf_exempt_at_sale` para que projectToFiscalBreakdown lo use después.
 * - Descuentos per-line o globales (Sprint 5 Sales).
 *
 * **Determinístico:** dada la misma (Product, qty) → mismo SaleItemSnapshot
 * bit-perfect. Sin timestamps, random, lookups externos.
 *
 * **NO DB, NO context:** función pura. Sales context se la llama con producto
 * ya loqueado (SELECT FOR UPDATE) durante la creación de la venta.
 */
import type { Product } from '../db/schema/products.js';
import type { UnitType } from '../db/schema/products.js';
import { normalizeDecimal, ProductValidationError } from './products.js';

// ──── Errors tipados ────────────────────────────────────────────

export class ProjectionError extends Error {
  constructor(
    public readonly code:
      | 'invalid_qty'
      | 'product_inactive'
      | 'product_not_trackable_for_sale',
    message: string
  ) {
    super(message);
    this.name = 'ProjectionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ──── Tipo del snapshot ────────────────────────────────────────

/**
 * Snapshot inmutable de un item de venta. Persistido en `sales.items[]` jsonb
 * (o tabla `sale_items` dedicada — Sprint 5 decide).
 *
 * **Convención naming `_at_sale`:** explicita que es snapshot al momento de
 * la venta (no el valor actual del producto). Mismo patrón ADR-0023
 * `condicion_iva_receptor.desc_at_emission`.
 *
 * **Decimales:**
 * - `qty`: scale 4 (soporta venta sedería metros / carnicería kg con
 *   precisión sub-gramo).
 * - `unit_price_at_sale`, `tax_rate_at_sale`: scale 4 y 2 respectivamente
 *   (mismo que `products` schema).
 */
export interface SaleItemSnapshot {
  /** FK histórico al producto. NO se garantiza que exista al consultar (soft delete). */
  product_id: string;
  /** Nombre al momento de venta. Aparece en ticket impreso/factura. */
  name_at_sale: string;
  /** Unidad de medida al momento ('unidad', 'metro', 'kg', etc). */
  unit_type_at_sale: UnitType;
  /** Cantidad vendida. numeric(19,4). */
  qty: string;
  /** Precio unitario al momento. numeric(19,4). SIN IVA. */
  unit_price_at_sale: string;
  /** Alícuota IVA al momento (%). numeric(5,2). Ej: '21.00', '10.50', '0.00'. */
  tax_rate_at_sale: string;
  /**
   * Si el producto estaba marcado tdf_exempt=true al momento.
   * **NO es la decisión fiscal final** — esa la toma projectToFiscalBreakdown
   * combinando con `merchant_special_regime` + `transaction_in_special_zone`
   * (CLAUDE.md §8.7 + ADR-0022).
   */
  tdf_exempt_at_sale: boolean;
  /** SKU al momento (puede ser null). */
  sku_at_sale: string | null;
  /** Barcode al momento (puede ser null). */
  barcode_at_sale: string | null;
}

// ──── Pure helpers ──────────────────────────────────────────────

/**
 * Construye SaleItemSnapshot a partir de un Product + qty.
 *
 * **Pre-condiciones validadas:**
 * - `product.is_active === true` (no se vende producto soft-deleted)
 * - `qty > 0` (cantidad positiva — el signo de stock_movement lo deriva type)
 * - `qty` parseable como decimal (regex strict via normalizeDecimal)
 *
 * **Determinismo:** llamadas múltiples con (Product, qty) idénticos → snapshots
 * idénticos (string-equality). Test de property-based F1+.
 *
 * @throws ProjectionError si product inactivo o qty inválido
 */
export function toSaleItemSnapshot(
  product: Product,
  qty: string | number
): SaleItemSnapshot {
  if (!product.is_active) {
    throw new ProjectionError(
      'product_inactive',
      `Producto ${product.id} is_active=false (soft deleted). No se puede vender.`
    );
  }

  // qty validation — reusa normalizeDecimal strict del path products.
  // Convertimos ProductValidationError → ProjectionError para superficie
  // consistente con el resto del módulo projection.
  let normalizedQty: string;
  try {
    normalizedQty = normalizeDecimal(qty, 'stock_current', 4);
  } catch (e) {
    if (e instanceof ProductValidationError) {
      throw new ProjectionError('invalid_qty', e.message);
    }
    throw e;
  }
  if (parseFloat(normalizedQty) <= 0) {
    throw new ProjectionError(
      'invalid_qty',
      `qty debe ser > 0 (recibido ${normalizedQty})`
    );
  }

  return {
    product_id: product.id,
    name_at_sale: product.name,
    unit_type_at_sale: product.unit_type as UnitType,
    qty: normalizedQty,
    unit_price_at_sale: product.price,
    tax_rate_at_sale: product.tax_rate,
    tdf_exempt_at_sale: product.tdf_exempt,
    sku_at_sale: product.sku,
    barcode_at_sale: product.barcode,
  };
}

/**
 * Comparador deterministic entre dos snapshots — útil en tests + auditoría
 * para verificar que dos proyecciones del mismo producto+qty dan idéntico.
 *
 * Devuelve `true` si todos los campos son string-equal.
 * **Usar JSON.stringify** sería frágil (orden de keys depende de motor).
 */
export function snapshotsEqual(
  a: SaleItemSnapshot,
  b: SaleItemSnapshot
): boolean {
  return (
    a.product_id === b.product_id &&
    a.name_at_sale === b.name_at_sale &&
    a.unit_type_at_sale === b.unit_type_at_sale &&
    a.qty === b.qty &&
    a.unit_price_at_sale === b.unit_price_at_sale &&
    a.tax_rate_at_sale === b.tax_rate_at_sale &&
    a.tdf_exempt_at_sale === b.tdf_exempt_at_sale &&
    a.sku_at_sale === b.sku_at_sale &&
    a.barcode_at_sale === b.barcode_at_sale
  );
}
