'use server';

/**
 * Server Actions de Productos.
 *
 * Mismo patrón que las del POS: cada action corre dentro de
 * `withServerActionTracing` (que monta el tenant_id que el service necesita
 * vía `requireTenantId()`) y devuelve un envelope `{ ok, data } | { ok, error }`.
 *
 * **No hay lógica de negocio acá.** Toda la validación (Zod), las reglas y la
 * auditoría viven en `product.service.ts`, que ya estaba escrito y testeado.
 * Esto sólo traduce Server Action ↔ service.
 *
 * Deliberadamente NO se expone `csv-import.ts`: la importación masiva es otra
 * pantalla y otro flujo (con preview, validación fila por fila y manejo de
 * errores parciales). Meterla acá de contrabando sería un botón que promete
 * algo que no está construido.
 */
import { revalidatePath } from 'next/cache';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { DomainError, ValidationError } from '@/lib/multi_tenant/errors';
import {
  createProduct,
  updateProduct,
  adjustStock,
  softDeleteProduct,
} from '@/lib/services/products/product.service';
import type { Product } from '@/lib/db/schema/products';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string> };

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

/**
 * Campos que la pantalla edita. Es un subconjunto del schema del service a
 * propósito: `tax_rate`, `unit_type` y `stock_tracking_enabled` no están en la
 * maqueta, así que no se mandan y quedan en su default. El service los valida
 * igual si algún día se agregan.
 */
export interface ProductFormInput {
  name: string;
  sku?: string;
  barcode?: string;
  category?: string;
  price: string;
  cost?: string;
  stock_current?: string;
  stock_minimum?: string;
  /** Ley 19.640 — mercadería amparada. Es fiscal, no cosmético. */
  tdf_exempt?: boolean;
}

export async function createProductAction(
  input: ProductFormInput
): Promise<ActionResult<Product>> {
  return runAction(async () => {
    const creado = await createProduct(input);
    revalidatePath('/productos');
    return creado;
  });
}

export async function updateProductAction(
  id: string,
  input: Partial<ProductFormInput>
): Promise<ActionResult<Product>> {
  return runAction(async () => {
    const actualizado = await updateProduct(id, input);
    revalidatePath('/productos');
    return actualizado;
  });
}

/**
 * Ajuste manual de stock.
 *
 * **`delta`, no valor absoluto.** Se manda cuánto SUMAR o RESTAR (`"-3"`,
 * `"10"`), no el stock final. Es a propósito: si dos personas ajustan casi al
 * mismo tiempo, dos deltas se acumulan bien y dos absolutos se pisan. Además
 * el service toma un lock sobre el producto, así que ni siquiera se solapan.
 *
 * El motivo es OBLIGATORIO (mínimo 3 caracteres) y el service deja el
 * movimiento en `stock_movements`, que es append-only.
 *
 * ⚠️ Esto último era FALSO hasta la migration 0032: este comentario afirmaba
 * que el movimiento quedaba registrado y `adjustStock` no escribía una sola
 * fila en esa tabla. Se deja anotado porque es el tipo de comentario que hace
 * invisible un agujero: describía el diseño correcto, no lo que el código
 * hacía.
 *
 * ⚠️ Esta action todavía NO la llama ningún componente — la pantalla de
 * Productos no tiene flujo de ajuste. Por eso el agujero no llegó a perder
 * datos, y por eso se arregló antes de cablearla.
 */
export async function adjustStockAction(
  productId: string,
  delta: string,
  reason: string
): Promise<ActionResult<Product>> {
  return runAction(async () => {
    const ajustado = await adjustStock({
      product_id: productId,
      delta,
      reason,
    });
    revalidatePath('/productos');
    return ajustado;
  });
}

/**
 * Baja lógica. NO borra la fila: un producto puede estar en ventas viejas y
 * borrarlo rompería el histórico. Pasa a `is_active = false`.
 */
export async function deactivateProductAction(
  id: string
): Promise<ActionResult<null>> {
  return runAction(async () => {
    await softDeleteProduct(id);
    revalidatePath('/productos');
    return null;
  });
}
