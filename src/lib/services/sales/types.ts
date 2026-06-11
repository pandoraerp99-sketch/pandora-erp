/**
 * Inputs / outputs para SaleService.
 */
import { z } from 'zod';
import {
  CUSTOMER_DOC_TYPES,
  PAYMENT_METHODS,
  SALE_PAYMENT_METHODS,
} from '../../db/schema/_common.js';

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

/**
 * Sprint 5 Bloque 3: payment granular per row en sale_payments.
 *
 * `method` ∈ {efectivo, tarjeta, mp_qr}. NO incluye 'mixto' (ese valor
 * solo aplica al denormalizado `sales.payment_method` cuando hay 2+
 * payments con methods distintos).
 *
 * `amount`: string formato `\d+(\.\d{1,4})?` (mismo patrón que quantity
 * + unit_price del módulo). Validado con regex; el servicio convierte a
 * scale 4 antes del INSERT.
 *
 * `mp_payment_external_id`: SOLO cuando method='mp_qr'. ID externo MP
 * para linkear con mp_payments más tarde vía webhook.
 */
export const PaymentItemSchema = z
  .object({
    method: z.enum(SALE_PAYMENT_METHODS),
    amount: z
      .string()
      .regex(
        /^\d+(\.\d{1,4})?$/,
        'amount debe ser numero positivo con hasta 4 decimales'
      ),
    mp_payment_external_id: z.string().max(100).optional(),
  })
  .refine(
    (data) =>
      data.method !== 'mp_qr' ||
      (data.mp_payment_external_id !== undefined &&
        data.mp_payment_external_id.length > 0),
    {
      message:
        'mp_payment_external_id es obligatorio cuando method=mp_qr (vendrá del SDK MercadoPago)',
      path: ['mp_payment_external_id'],
    }
  )
  .refine(
    (data) =>
      data.method === 'mp_qr' || data.mp_payment_external_id === undefined,
    {
      message:
        'mp_payment_external_id solo aplica si method=mp_qr (no setear en efectivo/tarjeta)',
      path: ['mp_payment_external_id'],
    }
  );

export type PaymentItem = z.infer<typeof PaymentItemSchema>;

export const FinalizeSaleInputSchema = z.object({
  sale_id: z.string().uuid(),
  /**
   * Sprint 5 Bloque 3: array granular reemplaza payment_method+payment_breakdown.
   * Cada row INSERT a sale_payments. Si method='efectivo' Y hay cash_session
   * activa para (tenant, sale.sale_point) → linkea cash_session_id en ambas
   * tablas (sales + sale_payments). El campo denormalizado sales.payment_method
   * lo computa el service: 1 method → ese, 2+ methods distintos → 'mixto'.
   */
  payments: z.array(PaymentItemSchema).min(1, 'Al menos 1 payment requerido'),
  require_fiscal_invoice: z.boolean().default(false),
});

export type FinalizeSaleInput = z.infer<typeof FinalizeSaleInputSchema>;

/**
 * Tipo legacy retenido para compatibilidad con código existente que aún
 * referencia PAYMENT_METHODS denormalizado en sales.payment_method.
 * Sprint 5 Bloque 3 introdujo PaymentItem como contrato real de finalizeSale.
 */
export type LegacyPaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CancelSaleInputSchema = z.object({
  sale_id: z.string().uuid(),
  reason: z.string().min(3).max(500),
});

export type CancelSaleInput = z.infer<typeof CancelSaleInputSchema>;
