/**
 * Inventory queries — lookups read-only para POS UI + reportes.
 * Sprint 3 ROADMAP Inventory T-INV-03 (typeahead trigram < 100ms con 10k productos).
 *
 * **Patrón Sprint 3 #4 / #5:** pure helpers testeables sin DB + wrappers DB.
 *
 * **Multi-tenant guard:** todos los wrappers leen `tenant_id` del context.
 * NO emit audit_log (lecturas no se auditan F0 — solo mutations CLAUDE.md §16.9).
 *
 * **Búsqueda fuzzy (typeahead POS):** `searchProductsByName` usa pg_trgm GIN
 * index (migration 0006). Cajero teclea parcial ("toaval" matchea "Toallon").
 * Target P95 < 100ms con 10k productos.
 *
 * **Búsqueda exacta:**
 * - `findProductByBarcode`: scan de código de barras (case-sensitive, exact)
 * - `findProductBySku`: lookup SKU (case-sensitive, exact por partial unique
 *   index `products_tenant_sku_unique_partial`)
 *
 * **Listados operativos:**
 * - `listLowStockProducts`: alertas de stock bajo (stock_current < stock_minimum)
 * - `listProductsPaginated`: catálogo paginado para vista comerciante
 */
import { eq, and, sql, asc, desc, isNotNull, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { products, type Product } from '../db/schema/products.js';
import { requireTracingContext } from '../tracing/context.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';
import type { MovementDirection, StockMovementType } from '../db/schema/_common.js';
import { ZONA_COMERCIO } from '../domain/fecha-comercio.js';

// ──── Errors tipados ────────────────────────────────────────────

export class QueryValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_search_query'
      | 'invalid_barcode'
      | 'invalid_sku'
      | 'invalid_limit',
    message: string
  ) {
    super(message);
    this.name = 'QueryValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ──── Pure helpers (testeables sin DB) ──────────────────────────

/**
 * Sanitiza query de búsqueda typeahead para ILIKE pattern.
 *
 * **Defensa anti-LIKE-injection:** `%` y `_` son wildcards en ILIKE.
 * Caller que escribe "100% efectivo" → sin escape, el % matchea cualquier
 * cosa. Escapamos `\%` y `\_`.
 *
 * **Trim:** evita queries vacías o solo whitespace que matcharían todo.
 * **Longitud mínima 2:** typeahead con 1 char devuelve casi todo el catálogo
 * (no útil, costoso). Convención: cliente prefetcha al teclear 2+ chars.
 * **Longitud máxima 100:** evita DoS por query gigante. 100 chars cubre
 * nombres de producto + marca + descripción combinados.
 *
 * @throws QueryValidationError si query inválida
 * @returns string sanitizado listo para envolver con `%${...}%`
 */
export function buildNameSearchPattern(query: string): string {
  if (typeof query !== 'string') {
    throw new QueryValidationError(
      'invalid_search_query',
      `query debe ser string (recibido ${typeof query})`
    );
  }
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new QueryValidationError(
      'invalid_search_query',
      `query debe tener al menos 2 caracteres (recibido "${query}")`
    );
  }
  if (trimmed.length > 100) {
    throw new QueryValidationError(
      'invalid_search_query',
      `query no puede superar 100 caracteres (recibido ${trimmed.length})`
    );
  }
  // Escape wildcards ILIKE: \% \_ \\
  return trimmed
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

/**
 * Sanitiza barcode/SKU para lookup exact. Mínimo strict:
 * - trim
 * - longitud > 0
 * - longitud < 100 (DoS guard)
 *
 * Caracteres permitidos: TODO (barcodes incluyen dígitos, letras, guiones,
 * dependiendo del estándar: EAN-13 dígitos / Code128 alfanumérico).
 * NO filtramos caracteres — caller puede usar lo que necesite.
 */
export function normalizeExactLookup(
  raw: string,
  field: 'barcode' | 'sku'
): string {
  if (typeof raw !== 'string') {
    throw new QueryValidationError(
      `invalid_${field}` as QueryValidationError['code'],
      `${field} debe ser string (recibido ${typeof raw})`
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new QueryValidationError(
      `invalid_${field}` as QueryValidationError['code'],
      `${field} no puede ser vacío`
    );
  }
  if (trimmed.length > 100) {
    throw new QueryValidationError(
      `invalid_${field}` as QueryValidationError['code'],
      `${field} no puede superar 100 caracteres (recibido ${trimmed.length})`
    );
  }
  return trimmed;
}

/**
 * Valida limit para queries paginadas / typeahead.
 * Default 20, max 100 (POS UI no necesita más en una sola búsqueda).
 */
export function normalizeLimit(
  limit: number | undefined,
  defaultLimit = 20,
  maxLimit = 100
): number {
  if (limit === undefined) return defaultLimit;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new QueryValidationError(
      'invalid_limit',
      `limit debe ser entero positivo (recibido ${limit})`
    );
  }
  if (limit > maxLimit) {
    throw new QueryValidationError(
      'invalid_limit',
      `limit no puede superar ${maxLimit} (recibido ${limit})`
    );
  }
  return limit;
}

// ──── Service wrappers (con DB) ────────────────────────────────

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function requireTenantId(): string {
  const ctx = requireTracingContext();
  const tenant_id = ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'inventory.query: tenant_id ausente en context'
    );
  }
  return tenant_id;
}

