/**
 * SaleService — operacion principal de Pandora ERP.
 *
 * Maneja el ciclo de vida de la venta:
 *   draft -> in_progress -> cobrando -> cobrada -> terminada
 *   (cancelable hasta cobrada)
 *
 * Y el ciclo fiscal:
 *   not_required (no requiere factura) | pending -> requesting -> issued
 *   (emision real a AFIP queda para Sprint 6+, gated por contador A-2)
 *
 * REGLAS:
 * - Stock se descuenta SOLO en finalize, atomicamente (UPDATE con guard SQL).
 * - State transitions validadas via domain/state-machines.
 * - Money math via Decimal.js + domain/calculation engine.
 *
 * AUDIT_LOG vs PINO LOG (EVENT-TAXONOMY §5 v2.0.2):
 *   - sale.completed (audit)    ← finalizeSale exitoso. Payload completo con
 *                                  items, totales, customer snapshot, payment.
 *                                  Esto es el evento que un contador necesita.
 *   - sale.cancelled (audit)    ← cancelSale.
 *   - Drafts, items add/update/remove, customer_set durante draft → Pino DEBUG.
 *     Son lifecycle interno operativo, no auditable. La info final del cliente
 *     y los items quedan en el payload de sale.completed.
 */
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { ZodType } from 'zod';
import { db } from '../../db/client.js';
import {
  type CommercialStatus,
  type FiscalStatus,
} from '../../db/schema/_common.js';
import { products, type UnitType } from '../../db/schema/products.js';
import { sale_items, sales, type Sale, type SaleItem } from '../../db/schema/sales.js';
import { sale_payments } from '../../db/schema/sale_payments.js';
import { cash_sessions } from '../../db/schema/cash_sessions.js';
import {
  recordStockMovement,
  OversellError,
  ProductInactiveError,
  ProductNotFoundForMovementError,
} from '../../inventory/index.js';
import {
  calculateSaleTotals,
  validateFiscalInvariant,
  type SaleItemInput,
} from '../../domain/calculation.js';
import {
  assertCommercialTransition,
  assertFiscalTransition,
} from '../../domain/state-machines.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { logger } from '../../observability/logger.js';
import {
  FiscalIntegrityError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from '../../multi_tenant/errors.js';
import {
  getCurrentCorrelationId,
  requireTenantId,
} from '../../tracing/context.js';
import { generateCorrelationId } from '../../tracing/ids.js';
import {
  AddItemInputSchema,
  CancelSaleInputSchema,
  FinalizeSaleInputSchema,
  RemoveItemInputSchema,
  SetCustomerInputSchema,
  UpdateItemQuantityInputSchema,
  type AddItemInput,
  type CancelSaleInput,
  type FinalizeSaleInput,
  type LegacyPaymentMethod,
  type PaymentItem,
  type RemoveItemInput,
  type SetCustomerInput,
  type UpdateItemQuantityInput,
} from './types.js';

export interface SaleWithItems {
  sale: Sale;
  items: SaleItem[];
}

/**
 * Helper para parsear input con Zod en boundary.
 * Si el schema falla, lanza ValidationError con field errors mapeados.
 *
 * Reemplaza el ad-hoc inicial (C-4 fix 2026-05-30) por ZodType<T>
 * tipado correctamente — la inferencia ahora funciona en toda llamada.
 */
function parse<T>(schema: ZodType<T>, raw: unknown, label: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      `Input invalido para ${label}`,
      Object.fromEntries(
        result.error.issues.map((i) => [i.path.join('.'), i.message])
      )
    );
  }
  return result.data;
}

async function getSaleByIdInternal(tenantId: string, saleId: string): Promise<Sale | null> {
  const result = await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, saleId)))
    .limit(1);
  return result[0] ?? null;
}

async function getSaleItemsInternal(
  tenantId: string,
  saleId: string
): Promise<SaleItem[]> {
  return db
    .select()
    .from(sale_items)
    .where(and(eq(sale_items.tenant_id, tenantId), eq(sale_items.sale_id, saleId)))
    .orderBy(sale_items.created_at);
}

