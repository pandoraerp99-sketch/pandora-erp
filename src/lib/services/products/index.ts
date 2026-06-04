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
