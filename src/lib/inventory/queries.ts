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