/**
 * Sprint 5 Bloque 3 — denormalización de payments para `sales.payment_method`.
 *
 * - 1 method único en payments → ese method (efectivo|tarjeta|mp_qr)
 * - 2+ methods distintos → 'mixto'
 *
 * El detalle granular vive en sale_payments (1 row por payment). Este campo
 * existe para queries simples (dashboard "ventas por método de pago") sin
 * JOIN obligatorio.
 */
function computeDenormalizedPaymentMethod(
  payments: ReadonlyArray<Pick<PaymentItem, 'method'>>
): LegacyPaymentMethod {
  const uniqueMethods = new Set(payments.map((p) => p.method));
  if (uniqueMethods.size === 1) {
    // El único es 'efectivo' | 'tarjeta' | 'mp_qr' — todos son miembros de
    // PAYMENT_METHODS también (PAYMENT_METHODS = SALE_PAYMENT_METHODS + 'mixto').
    return payments[0]!.method;
  }
  return 'mixto';
}

/**
 * Sprint 5 Bloque 3 — payment_breakdown denormalizado JSON-compact.
 *
 * Sirve para reportes rápidos sin JOIN a sale_payments. Cap a 500 chars
 * (constraint column). Para multi-pago típico (1-3 items) cabe sin truncar;
 * si supera 500 chars, trunca con '...' suffix — el JSON queda inválido
 * pero el dato granular fiel sigue en sale_payments.
 */
function buildPaymentBreakdown(
  payments: ReadonlyArray<Pick<PaymentItem, 'method' | 'amount'>>
): string {
  const compact = payments.map((p) => ({ m: p.method, a: p.amount }));
  const json = JSON.stringify(compact);
  return json.length > 500 ? json.slice(0, 497) + '...' : json;
}

/**
 * Crea un draft de venta para `cashierUserId` en la caja `salePoint`.
 *
 * @param cashierUserId — usuario operador de la venta
 * @param salePoint — caja donde se hace la venta (default 1, retail TDF típico).
 *   F1+ trigger: cuando comerciante tenga 2+ cajas y POS UI requiera selección
 *   per-cajero al login. F0 acepta opcional para flexibilidad pero default 1.
 */
export async function createDraftSale(
  cashierUserId: string,
  salePoint: number = 1
): Promise<Sale> {
  const tenantId = requireTenantId();
  const correlationId = getCurrentCorrelationId() ?? generateCorrelationId();

  // Validación defense-in-depth: el CHECK constraint sales_sale_point_positive
  // también rechaza pero acá fallamos antes con error claro.
  if (!Number.isInteger(salePoint) || salePoint <= 0) {
    throw new ValidationError(
      `salePoint debe ser entero positivo (recibido ${salePoint})`,
      { sale_point: 'INVALID' }
    );
  }

  const [created] = await db
    .insert(sales)
    .values({
      tenant_id: tenantId,
      correlation_id: correlationId,
      cashier_user_id: cashierUserId,
      sale_point: salePoint,
      commercial_status: 'draft',
      fiscal_status: 'not_required',
    })
    .returning();

  if (!created) {
    throw new Error('Insert sale no devolvio fila');
  }

  // sale.draft.* lifecycle NO va a audit_log (EVENT-TAXONOMY §5 "Lo que NO va").
  // El evento auditable es sale.completed al finalizar — incluye toda la info.
  logger.debug(
    { sale_id: created.id, cashier_user_id: cashierUserId, sale_point: salePoint },
    'sale.draft.created'
  );
  return created;
}

