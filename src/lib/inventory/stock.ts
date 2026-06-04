/**
 * Stock service — movimientos atómicos con prevención de oversell.
 * Sprint 3 ROADMAP Inventory T-INV-04 (SELECT FOR UPDATE) + T-INV-05 (append-only).
 *
 * **Patrón Sprint 2 (audit-writer) + Sprint 3 #4 (products):** pure helpers
 * testeables sin DB + wrapper que orquesta tx (SELECT FOR UPDATE + INSERT
 * stock_movements + UPDATE products + audit_log) en UNA SOLA transacción.
 *
 * **SELECT FOR UPDATE — prevención de oversell concurrente:**
 * Dos cajeros venden simultáneamente el último item:
 *   T1: SELECT stock_current → 1
 *   T2: SELECT stock_current → 1
 *   T1: UPDATE stock_current = 0  ← OK
 *   T2: UPDATE stock_current = 0  ← OVERSELL (vendió uno que ya no existía)
 * Con SELECT FOR UPDATE: T2 bloquea hasta que T1 commit → relectura → throw
 * OversellError. Patrón canónico ADR-0006 (numeración fiscal) replicado acá.
 *
 * **Stock tracking opcional:**
 * `product.stock_tracking_enabled === false` (servicios, productos sin stock real)
 * skip todo el path stock — solo se registra movimiento informativo si caller
 * insiste (ej: ajuste contable). NO actualiza products.stock_current.
 *
 * **Append-only stock_movements:**
 * INSERT only. Trigger SQL (`stock_movements_immutable`, migration 0005)
 * bloquea UPDATE/DELETE. Cancelación = nuevo movimiento inverso (return/adjustment).
 *
 * **Reglas operativas por type:**
 * - `sale` → decrementa (related_sale_id obligatorio per CHECK constraint)
 * - `purchase` → incrementa (related_purchase_id opcional, F1+ sin FK)
 * - `return` → incrementa (cliente devuelve mercadería)
 * - `loss` → decrementa (rotura/vencimiento/robo — reason recomendado, no obligatorio)
 * - `adjustment` → puede ir en cualquier dirección, reason OBLIGATORIO (CHECK)
 *
 * **Fail-closed:** stock no puede quedar negativo F0 (oversell prohibido).
 * F1+ trigger: permitir backorder con flag explícito por producto.
 */
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { products, type Product } from '../db/schema/products.js';
import {
  stock_movements,
  type NewStockMovement,
  type StockMovement,
} from '../db/schema/stock_movements.js';
import { STOCK_MOVEMENT_TYPES, type StockMovementType } from '../db/schema/_common.js';
import { requireTracingContext } from '../tracing/context.js';
import type { TracingContext } from '../tracing/context.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';
import { isValidUuid } from '../tracing/ids.js';
import { writeAuditLog } from '../audit/audit-writer.js';
import { normalizeDecimal, ProductValidationError } from './products.js';

// ──── Errors tipados ────────────────────────────────────────────

