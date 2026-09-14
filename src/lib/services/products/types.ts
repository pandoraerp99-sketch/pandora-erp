/**
 * Input/output types para ProductService.
 * Schemas Zod en boundary, types inferidos.
 *
 * ⚠️ MÓDULO NO WIREADO (verificado 2026-09-02): ningún código de producción
 * importa `services/products/` — el módulo vivo es `src/lib/inventory/`.
 * NO borrar: estos schemas Zod (Create/Update/Search/StockAdjustment) no
 * existen en `inventory/`. Consolidar cuando se porte la pantalla Productos.
 * Ver QUEUE.md (SRS).
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
  // Rubro libre por tenant. Se normaliza el vacio a undefined para que
  // "" del <select> no quede guardado como rubro llamado cadena vacia.
  category: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v)),
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

/**
 * ⚠️ `stock_current` NO está — y es la única diferencia con el alta.
 *
 * `updateProduct` hace `.set({ ...cleanInput })` (spread, no enumeración como
 * el alta), así que mientras el campo estuvo en este schema, editar un producto
 * escribía el stock directo **sin un solo movimiento en el libro**. La pantalla
 * ya lo evitaba — el input está deshabilitado al editar, con la nota "el stock
 * se ajusta con un movimiento y su motivo" — pero una Server Action es un borde
 * público: lo que promete la UI lo tiene que hacer cumplir el servidor.
 *
 * El stock se mueve por `adjustStock` (ajuste con motivo) o por una compra.
 */
export const UpdateProductInputSchema = CreateProductInputSchema.omit({
  stock_current: true,
}).partial();
export type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

export const SearchProductsInputSchema = z.object({
  query: z.string().min(1).max(100),
  limit: z.number().int().positive().max(50).default(10),
});

export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;

/**
 * Ajuste manual. Desde la migration 0038 no se manda un texto libre: se manda
 * un MOTIVO de la lista cerrada (`domain/ajuste-stock.ts`) y un detalle
 * opcional. El texto que queda en el libro lo arma `planDeAjuste`. Acá sólo se
 * valida la FORMA; la regla (merma sólo resta, "otro" pide detalle, el motivo
 * existe) vive en el dominio, que es lo que también usa la pantalla.
 */
export const StockAdjustmentInputSchema = z.object({
  product_id: z.string().uuid(),
  delta: z.string(),
  motivo: z.string(),
  detalle: z.string().optional(),
});

export type StockAdjustmentInput = z.infer<typeof StockAdjustmentInputSchema>;
