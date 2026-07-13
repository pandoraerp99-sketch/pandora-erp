'use server';

/**
 * Server Actions del POS (Slice 4/5) — el primer consumidor real del bridge
 * sesión→tracing (`withServerActionTracing`, Slice 3).
 *
 * Cada action:
 *   1. corre dentro de `withServerActionTracing(requireAuth)` → monta el
 *      tracing context (tenant_id = active_company_id, actor_user_id) que el
 *      service layer necesita vía requireTenantId()/getCurrentActor().
 *   2. delega en el service de ventas (que valida input con zod + hace la
 *      lógica fiscal/money/stock).
 *   3. devuelve un envelope `{ ok, data } | { ok, error }` — los DomainError
 *      (negocio) se mapean a error legible; los inesperados propagan (500).
 *
 * La `idempotency_key` de finalize la genera el CLIENTE (un UUID por intento
 * de cobro, reusado en retries) — así un doble-click / timeout no doble-cobra
 * (ADR-0010, ver finalizeSale).
 */
import { getCurrentActor } from '@/lib/tracing/context';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import {
  DomainError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/multi_tenant/errors';
import {
  createDraftSale,
  addItemToSale,
  updateItemQuantity,
  removeItemFromSale,
  setSaleCustomer,
  finalizeSale,
  getSaleWithItems,
  type SaleWithItems,
} from '@/lib/services/sales/sale.service';
import { emitAfterCobro, type EmitAfterCobroResult } from '@/lib/fiscal/emit-after-cobro';
import type { Sale } from '@/lib/db/schema/sales';
import type { SalePaymentMethod } from '@/lib/db/schema/_common';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string> };

/**
 * Corre `fn` con tracing+auth y envuelve el resultado/errores.
 * DomainError → envelope legible (errores de negocio esperados).
 * Inesperado → propaga (Next 500 + logging, CLAUDE.md §15.7 fail-loudly).
 */
async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await withServerActionTracing(fn, { requireAuth: true });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ValidationError) {
      return {
        ok: false,
        error: e.messageEs,
        code: e.code,
        fieldErrors: e.fieldErrors,
      };
    }
    if (e instanceof DomainError) {
      return { ok: false, error: e.messageEs, code: e.code };
    }
    throw e;
  }
}

/** Abre una venta nueva (draft) para el cajero logueado. */
export async function startSaleAction(
  salePoint?: number
): Promise<ActionResult<Sale>> {
  return runAction(async () => {
    const cashierId = getCurrentActor()?.user_id;
    if (!cashierId) {
      throw new UnauthorizedError('Sesión sin usuario operador.');
    }
    return createDraftSale(cashierId, salePoint);
  });
}

export interface AddItemActionInput {
  sale_id: string;
  product_id: string;
  quantity: string;
  unit_price_override?: string;
}

/** Agrega un producto al carrito. */
export async function addItemAction(
  input: AddItemActionInput
): Promise<ActionResult<SaleWithItems>> {
  return runAction(() => addItemToSale(input));
}

export interface UpdateItemQtyActionInput {
  sale_id: string;
  item_id: string;
  quantity: string;
}

/** Cambia la cantidad de un ítem del carrito. */
export async function updateItemQtyAction(
  input: UpdateItemQtyActionInput
): Promise<ActionResult<SaleWithItems>> {
  return runAction(() => updateItemQuantity(input));
}

export interface RemoveItemActionInput {
  sale_id: string;
  item_id: string;
}

/** Quita un ítem del carrito. */
export async function removeItemAction(
  input: RemoveItemActionInput
): Promise<ActionResult<SaleWithItems>> {
  return runAction(() => removeItemFromSale(input));
}

export interface SetCustomerActionInput {
  sale_id: string;
  doc_type: string;
  doc_number?: string;
  name?: string;
  tax_condition?: string;
}

/** Asocia (o edita) el cliente de la venta antes de cobrar. */
export async function setCustomerAction(
  input: SetCustomerActionInput
): Promise<ActionResult<Sale>> {
  return runAction(() => setSaleCustomer(input));
}

export interface FinalizeSaleActionInput {
  sale_id: string;
  payments: Array<{
    method: SalePaymentMethod;
    amount: string;
    mp_payment_external_id?: string;
  }>;
  require_fiscal_invoice?: boolean;
  /** UUID generado por el POS por intento de cobro (dedup en retries). */
  idempotency_key: string;
}

export type FinalizeSaleActionData = SaleWithItems & { fiscal: EmitAfterCobroResult };

/**
 * Cobra la venta (transición a `cobrada`, registra pagos, descuenta stock) y,
 * si requiere factura, intenta emitir el CAE.
 *
 * La emisión es BEST-EFFORT (`emitAfterCobro` nunca lanza): el cobro ya está
 * commiteado cuando finalizeSale retorna, así que un fallo de AFIP / la falta de
 * cert deja la venta en `pending` sin romper el cobro. El resultado fiscal va en
 * `data.fiscal` para que el POS muestre "Factura emitida CAE X" o "en proceso".
 */
export async function finalizeSaleAction(
  input: FinalizeSaleActionInput
): Promise<ActionResult<FinalizeSaleActionData>> {
  return runAction(async () => {
    const saleWithItems = await finalizeSale(input);
    const fiscal = await emitAfterCobro(input.sale_id);
    return { ...saleWithItems, fiscal };
  });
}

/** Relee una venta con sus ítems (para refrescar el carrito en el cliente). */
export async function getSaleAction(
  saleId: string
): Promise<ActionResult<SaleWithItems>> {
  return runAction(() => getSaleWithItems(saleId));
}