export async function addItemToSale(rawInput: unknown): Promise<SaleWithItems> {
  const tenantId = requireTenantId();
  const input: AddItemInput = parse(AddItemInputSchema, rawInput, 'add_item');

  const sale = await getSaleByIdInternal(tenantId, input.sale_id);
  if (!sale) {
    throw new NotFoundError('Venta', input.sale_id);
  }

  if (sale.commercial_status === 'draft') {
    assertCommercialTransition('draft', 'in_progress');
  } else if (!['in_progress', 'cobrando'].includes(sale.commercial_status)) {
    throw new StateTransitionError(
      'sale.add_item',
      sale.commercial_status,
      'in_progress'
    );
  }

  const productRows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenant_id, tenantId),
        eq(products.id, input.product_id),
        eq(products.is_active, true)
      )
    )
    .limit(1);

  const product = productRows[0];
  if (!product) {
    throw new NotFoundError('Producto', input.product_id);
  }

  const unitPrice = input.unit_price_override ?? product.price;

  const itemInput: SaleItemInput = {
    product_id: product.id,
    product_name_snapshot: product.name,
    product_sku_snapshot: product.sku,
    unit_type: product.unit_type as UnitType,
    unit_price: unitPrice,
    quantity: input.quantity,
    tax_rate: product.tax_rate,
    tdf_exempt: product.tdf_exempt,
  };

  // Esto puede lanzar FiscalIntegrityError si quantity es decimal para unit_type entero.
  const calculated = calculateSaleTotals([itemInput]);
  const calculatedItem = calculated.items[0]!;

  await db.transaction(async (tx) => {
    await tx.insert(sale_items).values({
      sale_id: input.sale_id,
      tenant_id: tenantId,
      product_id: product.id,
      product_name_snapshot: calculatedItem.product_name_snapshot,
      product_sku_snapshot: calculatedItem.product_sku_snapshot,
      product_unit_type_snapshot: product.unit_type,
      unit_price: calculatedItem.unit_price,
      quantity: calculatedItem.quantity,
      tax_rate: calculatedItem.tax_rate,
      tdf_exempt: calculatedItem.tdf_exempt,
      line_subtotal: calculatedItem.line_subtotal,
      line_tax: calculatedItem.line_tax,
      line_total: calculatedItem.line_total,
    });

    if (sale.commercial_status === 'draft') {
      await tx
        .update(sales)
        .set({ commercial_status: 'in_progress', updated_at: new Date() })
        .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, input.sale_id)));
    } else {
      await tx
        .update(sales)
        .set({ updated_at: new Date() })
        .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, input.sale_id)));
    }
  });

  // sale.draft.* lifecycle NO va a audit_log.
  logger.debug(
    {
      sale_id: input.sale_id,
      product_id: product.id,
      quantity: input.quantity,
      line_total: calculatedItem.line_total,
    },
    'sale.draft.item_added'
  );

  return getSaleWithItems(input.sale_id);
}

export async function updateItemQuantity(rawInput: unknown): Promise<SaleWithItems> {
  const tenantId = requireTenantId();
  const input: UpdateItemQuantityInput = parse(
    UpdateItemQuantityInputSchema,
    rawInput,
    'update_quantity'
  );

  const sale = await getSaleByIdInternal(tenantId, input.sale_id);
  if (!sale) throw new NotFoundError('Venta', input.sale_id);

  if (!['in_progress', 'cobrando'].includes(sale.commercial_status)) {
    throw new StateTransitionError(
      'sale.update_item',
      sale.commercial_status,
      'in_progress'
    );
  }

  const itemRows = await db
    .select()
    .from(sale_items)
    .where(
      and(eq(sale_items.tenant_id, tenantId), eq(sale_items.id, input.item_id))
    )
    .limit(1);
  const item = itemRows[0];
  if (!item || item.sale_id !== input.sale_id) {
    throw new NotFoundError('Item de venta', input.item_id);
  }

  const recalculated = calculateSaleTotals([
    {
      product_id: item.product_id,
      product_name_snapshot: item.product_name_snapshot,
      product_sku_snapshot: item.product_sku_snapshot,
      unit_type: item.product_unit_type_snapshot as UnitType,
      unit_price: item.unit_price,
      quantity: input.quantity,
      tax_rate: item.tax_rate,
      tdf_exempt: item.tdf_exempt,
    },
  ]);
  const newCalc = recalculated.items[0]!;

  await db.transaction(async (tx) => {
    await tx
      .update(sale_items)
      .set({
        quantity: newCalc.quantity,
        line_subtotal: newCalc.line_subtotal,
        line_tax: newCalc.line_tax,
        line_total: newCalc.line_total,
      })
      .where(
        and(eq(sale_items.tenant_id, tenantId), eq(sale_items.id, input.item_id))
      );

    await tx
      .update(sales)
      .set({ updated_at: new Date() })
      .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, input.sale_id)));
  });

  logger.debug(
    {
      sale_id: input.sale_id,
      item_id: input.item_id,
      old_quantity: item.quantity,
      new_quantity: input.quantity,
    },
    'sale.draft.item_quantity_updated'
  );

  return getSaleWithItems(input.sale_id);
}

