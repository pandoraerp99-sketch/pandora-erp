/**
 * ⚠️ MÓDULO NO WIREADO (verificado 2026-09-02). Nadie importa este barrel —
 * el módulo de productos vivo es `src/lib/inventory/`, que es el que usa el POS.
 * NO borrar: acá se re-exportan `updateProduct`, `softDeleteProduct` e
 * `importProductsFromCsv`, que `inventory/` todavía no tiene.
 * Consolidar con `inventory/` cuando se porte la pantalla Productos. Ver QUEUE.md (SRS).
 */
export {
  createProduct,
  updateProduct,
  getProductById,
  findProductByBarcode,
  searchProducts,
  listLowStockProducts,
  adjustStock,
  softDeleteProduct,
} from './product.service.js';

export { importProductsFromCsv, type CsvImportResult, type CsvImportError } from './csv-import.js';

export type {
  CreateProductInput,
  UpdateProductInput,
  SearchProductsInput,
  StockAdjustmentInput,
} from './types.js';

export {
  CreateProductInputSchema,
  UpdateProductInputSchema,
  SearchProductsInputSchema,
  StockAdjustmentInputSchema,
} from './types.js';
