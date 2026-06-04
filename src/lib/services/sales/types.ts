/**
 * Inputs / outputs para SaleService.
 */
import { z } from 'zod';
import { CUSTOMER_DOC_TYPES, PAYMENT_METHODS } from '../../db/schema/_common.js';

const quantitySchema = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Cantidad debe ser numero positivo con hasta 4 decimales');

const moneyString = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const AddItemInputSchema = z.object({
  sale_id: z.string().uuid(),
  product_id: z.string().uuid(),
  quantity: quantitySchema,
  unit_price_override: moneyString.optional(),
});

export type AddItemInput = z.infer<typeof AddItemInputSchema>;

export const UpdateItemQuantityInputSchema = z.object({
  sale_id: z.string().uuid(),
  item_id: z.string().uuid(),
  quantity: quantitySchema,
});

export type UpdateItemQuantityInput = z.infer<typeof UpdateItemQuantityInputSchema>;

export const RemoveItemInputSchema = z.object({
  sale_id: z.string().uuid(),
  item_id: z.string().uuid(),
});

export type RemoveItemInput = z.infer<typeof RemoveItemInputSchema>;

export const SetCustomerInputSchema = z.object({
  sale_id: z.string().uuid(),
  doc_type: z.enum(CUSTOMER_DOC_TYPES),
  doc_number: z
    .string()
    .max(20)
    .regex(/^[0-9]+$/, 'Documento solo numeros')
    .optional(),
  name: z.string().max(255).trim().optional(),
  tax_condition: z.string().max(64).optional(),
});

export type SetCustomerInput = z.infer<typeof SetCustomerInputSchema>;

export const FinalizeSaleInputSchema = z.object({
  sale_id: z.string().uuid(),
  payment_method: z.enum(PAYMENT_METHODS),
  payment_breakdown: z.string().max(500).optional(),
  require_fiscal_invoice: z.boolean().default(false),
});

export type FinalizeSaleInput = z.infer<typeof FinalizeSaleInputSchema>;

export const CancelSaleInputSchema = z.object({
  sale_id: z.string().uuid(),
  reason: z.string().min(3).max(500),
});

export type CancelSaleInput = z.infer<typeof CancelSaleInputSchema>;