export async function removeItemFromSale(rawInput: unknown): Promise<SaleWithItems> {
  const tenantId = requireTenantId();
  const input: RemoveItemInput = parse(RemoveItemInputSchema, rawInput, 'remove_item');

  const sale = await getSaleByIdInternal(tenantId, input.sale_id);
  if (!sale) throw new NotFoundError('Venta', input.sale_id);

  if (!['in_progress', 'cobrando'].includes(sale.commercial_status)) {
    throw new StateTransitionError(
      'sale.remove_item',
      sale.commercial_status,
      'in_progress'
    );
  }

  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(sale_items)
      .where(
        and(
          eq(sale_items.tenant_id, tenantId),
          eq(sale_items.id, input.item_id),
          eq(sale_items.sale_id, input.sale_id)
        )
      )
      .returning();

    if (deleted.length === 0) {
      throw new NotFoundError('Item de venta', input.item_id);
    }

    await tx
      .update(sales)
      .set({ updated_at: new Date() })
      .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, input.sale_id)));
  });

  logger.debug(
    { sale_id: input.sale_id, item_id: input.item_id },
    'sale.draft.item_removed'
  );

  return getSaleWithItems(input.sale_id);
}

export async function setSaleCustomer(rawInput: unknown): Promise<Sale> {
  const tenantId = requireTenantId();
  const input: SetCustomerInput = parse(SetCustomerInputSchema, rawInput, 'set_customer');

  const sale = await getSaleByIdInternal(tenantId, input.sale_id);
  if (!sale) throw new NotFoundError('Venta', input.sale_id);

  // Sprint 5 Bloque 4 (advisor 2026-06-04): customer_snapshot inmutable
  // post-finalize. El guard original bloqueaba terminada/cancelada pero
  // NO cobrada — bug: después de finalizeSale, sale.commercial_status='cobrada'
  // y sale.customer_*_snapshot YA está congelado en el audit sale.completed +
  // en el ticket impreso. Modificarlo tarde violaría la inmutabilidad fiscal.
  // Solo permitimos setCustomer durante draft / in_progress / cobrando.
  if (!['draft', 'in_progress', 'cobrando'].includes(sale.commercial_status)) {
    throw new StateTransitionError(
      'sale.set_customer',
      sale.commercial_status,
      'in_progress'
    );
  }

  const [updated] = await db
    .update(sales)
    .set({
      customer_doc_type: input.doc_type,
      customer_doc_number: input.doc_number,
      customer_name_snapshot: input.name,
      customer_tax_condition_snapshot: input.tax_condition,
      updated_at: new Date(),
    })
    .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, input.sale_id)))
    .returning();

  if (!updated) throw new Error('Update set_customer no devolvio fila');

  // Customer durante draft NO va a audit. La snapshot final del customer
  // queda en el payload de sale.completed cuando se finaliza.
  logger.debug(
    {
      sale_id: input.sale_id,
      doc_type: input.doc_type,
      doc_number_masked: input.doc_number
        ? `${input.doc_number.slice(0, 2)}***${input.doc_number.slice(-2)}`
        : null,
    },
    'sale.draft.customer_set'
  );

  return updated;
}