export interface SearchProductsOptions {
  /** Máximo de resultados. Default 20, max 100. */
  limit?: number;
  /** Si true (default), excluye `is_active = false`. */
  activeOnly?: boolean;
}

/**
 * Búsqueda typeahead por nombre (fuzzy via pg_trgm GIN index).
 *
 * Combina ILIKE para boolean match + similarity() para ranking.
 * El índice GIN trigram acelera ambos: ILIKE `%texto%` usa el index
 * cuando texto >= 3 caracteres (por la naturaleza de trigramas).
 *
 * **Target performance (T-INV-03):** P95 < 100ms con 10k productos.
 * Verificable en `tests/integration/INTEGRATION-TODO.md` T-INV-08.
 */
export async function searchProductsByName(
  query: string,
  options: SearchProductsOptions = {},
  txOrDb: DbOrTransaction = db
): Promise<Product[]> {
  const tenant_id = requireTenantId();
  const pattern = buildNameSearchPattern(query);
  const limit = normalizeLimit(options.limit);
  const activeOnly = options.activeOnly !== false; // default true

  const ilikePattern = `%${pattern}%`;
  const rawQuery = pattern.replaceAll('\\%', '%').replaceAll('\\_', '_').replaceAll('\\\\', '\\');

  // similarity() devuelve 0-1 (1 = exact match). ORDER BY similarity DESC
  // saca los más parecidos primero (importante para typeahead).
  const rows = await txOrDb
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenant_id, tenant_id),
        activeOnly ? eq(products.is_active, true) : undefined,
        sql`${products.name} ILIKE ${ilikePattern}`
      )
    )
    .orderBy(desc(sql`similarity(${products.name}, ${rawQuery})`), asc(products.name))
    .limit(limit);

  return rows;
}

/**
 * Lookup exact por barcode dentro del tenant.
 * Usa partial unique index `products_tenant_barcode_unique_partial`.
 */
export async function findProductByBarcode(
  barcode: string,
  txOrDb: DbOrTransaction = db
): Promise<Product | null> {
  const tenant_id = requireTenantId();
  const normalized = normalizeExactLookup(barcode, 'barcode');

  const rows = await txOrDb
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenant_id, tenant_id),
        eq(products.barcode, normalized),
        eq(products.is_active, true)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Lookup exact por SKU dentro del tenant.
 * Usa partial unique index `products_tenant_sku_unique_partial`.
 */
export async function findProductBySku(
  sku: string,
  txOrDb: DbOrTransaction = db
): Promise<Product | null> {
  const tenant_id = requireTenantId();
  const normalized = normalizeExactLookup(sku, 'sku');

  const rows = await txOrDb
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenant_id, tenant_id),
        eq(products.sku, normalized),
        eq(products.is_active, true)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Lista productos con stock bajo: `stock_current < stock_minimum`.
 * Sólo incluye productos con `stock_minimum IS NOT NULL` (caso explícito —
 * sin minimum no hay alerta).
 *
 * Solo activos. Ordenado por urgencia: menor stock_current primero.
 */
export async function listLowStockProducts(
  txOrDb: DbOrTransaction = db
): Promise<Product[]> {
  const tenant_id = requireTenantId();

  const rows = await txOrDb
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenant_id, tenant_id),
        eq(products.is_active, true),
        eq(products.stock_tracking_enabled, true),
        isNotNull(products.stock_minimum),
        lt(products.stock_current, products.stock_minimum)
      )
    )
    .orderBy(asc(products.stock_current), asc(products.name));

  return rows;
}

export interface ListProductsOptions {
  limit?: number;
  offset?: number;
  activeOnly?: boolean;
}

/**
 * Lista paginada del catálogo (vista comerciante).
 * Sin filtros = todo el catálogo del tenant ordenado por nombre.
 */
export async function listProductsPaginated(
  options: ListProductsOptions = {},
  txOrDb: DbOrTransaction = db
): Promise<Product[]> {
  const tenant_id = requireTenantId();
  const limit = normalizeLimit(options.limit, 50, 200);
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new QueryValidationError(
      'invalid_limit',
      `offset debe ser entero >= 0 (recibido ${offset})`
    );
  }
  const activeOnly = options.activeOnly !== false;

  const rows = await txOrDb
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenant_id, tenant_id),
        activeOnly ? eq(products.is_active, true) : undefined
      )
    )
    .orderBy(asc(products.name))
    .limit(limit)
    .offset(offset);

  return rows;
}

