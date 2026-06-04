/**
 * Inventory bounded context — Public API barrel.
 * Sprint 3 ROADMAP Inventory cierre.
 *
 * **Responsabilidad del barrel:** consumers (Sales context Sprint 5, POS UI
 * Sprint 8+, Server Actions Sprint 4) importan **SOLO** desde
 * `@/lib/inventory` — nunca directo a submódulos.
 *
 * **Reglas BOUNDED-CONTEXTS.md:**
 * - Cross-context imports usan SOLO esta superficie pública.
 * - Internos del módulo (helpers privados, DB queries internos) NO se exponen.
 * - Cambios a esta superficie requieren actualizar callers + tests.
 *
 * **Lo que NO se exporta:**
 * - `db` / Drizzle internals (caller usa context tx si necesita)
 * - Tipos `NewProduct` / `NewStockMovement` (uso interno schema)
 * - Helpers de SQL templates internos
 */

// ──── Products: CRUD + tipos ────────────────────────────────────
export {
  createProduct,
  findProductById,
  prepareCreateProductValues,
  normalizeOptionalString,
  normalizeDecimal,
  ProductValidationError,
  ProductNotFoundError,
} from './products.js';
export type {
  CreateProductInput,
  UpdateProductInput,
} from './products.js';

// Re-export tipos de schema usados en superficie pública.
export type { Product, UnitType } from '../db/schema/products.js';
export { UNIT_TYPES } from '../db/schema/products.js';

// ──── Stock: movimientos atómicos ──────────────────────────────
export {
  recordStockMovement,
  inferDirection,
  computeNextStockCurrent,
  isOversell,
  prepareStockMovementValues,
  StockValidationError,
  OversellError,
  ProductNotFoundForMovementError,
  ProductInactiveError,
} from './stock.js';
export type {
  RecordMovementInput,
  RecordMovementResult,
  MovementDirection,
} from './stock.js';

// Re-export tipos schema stock_movements + catálogo de types.
export type { StockMovement } from '../db/schema/stock_movements.js';
export { STOCK_MOVEMENT_TYPES } from '../db/schema/_common.js';
export type { StockMovementType } from '../db/schema/_common.js';

// ──── Queries: lookup + búsqueda + listados ────────────────────
export {
  searchProductsByName,
  findProductByBarcode,
  findProductBySku,
  listLowStockProducts,
  listProductsPaginated,
  buildNameSearchPattern,
  normalizeExactLookup,
  normalizeLimit,
  QueryValidationError,
} from './queries.js';
export type {
  SearchProductsOptions,
  ListProductsOptions,
} from './queries.js';

// ──── Projection: Product → SaleItemSnapshot ───────────────────
export {
  toSaleItemSnapshot,
  snapshotsEqual,
  ProjectionError,
} from './projection.js';
export type { SaleItemSnapshot } from './projection.js';