export async function finalizeSale(rawInput: unknown): Promise<SaleWithItems> {
  const tenantId = requireTenantId();
  const input: FinalizeSaleInput = parse(
    FinalizeSaleInputSchema,
    rawInput,
    'finalize_sale'
  );

  const sale = await getSaleByIdInternal(tenantId, input.sale_id);
  if (!sale) throw new NotFoundError('Venta', input.sale_id);

  if (sale.commercial_status === 'draft') {
    throw new FiscalIntegrityError(
      'No se puede finalizar venta vacia. Agrega items primero.'
    );
  }

  if (sale.commercial_status !== 'in_progress' && sale.commercial_status !== 'cobrando') {
    throw new StateTransitionError(
      'sale.finalize',
      sale.commercial_status,
      'cobrada'
    );
  }

  const items = await getSaleItemsInternal(tenantId, input.sale_id);
  if (items.length === 0) {
    throw new FiscalIntegrityError('Venta sin items no se puede finalizar');
  }

  const totals = calculateSaleTotals(
    items.map((it) => ({
      product_id: it.product_id,
      product_name_snapshot: it.product_name_snapshot,
      product_sku_snapshot: it.product_sku_snapshot,
      unit_type: it.product_unit_type_snapshot as UnitType,
      unit_price: it.unit_price,
      quantity: it.quantity,
      tax_rate: it.tax_rate,
      tdf_exempt: it.tdf_exempt,
    }))
  );

  validateFiscalInvariant(totals);

  const initialFiscal: FiscalStatus = input.require_fiscal_invoice
    ? 'pending'
    : 'not_required';

  if (initialFiscal !== 'not_required') {
    assertFiscalTransition(sale.fiscal_status as FiscalStatus, initialFiscal);
  }

  if (sale.commercial_status === 'in_progress') {
    assertCommercialTransition('in_progress', 'cobrando');
    assertCommercialTransition('cobrando', 'cobrada');
  } else {
    assertCommercialTransition('cobrando', 'cobrada');
  }

  const stockMovementIds: string[] = [];

  await db.transaction(async (tx) => {
    for (const item of items) {
      // Sprint 5 Bloque 2 refactor (2026-06-04): usar recordStockMovement
      // con skip_audit:true en vez de UPDATE products directo. Razones:
      //   1. Inserta row en stock_movements (source of truth para Sprint 6
      //      fiscal — sin esto el modelo fiscal queda sin trazabilidad).
      //   2. Reusa SELECT FOR UPDATE de Sprint 3 (probado en T-INV-04
      //      oversell-concurrent — el guard atomic que ya funciona).
      //   3. Respeta BOUNDED-CONTEXTS: Sales depende de Inventory public API
      //      (recordStockMovement), no toca tabla products directo.
      //   4. Vincula sale.id ↔ stock_movement vía related_sale_id para que
      //      el auditor pueda reconstruir flujo de stock por venta.
      // Sales emite UN audit `sale.completed` con stock_movement_ids[] en
      // payload (regla J1 EVENT-TAXONOMY catálogo cerrado — movements NO
      // emiten audit propio cuando vienen orquestados desde Sales).
      try {
        const result = await recordStockMovement(
          {
            product_id: item.product_id,
            type: 'sale',
            qty: item.quantity,
            related_sale_id: input.sale_id,
            skip_audit: true,
          },
          tx
        );
        // bigint en JS — String() para que sea JSON-serializable en payload.
        stockMovementIds.push(String(result.movement.id));
      } catch (e) {
        // Mapeamos errores tipados de Inventory a errores del Sales context
        // para preservar el contrato del service (callers ya esperan
        // FiscalIntegrityError / NotFoundError, no OversellError directo).
        if (e instanceof OversellError) {
          throw new FiscalIntegrityError(
            `Stock insuficiente para ${item.product_name_snapshot}`,
            {
              product_id: item.product_id,
              requested: item.quantity,
              available: e.available,
            }
          );
        }
        if (e instanceof ProductNotFoundForMovementError) {
          throw new NotFoundError('Producto', item.product_id);
        }
        // Sprint 5 Bloque 4 (advisor 2026-06-04): race window — el producto
        // puede haberse desactivado entre addItemToSale (que filtra
        // is_active=true) y finalizeSale. recordStockMovement detecta la
        // desactivación en su SELECT FOR UPDATE y throws ProductInactiveError.
        // Mapeo a FiscalIntegrityError para preservar contrato del Sales
        // context (mismo patrón que OversellError).
        if (e instanceof ProductInactiveError) {
          throw new FiscalIntegrityError(
            `Producto "${item.product_name_snapshot}" fue desactivado entre el alta del item y el cobro. ` +
              `Reactivá el producto o quitalo de la venta para finalizarla.`,
            {
              product_id: item.product_id,
              product_name: item.product_name_snapshot,
            }
          );
        }
        throw e;
      }
    }

    // ─── Sprint 5 Bloque 3 — Sales↔Cash linkage ─────────────────────
    // Si hay payment efectivo Y existe cash_session activa para
    // (tenant, sale.sale_point), linkeamos cash_session_id. Si no hay
    // session activa, la venta finaliza igual con cash_session_id=null.
    // F1+ trigger: requerir cash_session abierta para aceptar efectivo
    // (más estricto contable, decisión owner cuando comerciante real
    // empiece a operar disciplina de caja diaria).
    let linkedCashSessionId: string | null = null;
    const hasCashPayment = input.payments.some((p) => p.method === 'efectivo');
    if (hasCashPayment) {
      const activeRows = await tx
        .select({ id: cash_sessions.id })
        .from(cash_sessions)
        .where(
          and(
            eq(cash_sessions.tenant_id, tenantId),
            eq(cash_sessions.sale_point, sale.sale_point),
            isNull(cash_sessions.closed_at)
          )
        )
        .limit(1);
      if (activeRows[0]) {
        linkedCashSessionId = activeRows[0].id;
      }
    }

    // ─── INSERT sale_payments (1 row por payment) ───────────────────
    // Granular per-method. Solo rows con method='efectivo' linkean
    // cash_session_id (tarjeta + mp_qr van por otros canales).
    const insertedPayments = await tx
      .insert(sale_payments)
      .values(
        input.payments.map((p) => ({
          tenant_id: tenantId,
          sale_id: input.sale_id,
          method: p.method,
          amount: p.amount,
          cash_session_id:
            p.method === 'efectivo' ? linkedCashSessionId : null,
          mp_payment_external_id: p.mp_payment_external_id ?? null,
        }))
      )
      .returning({
        id: sale_payments.id,
        method: sale_payments.method,
        amount: sale_payments.amount,
      });

    // ─── Denormalización para sales.payment_* (queries simples) ─────
    const denormalizedPaymentMethod = computeDenormalizedPaymentMethod(
      input.payments
    );
    const denormalizedPaymentBreakdown = buildPaymentBreakdown(input.payments);

    await tx
      .update(sales)
      .set({
        commercial_status: 'cobrada',
        fiscal_status: initialFiscal,
        subtotal: totals.subtotal,
        tax_amount: totals.tax_amount,
        exempt_amount: totals.exempt_amount,
        total: totals.total,
        payment_method: denormalizedPaymentMethod,
        payment_breakdown: denormalizedPaymentBreakdown,
        cash_session_id: linkedCashSessionId,
        finalized_at: new Date(),
        updated_at: new Date(),
      })
      .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, input.sale_id)));

    // sale.completed = evento canonico para contador/inspector.
    // Payload COMPLETO con info que un auditor necesitaria reconstruir la venta:
    // items + totales + IVA breakdown + customer snapshot + payment + cashier + fiscal status.
    await writeAuditLog(
      {
        event_name: 'sale.completed',
        payload: {
          sale_id: input.sale_id,
          cashier_user_id: sale.cashier_user_id,
          item_count: items.length,
          items: items.map((it) => ({
            product_id: it.product_id,
            product_name_snapshot: it.product_name_snapshot,
            product_sku_snapshot: it.product_sku_snapshot,
            quantity: it.quantity,
            unit_price: it.unit_price,
            tax_rate: it.tax_rate,
            tdf_exempt: it.tdf_exempt,
            line_subtotal: it.line_subtotal,
            line_tax: it.line_tax,
            line_total: it.line_total,
          })),
          subtotal: totals.subtotal,
          tax_amount: totals.tax_amount,
          exempt_amount: totals.exempt_amount,
          total: totals.total,
          iva_breakdown: totals.iva_breakdown,
          calculation_engine_version: totals.calculation_engine_version,
          tax_policy_version: totals.tax_policy_version,
          rounding_mode: totals.rounding_mode,
          rounding_stage: totals.rounding_stage,
          payment_method: denormalizedPaymentMethod,
          payment_breakdown: denormalizedPaymentBreakdown,
          // Sprint 5 Bloque 3: payments granulares en payload del audit.
          // Permite al auditor reconstruir el flujo de pagos sin JOIN a
          // sale_payments. Movements + payments + items son los 3 arrays
          // canónicos en sale.completed payload.
          payments: input.payments.map((p) => ({
            method: p.method,
            amount: p.amount,
            mp_payment_external_id: p.mp_payment_external_id ?? null,
          })),
          sale_payment_ids: insertedPayments.map((sp) => sp.id),
          cash_session_id: linkedCashSessionId,
          customer_doc_type: sale.customer_doc_type,
          customer_doc_number: sale.customer_doc_number,
          customer_name_snapshot: sale.customer_name_snapshot,
          customer_tax_condition_snapshot: sale.customer_tax_condition_snapshot,
          requires_fiscal: input.require_fiscal_invoice,
          initial_fiscal_status: initialFiscal,
          // Sprint 5 Bloque 2: IDs de stock_movements creados durante este
          // finalize. Permite al auditor cruzar `sale.completed` con
          // `stock_movements` para reconstruir el flujo de stock. Mantiene
          // J1 EVENT-TAXONOMY (Sales emite UN evento agregado, NO uno por
          // movement). Movements son bigint → String() para JSON serializable.
          stock_movement_ids: stockMovementIds,
        },
        pii_level: sale.customer_doc_number ? 'pii_low' : 'internal',
        severity: 'info',
      },
      tx
    );
  });

  logger.info(
    {
      sale_id: input.sale_id,
      total: totals.total,
      // Sprint 5 Bloque 3: log con cantidad de payments + methods únicos.
      // Detalle granular en el audit sale.completed; logs son operativos.
      payment_count: input.payments.length,
      payment_methods: Array.from(new Set(input.payments.map((p) => p.method))),
      requires_fiscal: input.require_fiscal_invoice,
    },
    'sale.completed'
  );

  return getSaleWithItems(input.sale_id);
}