// ──── Historial de movimientos de un producto ─────────────────────

export interface MovimientoDelHistorial {
  id: string;
  /** 'AAAA-MM-DD' — el día en que el movimiento PASÓ (migration 0037). */
  fecha: string;
  /** 'AAAA-MM-DD' — el día del comercio en que se CARGÓ. Distinto de `fecha` en un comprobante cargado tarde. */
  cargado: string;
  /** 'HH:MM' de la carga, en la zona del comercio. */
  hora: string;
  type: StockMovementType;
  direction: MovementDirection;
  qty: string;
  motivo: string | null;
  /**
   * Lo que se sabe además del tipo: el cliente de la venta, el comprobante y
   * proveedor de la compra ("sin comprobante" si no hay), el texto del ajuste.
   * NULL cuando no hay nada que agregar (una venta sin cliente).
   */
  origen: string | null;
  /** Quién lo cargó. NULL si no hay usuario (movimiento del sistema). */
  quien: string | null;
}

export interface HistorialDelProducto {
  movimientos: MovimientoDelHistorial[];
  /** Cuántos hay en total. La pantalla dice "mostrando N de total". */
  total: number;
}

/**
 * Los movimientos de un producto, del más nuevo al más viejo.
 *
 * ── ORDEN Y FECHA: EL DÍA EN QUE PASÓ ─────────────────────────────────────
 * Se ordena por `fecha`, no por `created_at`: es el mismo reloj del inventario
 * al cierre. Y se devuelven las dos, porque donde difieren —un comprobante de
 * julio cargado en septiembre— una fila "de julio" que el comerciante sabe que
 * tipeó ayer lo haría desconfiar de la pantalla.
 *
 * ── EL ORIGEN, EN PALABRAS ────────────────────────────────────────────────
 * La maqueta (`stock-v2.html`) muestra "Ajuste por rotura · Agus",
 * "OC #311 · Distrib. Austral". Acá: la venta (y a quién, si se sabe), el
 * comprobante y el proveedor, o el texto del ajuste. Las ventas no tienen
 * número correlativo, así que no se inventa uno.
 *
 * Multi-tenant: filtra por el tenant del context en el `where`; un producto de
 * otro comercio devuelve cero filas.
 */
export async function listProductMovements(
  productId: string,
  options: { limit?: number } = {},
  txOrDb: DbOrTransaction = db
): Promise<HistorialDelProducto> {
  const tenant_id = requireTenantId();
  const limit = normalizeLimit(options.limit, 100, 500);

  const filas = await txOrDb.execute<{
    id: string;
    fecha: string;
    cargado: string;
    hora: string;
    type: StockMovementType;
    direction: MovementDirection;
    qty: string;
    motivo: string | null;
    origen: string | null;
    quien: string | null;
    total: number;
  }>(sql`
    SELECT m.id::text                                                     AS id,
           m.fecha::text                                                  AS fecha,
           (m.created_at AT TIME ZONE ${ZONA_COMERCIO})::date::text       AS cargado,
           to_char(m.created_at AT TIME ZONE ${ZONA_COMERCIO}, 'HH24:MI') AS hora,
           m.type,
           m.direction,
           m.qty::text                                                    AS qty,
           m.motivo,
           -- El TIPO ya lo dice la etiqueta de la fila: acá va lo que se sabe
           -- ademas. Repetirlo daba "Venta Venta" / "Compra Compra" (visto en
           -- la pantalla).
           CASE
             WHEN m.type = 'sale' THEN
               NULLIF(TRIM(s.customer_name_snapshot), '')
             WHEN m.type = 'purchase' THEN
               -- payee_name es el snapshot del proveedor (del catalogo o
               -- escrito a mano). Que falte el papel SI es un dato.
               COALESCE(
                 NULLIF(CONCAT_WS(' · ',
                   NULLIF(TRIM(CONCAT_WS(' ', e.comprobante_tipo, e.comprobante_numero)), ''),
                   NULLIF(TRIM(e.payee_name), '')
                 ), ''),
                 'sin comprobante'
               )
             ELSE NULLIF(TRIM(m.reason), '')
           END                                                            AS origen,
           u.full_name                                                    AS quien,
           count(*) OVER ()::int                                          AS total
      FROM stock_movements m
      LEFT JOIN sales s    ON s.id = m.related_sale_id
      LEFT JOIN expenses e ON e.id = m.related_expense_id
      LEFT JOIN users u    ON u.id = m.created_by
     WHERE m.tenant_id = ${tenant_id}
       AND m.product_id = ${productId}
     ORDER BY m.fecha DESC, m.created_at DESC, m.id DESC
     LIMIT ${limit}
  `);

  return {
    movimientos: filas.map(({ total: _total, ...m }) => m),
    total: filas[0]?.total ?? 0,
  };
}
