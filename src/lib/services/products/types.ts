/**
 * Input/output types para ProductService.
 * Schemas Zod en boundary, types inferidos.
 */
import { z } from 'zod';
import { UNIT_TYPES } from '../../db/schema/products.js';

const moneyString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Debe ser numero con hasta 4 decimales');

const skuString = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, 'SKU solo acepta letras, numeros, punto, guion, guion bajo');

const barcodeString = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[0-9A-Za-z]+$/, 'Barcode solo acepta numeros y letras');

export const CreateProductInputSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(2000).optional(),
  sku: skuString.optional(),
  barcode: barcodeString.optional(),
  unit_type: z.enum(UNIT_TYPES).default('unidad'),
  price: moneyString,
  cost: moneyString.optional(),
  tax_rate: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).default('21.00'),
  tdf_exempt: z.boolean().default(false),
  stock_current: moneyString.default('0'),
  stock_minimum: moneyString.optional(),
  stock_tracking_enabled: z.boolean().default(true),
  is_active: z.boolean().default(true),
});

export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

export const UpdateProductInputSchema = CreateProductInputSchema.partial();
export type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

export const SearchProductsInputSchema = z.object({
  query: z.string().min(1).max(100),
  limit: z.number().int().positive().max(50).default(10),
});

export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;

export const StockAdjustmentInputSchema = z.object({
  product_id: z.string().uuid(),
  delta: z
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/, 'Delta debe ser numero (puede ser negativo)'),
  reason: z.string().min(3).max(500),
});

export type StockAdjustmentInput = z.infer<typeof StockAdjustmentInputSchema>;