export async function cancelSale(rawInput: unknown): Promise<Sale> {
  const tenantId = requireTenantId();
  const input: CancelSaleInput = parse(CancelSaleInputSchema, rawInput, 'cancel_sale');

  const sale = await getSaleByIdInternal(tenantId, input.sale_id);
  if (!sale) throw new NotFoundError('Venta', input.sale_id);

  assertCommercialTransition(sale.commercial_status as CommercialStatus, 'cancelada');

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(sales)
      .set({
        commercial_status: 'cancelada',
        cancellation_reason: input.reason,
        updated_at: new Date(),
      })
      .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, input.sale_id)))
      .returning();

    if (!row) throw new Error('Update cancel no devolvio fila');

    await writeAuditLog(
      {
        event_name: 'sale.cancelled',
        payload: {
          sale_id: input.sale_id,
          reason: input.reason,
          previous_status: sale.commercial_status,
        },
        pii_level: 'internal',
        severity: 'notice',
      },
      tx
    );

    return row;
  });

  logger.info(
    { sale_id: input.sale_id, reason: input.reason },
    'sale.cancelled'
  );
  return updated;
}

export async function getSaleWithItems(saleId: string): Promise<SaleWithItems> {
  const tenantId = requireTenantId();
  const sale = await getSaleByIdInternal(tenantId, saleId);
  if (!sale) throw new NotFoundError('Venta', saleId);
  const items = await getSaleItemsInternal(tenantId, saleId);
  return { sale, items };
}

export async function listRecentSales(limit: number = 10): Promise<Sale[]> {
  const tenantId = requireTenantId();
  return db
    .select()
    .from(sales)
    .where(and(eq(sales.tenant_id, tenantId), eq(sales.commercial_status, 'cobrada')))
    .orderBy(desc(sales.finalized_at))
    .limit(Math.min(limit, 100));
}

export async function listTodaySales(): Promise<Sale[]> {
  const tenantId = requireTenantId();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  return db
    .select()
    .from(sales)
    .where(
      and(
        eq(sales.tenant_id, tenantId),
        eq(sales.commercial_status, 'cobrada'),
        gte(sales.finalized_at, startOfDay)
      )
    )
    .orderBy(desc(sales.finalized_at));
}
