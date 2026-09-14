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
import {
  listProductMovements,
  type HistorialDelProducto,
} from '@/lib/inventory/queries';

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
 * Ajuste manual de stock — lo llama `AjusteStockModal`.
 *
 * **`delta`, no valor absoluto.** Se manda cuánto SUMAR o RESTAR (`"-3"`,
 * `"10"`), no el stock final. Es a propósito: si dos personas ajustan casi al
 * mismo tiempo, dos deltas se acumulan bien y dos absolutos se pisan. Además
 * el service toma un lock sobre el producto, así que ni siquiera se solapan.
 *
 * **Motivo de una lista cerrada** (`domain/ajuste-stock.ts`, migration 0038):
 * merma (rotura / vencimiento / robo) queda como `loss` y sólo resta;
 * corrección (recuento / error de carga / otro) como `adjustment`. El detalle
 * es opcional salvo en "otro". El movimiento queda en `stock_movements`
 * (append-only) y se audita con `stock.adjusted_manually`.
 *
 * Historia: hasta la migration 0032 este comentario afirmaba que el
 * movimiento quedaba registrado y `adjustStock` no escribía una sola fila. Se
 * deja dicho porque es el tipo de comentario que hace invisible un agujero.
 */
export async function adjustStockAction(input: {
  productId: string;
  delta: string;
  motivo: string;
  detalle?: string;
}): Promise<ActionResult<Product>> {
  return runAction(async () => {
    const ajustado = await adjustStock({
      product_id: input.productId,
      delta: input.delta,
      motivo: input.motivo,
      detalle: input.detalle,
    });
    revalidatePath('/productos');
    return ajustado;
  });
}

/**
 * Historial de movimientos de un producto — lo pide `HistorialModal` al
 * abrirse. Ordenado por el día en que pasó cada movimiento (no el de carga), y
 * con los dos cuando difieren. Ver `listProductMovements`.
 */
export async function getHistorialAction(
  productId: string
): Promise<ActionResult<HistorialDelProducto>> {
  return runAction(() => listProductMovements(productId));
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