export class StockValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_product_id'
      | 'invalid_qty'
      | 'invalid_type'
      | 'invalid_direction'
      | 'missing_reason_for_adjustment'
      | 'missing_related_sale_for_sale_type'
      | 'related_exclusive_violation',
    message: string
  ) {
    super(message);
    this.name = 'StockValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OversellError extends Error {
  constructor(
    public readonly product_id: string,
    public readonly available: string,
    public readonly requested: string
  ) {
    super(
      `OversellError: producto ${product_id} stock disponible=${available}, solicitado=${requested}`
    );
    this.name = 'OversellError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProductNotFoundForMovementError extends Error {
  constructor(public readonly product_id: string) {
    super(
      `ProductNotFoundForMovementError: producto ${product_id} no existe en tenant actual`
    );
    this.name = 'ProductNotFoundForMovementError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProductInactiveError extends Error {
  constructor(public readonly product_id: string) {
    super(
      `ProductInactiveError: producto ${product_id} is_active=false (soft deleted). Reactivar antes de mover stock.`
    );
    this.name = 'ProductInactiveError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ──── Direcciones del movimiento ────────────────────────────────

/**
 * Dirección física del movimiento sobre stock_current.
 * - `in` = suma (purchase, return, adjustment+)
 * - `out` = resta (sale, loss, adjustment-)
 *
 * Derivada en `inferDirection(type, explicitDirection?)`:
 * - `sale` | `loss` → siempre `out`
 * - `purchase` | `return` → siempre `in`
 * - `adjustment` → requiere `direction` explícito del caller
 */
export type MovementDirection = 'in' | 'out';

/**
 * Infiere dirección del tipo de movimiento. `adjustment` requiere explicit
 * direction del caller (puede ser sumar o restar según motivo del ajuste).
 *
 * @throws StockValidationError si type='adjustment' sin direction explícito
 */
export function inferDirection(
  type: StockMovementType,
  explicitDirection?: MovementDirection
): MovementDirection {
  switch (type) {
    case 'sale':
    case 'loss':
      return 'out';
    case 'purchase':
    case 'return':
      return 'in';
    case 'adjustment':
      if (explicitDirection === undefined) {
        throw new StockValidationError(
          'invalid_direction',
          `type='adjustment' requiere direction explícita ('in' o 'out')`
        );
      }
      return explicitDirection;
    default: {
      // Exhaustiveness check — si STOCK_MOVEMENT_TYPES crece, TS forza handle acá.
      const _exhaustive: never = type;
      throw new StockValidationError(
        'invalid_type',
        `type desconocido: ${String(_exhaustive)}`
      );
    }
  }
}

// ──── Inputs ────────────────────────────────────────────────────

export interface RecordMovementInput {
  product_id: string;
  type: StockMovementType;
  qty: string | number;            // siempre positiva (signo deriva de type+direction)
  reason?: string | null;          // obligatorio si type='adjustment'
  related_sale_id?: string | null; // obligatorio si type='sale'
  related_purchase_id?: string | null;
  /**
   * Sólo requerido para type='adjustment'. Para otros types se infiere.
   */
  direction?: MovementDirection;
  /**
   * Override del tenant_id (mismo patrón products / audit-writer).
   * SOLO permitido cuando actor_type === 'system' | 'support'.
   */
  override_tenant_id?: string;
  /**
   * Si true, recordStockMovement NO emite audit_log propio. El caller
   * (ej: Sales service Sprint 5) se hace cargo del audit con su evento
   * propio (`sale.completed`, etc.) incluyendo `stock_movement_id` en payload.
   *
   * Esto evita doble audit y cumple regla J1 EVENT-TAXONOMY (catálogo cerrado:
   * no agregar 'stock.sale_decremented' etc — el audit del negocio lo lleva
   * el dominio de la venta/compra/devolución).
   *
   * **F0:** se emite `stock.adjusted_manually` SOLO para type='adjustment'.
   * Para otros types sin skip_audit → throw (forzamos al caller a manejarlo).
   */
  skip_audit?: boolean;
}

// ──── Pure validators (testeables sin DB) ──────────────────────

/**
 * Computa el próximo `stock_current` aplicando un movimiento.
 * Pure math — sin side effects, sin DB.
 *
 * Usa string aritmética para evitar imprecisión de float JS sobre numeric(19,4)
 * de Postgres. NO usa Decimal.js acá (sería over-engineering — la cantidad
 * de stock no requiere semántica fiscal de Decimal.js, mientras precisión 4
 * sea suficiente).
 *
 * F1+ trigger: si aparece operación con stock que requiera Decimal.js
 * (ej: lote con conversión de unidades), migrar acá.
 */
export function computeNextStockCurrent(
  current: string,
  qty: string,
  direction: MovementDirection
): string {
  // Trabajamos en "milidécimas" (entero) para evitar float drift.
  // numeric(19,4) → multiplicamos por 10000 para entero exacto.
  //
  // **Inputs pre-validados:** `current` viene de products.stock_current
  // (numeric DB normalizada) y `qty` ya pasó por normalizeDecimal strict
  // (regex check Sprint 3 #4). parseFloat acá es seguro — NO replicar el
  // patrón strict de products.ts (sería redundante).
  //
  // **Límite de escala:** Number.MAX_SAFE_INTEGER / 10000 ≈ 9e11 unidades.
  // Sobra para retail TDF (kioscos con stock < 10k). F1+ trigger: si emerge
  // mayorista/industria con stock > 1e8 unidades, migrar a BigInt.
  const SCALE = 10000;

  const currentInt = Math.round(parseFloat(current) * SCALE);
  const qtyInt = Math.round(parseFloat(qty) * SCALE);

  if (!Number.isFinite(currentInt) || !Number.isFinite(qtyInt)) {
    throw new StockValidationError(
      'invalid_qty',
      `computeNextStockCurrent: valores no parseables current="${current}" qty="${qty}"`
    );
  }

  const nextInt = direction === 'in' ? currentInt + qtyInt : currentInt - qtyInt;
  return (nextInt / SCALE).toFixed(4);
}

/**
 * Detecta oversell — intento de decrementar más stock del disponible.
 * Pure check — true si el movimiento NO genera oversell.
 *
 * Usa misma estrategia entera (escala 10000) para evitar float drift.
 */
export function isOversell(
  current: string,
  qty: string,
  direction: MovementDirection
): boolean {
  if (direction === 'in') return false;
  const SCALE = 10000;
  const currentInt = Math.round(parseFloat(current) * SCALE);
  const qtyInt = Math.round(parseFloat(qty) * SCALE);
  return qtyInt > currentInt;
}

/**
 * Valida + normaliza input para INSERT a stock_movements. Pure helper.
 *
 * @throws StockValidationError si input inválido
 * @throws CrossTenantAccessError si override_tenant_id no autorizado
 */
export function prepareStockMovementValues(
  input: RecordMovementInput,
  ctx: TracingContext
): NewStockMovement {
  // ──── product_id UUID format ───────────
  if (!isValidUuid(input.product_id)) {
    throw new StockValidationError(
      'invalid_product_id',
      `product_id no es UUID válido ("${input.product_id}")`
    );
  }

  // ──── type del catálogo ───────────
  if (!STOCK_MOVEMENT_TYPES.includes(input.type)) {
    throw new StockValidationError(
      'invalid_type',
      `type "${input.type}" no válido. Valores: ${STOCK_MOVEMENT_TYPES.join(', ')}`
    );
  }

  // ──── qty > 0 (signo deriva de type + direction) ───────────
  // Reusa el normalizeDecimal strict de products (Number + regex strict).
  // Convertimos ProductValidationError → StockValidationError para superficie
  // pública consistente (caller atrapa SOLO StockValidationError|CrossTenant).
  let qty: string;
  try {
    qty = normalizeDecimal(input.qty, 'stock_current', 4);
  } catch (e) {
    if (e instanceof ProductValidationError) {
      throw new StockValidationError('invalid_qty', e.message);
    }
    throw e;
  }
  if (parseFloat(qty) <= 0) {
    throw new StockValidationError(
      'invalid_qty',
      `qty debe ser > 0 (recibido ${qty}). El signo se deriva del type+direction.`
    );
  }

  // ──── reason obligatorio si adjustment (defense layered: CHECK + service) ───────
  if (input.type === 'adjustment') {
    const reason = (input.reason ?? '').trim();
    if (reason.length === 0) {
      throw new StockValidationError(
        'missing_reason_for_adjustment',
        `type='adjustment' requiere reason no vacío (motivo del ajuste). CHECK constraint en DB también enforce.`
      );
    }
  }

  // ──── sale type requiere related_sale_id (defense layered: CHECK + service) ────
  if (input.type === 'sale') {
    const saleId = input.related_sale_id;
    if (!saleId || !isValidUuid(saleId)) {
      throw new StockValidationError(
        'missing_related_sale_for_sale_type',
        `type='sale' requiere related_sale_id UUID válido`
      );
    }
  }

  // ──── related_sale_id y related_purchase_id mutuamente exclusivos ─────────────
  if (input.related_sale_id && input.related_purchase_id) {
    throw new StockValidationError(
      'related_exclusive_violation',
      `related_sale_id y related_purchase_id son mutuamente exclusivos`
    );
  }

  // ──── skip_audit contract guard (advisor 2026-06-03) ───────
  // Caller que pasa type != 'adjustment' DEBE setear skip_audit=true (porque
  // emite su evento de negocio propio — ej: Sales emite 'sale.completed').
  // Falla acá, ANTES de cualquier mutation, para no desperdiciar DB roundtrip
  // ni tener el lock SELECT FOR UPDATE durante writes que rollback.
  // TODO(F1+): cuando aparezca caller manual para 'loss' (POS UI registra
  // pérdida sin venta asociada), evaluar:
  //   (A) reusar 'stock.adjusted_manually' con convención reason obligatorio
  //   (B) proposal agregar 'stock.loss_recorded' al catálogo EVENT-TAXONOMY
  if (input.skip_audit !== true && input.type !== 'adjustment') {
    throw new StockValidationError(
      'invalid_type',
      `type='${input.type}' requiere caller que emita audit propio (skip_audit=true). Catálogo F0 EVENT-TAXONOMY solo cubre 'stock.adjusted_manually'.`
    );
  }

  // ──── Multi-tenant guard (override_tenant_id) ───────
  if (input.override_tenant_id !== undefined) {
    if (!isValidUuid(input.override_tenant_id)) {
      throw new CrossTenantAccessError(
        input.override_tenant_id,
        ctx.tenant_id,
        'stock.movement.override_tenant_id (UUID format inválido)'
      );
    }
    if (ctx.actor_type !== 'system' && ctx.actor_type !== 'support') {
      throw new CrossTenantAccessError(
        input.override_tenant_id,
        ctx.tenant_id,
        'stock.movement.override_tenant_id'
      );
    }
  }

  const tenant_id = input.override_tenant_id ?? ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'stock.movement: tenant_id ausente en context y sin override'
    );
  }

  return {
    tenant_id,
    product_id: input.product_id,
    type: input.type,
    qty,
    reason: input.reason?.trim() || null,
    related_sale_id: input.related_sale_id ?? null,
    related_purchase_id: input.related_purchase_id ?? null,
    created_by: ctx.actor_user_id ?? null,
    correlation_id: ctx.correlation_id ?? null,
  };
}

// ──── Service wrapper ─────────────────────────────────────────

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface RecordMovementResult {
  movement: StockMovement;
  product: Product;       // producto actualizado (stock_current post-movimiento)
  stock_changed: boolean; // false si stock_tracking_enabled=false
}

/**
 * Registra un movimiento de stock atómicamente:
 *   1. SELECT FOR UPDATE products WHERE id=$1 AND tenant_id=$2 (anti-oversell)
 *   2. Validar is_active + computar next stock_current
 *   3. Validar no oversell (fail-closed F0)
 *   4. INSERT stock_movements (append-only)
 *   5. UPDATE products.stock_current (si stock_tracking_enabled)
 *   6. audit_log emit (mismo tx)
 *
 * Si `stock_tracking_enabled === false` → skip pasos 3 y 5 (solo registra
 * movimiento informativo + audit, NO actualiza stock_current).
 *
 * @throws StockValidationError input inválido
 * @throws CrossTenantAccessError multi-tenant guard fail
 * @throws ProductNotFoundForMovementError producto no existe en tenant actual
 * @throws ProductInactiveError producto is_active=false
 * @throws OversellError stock insuficiente para decremento
 */
export async function recordStockMovement(
  input: RecordMovementInput,
  txOrDb: DbOrTransaction = db
): Promise<RecordMovementResult> {
  const ctx = requireTracingContext();
  const direction = inferDirection(input.type, input.direction);
  const values = prepareStockMovementValues(input, ctx);

  const runInTx = async (
    tx: DbOrTransaction
  ): Promise<RecordMovementResult> => {
    // ──── (1) SELECT FOR UPDATE — lock pesimista anti-oversell ────
    const lockedRows = await tx
      .select()
      .from(products)
      .where(
        and(eq(products.id, values.product_id), eq(products.tenant_id, values.tenant_id))
      )
      .for('update')
      .limit(1);

    const product = lockedRows[0];
    if (!product) {
      throw new ProductNotFoundForMovementError(values.product_id);
    }
    if (!product.is_active) {
      throw new ProductInactiveError(values.product_id);
    }

    // ──── (2) Computar próximo stock_current ────
    const stock_tracking = product.stock_tracking_enabled;
    let next_stock_current = product.stock_current;
    let stock_changed = false;

    if (stock_tracking) {
      // ──── (3) Validar oversell (fail-closed F0) ────
      if (isOversell(product.stock_current, values.qty, direction)) {
        throw new OversellError(
          values.product_id,
          product.stock_current,
          values.qty
        );
      }
      next_stock_current = computeNextStockCurrent(
        product.stock_current,
        values.qty,
        direction
      );
      stock_changed = true;
    }

    // ──── (4) INSERT stock_movements (append-only) ────
    const inserted = await tx
      .insert(stock_movements)
      .values(values)
      .returning();
    if (inserted.length === 0) {
      throw new Error('recordStockMovement: INSERT no devolvió row (esperado .returning())');
    }
    const movement = inserted[0]!;

    // ──── (5) UPDATE products.stock_current (si tracking) ────
    let updated_product = product;
    if (stock_changed) {
      const updatedRows = await tx
        .update(products)
        .set({ stock_current: next_stock_current, updated_at: sql`now()` })
        .where(
          and(eq(products.id, values.product_id), eq(products.tenant_id, values.tenant_id))
        )
        .returning();
      if (updatedRows.length === 0) {
        throw new Error('recordStockMovement: UPDATE products no devolvió row');
      }
      updated_product = updatedRows[0]!;
    }

    // ──── (6) audit_log — regla J1 EVENT-TAXONOMY (catálogo cerrado) ────
    // Contrato validado en prepareStockMovementValues (skip_audit guard).
    // Acá solo emit cuando type='adjustment' && !skip_audit.
    if (!input.skip_audit && movement.type === 'adjustment') {
      await writeAuditLog(
        {
          event_name: 'stock.adjusted_manually',
          payload: {
            movement_id: String(movement.id),
            product_id: movement.product_id,
            direction,
            qty: movement.qty,
            stock_current_before: product.stock_current,
            stock_current_after: next_stock_current,
            stock_changed,
            reason: movement.reason,
          },
          pii_level: 'internal',
          severity: 'info',
          ...(input.override_tenant_id !== undefined && {
            override_tenant_id: input.override_tenant_id,
          }),
        },
        tx
      );
    }

    return { movement, product: updated_product, stock_changed };
  };

  if (txOrDb === db) {
    return await db.transaction(runInTx);
  }
  return await runInTx(txOrDb);
}
