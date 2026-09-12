/**
 * ProductService — operaciones sobre el catalogo de productos.
 *
 * ⚠️ MÓDULO NO WIREADO (verificado 2026-09-02). Nadie importa este servicio,
 * ni siquiera un test — el módulo de productos vivo es `src/lib/inventory/`
 * (el POS usa `listProductsPaginated` de `inventory/queries.ts`).
 * NO borrar: acá viven `updateProduct` y `softDeleteProduct`, que `inventory/`
 * todavía no tiene. Consolidar con `inventory/` cuando se porte la pantalla
 * Productos. Ver QUEUE.md (SRS).
 *
 * REGLAS:
 * - Toda operacion requiere tenant_id en tracing context (requireTenantId()).
 * - Mutaciones fiscalmente sensibles escriben audit_log (EVENT-TAXONOMY §5 v2.0.2):
 *     - product.created
 *     - product.deactivated
 *     - product.price_changed       (price afecta valuacion + facturas futuras)
 *     - product.tax_rate_changed    (afecta alicuota IVA)
 *     - product.tdf_exempt_changed  (afecta facturacion Ley 19.640)
 *     - product.bulk_imported
 *     - stock.adjusted_manually     (ajuste manual con motivo)
 * - Mutaciones triviales (name, description, sku, barcode, stock_minimum,
 *   unit_type, stock_tracking_enabled, is_active no-deactivation) → Pino debug.
 * - Validaciones de input via Zod en boundary, NUNCA aca.
 * - Money math via Decimal.js (nunca Number).
 */
import { and, desc, eq, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { products, type Product } from '../../db/schema/products.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { logger } from '../../observability/logger.js';
import { money, moneyAdd, moneyEq, moneyToStorage } from '../../money/decimal.js';
import {
  FiscalIntegrityError,
  NotFoundError,
  ValidationError,
} from '../../multi_tenant/errors.js';
import { requireTenantId } from '../../tracing/context.js';
import {
  recordStockMovement,
  recordOpeningStock,
  OversellError,
  ProductInactiveError,
  ProductNotFoundForMovementError,
  StockValidationError,
  type MovementDirection,
} from '../../inventory/stock.js';
import {
  CreateProductInputSchema,
  SearchProductsInputSchema,
  StockAdjustmentInputSchema,
  UpdateProductInputSchema,
  type CreateProductInput,
  type SearchProductsInput,
  type StockAdjustmentInput,
  type UpdateProductInput,
} from './types.js';

async function getByIdInternal(tenantId: string, id: string): Promise<Product | null> {
  const result = await db
    .select()
    .from(products)
    .where(and(eq(products.tenant_id, tenantId), eq(products.id, id)))
    .limit(1);

  return result[0] ?? null;
}

export async function createProduct(rawInput: unknown): Promise<Product> {
  const tenantId = requireTenantId();

  const parsed = CreateProductInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(
      'Datos de producto invalidos',
      Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.'), i.message])
      )
    );
  }
  const input: CreateProductInput = parsed.data;

  // ── El stock del alta entra por el LIBRO, no por la columna ──────────────
  //
  // Escribir `stock_current` directo en el INSERT dejaba unidades que ningún
  // movimiento explica: el stock de hoy no se reconstruye sumando el libro, y
  // entonces tampoco se puede decir cuánto había a una fecha pasada — que es
  // todo lo que el inventario valorizado al cierre necesita. Ver
  // `recordOpeningStock` y la migration 0035.
  //
  // Dos condiciones, y las dos importan:
  //  - `> 0`: un alta en cero no tiene nada que declarar.
  //  - `stock_tracking_enabled`: sin tracking, `recordStockMovement` registra el
  //    movimiento pero NO toca `stock_current` (es deliberado). Abrir el libro
  //    ahí dejaría la columna en 0 y el libro en N: el mismo descuadre al revés.
  const stockInicial = money(input.stock_current);
  const abreLibro = stockInicial.gt(0) && input.stock_tracking_enabled;

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({
        tenant_id: tenantId,
        name: input.name,
        description: input.description,
        sku: input.sku,
        barcode: input.barcode,
        // OJO: este .values() ENUMERA los campos, no hace spread. Un campo
        // nuevo que pase el Zod pero falte aca se descarta EN SILENCIO
        // (validacion OK, insert OK, dato perdido). Ver T-INV-09.
        category: input.category,
        unit_type: input.unit_type,
        price: input.price,
        cost: input.cost,
        tax_rate: input.tax_rate,
        tdf_exempt: input.tdf_exempt,
        // Si el libro se abre, la columna arranca en cero y la mueve el
        // movimiento. Escribirla acá TAMBIÉN la dejaría contada dos veces.
        stock_current: abreLibro ? '0' : input.stock_current,
        stock_minimum: input.stock_minimum,
        stock_tracking_enabled: input.stock_tracking_enabled,
        // El movimiento de apertura se rechaza sobre un producto inactivo
        // (`ProductInactiveError`, y está bien que así sea). Un alta inactiva
        // CON stock existe — importar mercadería de algo discontinuado — así
        // que la baja se aplica DESPUÉS de abrir el libro, unas líneas abajo.
        // El estado intermedio no sale de esta transacción.
        is_active: abreLibro ? true : input.is_active,
      })
      .returning();

    if (!row) {
      throw new Error('Insert de producto no devolvio fila');
    }

    let filaFinal = row;

    if (abreLibro) {
      const { product } = await recordOpeningStock(
        { product_id: row.id, qty: moneyToStorage(stockInicial) },
        tx
      );
      filaFinal = product;

      if (!input.is_active) {
        const [dadoDeBaja] = await tx
          .update(products)
          .set({ is_active: false, updated_at: new Date() })
          .where(and(eq(products.tenant_id, tenantId), eq(products.id, row.id)))
          .returning();
        if (dadoDeBaja) filaFinal = dadoDeBaja;
      }
    }

    await writeAuditLog(
      {
        event_name: 'product.created',
        payload: {
          product_id: row.id,
          name: row.name,
          sku: row.sku,
          barcode: row.barcode,
          price: row.price,
          tdf_exempt: row.tdf_exempt,
          // El stock del alta va acá y NO como `stock.adjusted_manually`: un
          // alta no es un ajuste manual del comerciante. Sin este campo, el
          // audit no diría con cuánta mercadería entró el producto.
          stock_inicial: filaFinal.stock_current,
        },
        pii_level: 'internal',
        severity: 'info',
      },
      tx
    );

    return filaFinal;
  });

  logger.info({ product_id: created.id, name: created.name }, 'product.created');
  return created;
}

export async function updateProduct(
  id: string,
  rawInput: unknown
): Promise<Product> {
  const tenantId = requireTenantId();

  // Zod descarta las claves que no conoce, así que sin este chequeo un
  // `stock_current` que llegue igual se ignoraría EN SILENCIO: el que lo mandó
  // creería que movió el stock. Se rechaza fuerte y se dice por dónde va.
  // (Se acepta `undefined` a propósito: la pantalla manda el campo en undefined
  // al editar, que es la forma de decir "no toco el stock".)
  if (
    rawInput !== null &&
    typeof rawInput === 'object' &&
    (rawInput as { stock_current?: unknown }).stock_current !== undefined
  ) {
    throw new ValidationError('Datos de actualizacion invalidos', {
      stock_current:
        'El stock no se edita: se mueve con un ajuste y su motivo, o con una compra, para que quede el rastro de por qué cambió',
    });
  }

  const parsed = UpdateProductInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(
      'Datos de actualizacion invalidos',
      Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.'), i.message])
      )
    );
  }
  const input: UpdateProductInput = parsed.data;

  const existing = await getByIdInternal(tenantId, id);
  if (!existing) {
    throw new NotFoundError('Producto', id);
  }

  const cleanInput = stripUndefined(input);

  if (Object.keys(cleanInput).length === 0) {
    logger.debug({ product_id: id }, 'product.update.noop');
    return existing;
  }

  const sensitiveChanges = detectSensitiveChanges(existing, cleanInput);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(products)
      .set({
        ...cleanInput,
        updated_at: new Date(),
      })
      .where(and(eq(products.tenant_id, tenantId), eq(products.id, id)))
      .returning();

    if (!row) {
      throw new NotFoundError('Producto', id);
    }

    for (const change of sensitiveChanges) {
      await writeAuditLog(
        {
          event_name: change.event_name,
          payload: {
            product_id: id,
            product_name: row.name,
            old_value: change.old_value,
            new_value: change.new_value,
          },
          pii_level: 'internal',
          severity: change.severity,
        },
        tx
      );
    }

    return row;
  });

  if (sensitiveChanges.length > 0) {
    logger.info(
      {
        product_id: id,
        sensitive_changes: sensitiveChanges.map((c) => c.field),
      },
      'product.updated.sensitive'
    );
  } else {
    logger.debug(
      { product_id: id, fields_changed: Object.keys(cleanInput) },
      'product.updated.trivial'
    );
  }

  return updated;
}

type SensitiveChange =
  | {
      field: 'price';
      event_name: 'product.price_changed';
      severity: 'notice';
      old_value: string;
      new_value: string;
    }
  | {
      field: 'tax_rate';
      event_name: 'product.tax_rate_changed';
      severity: 'warning';
      old_value: string;
      new_value: string;
    }
  | {
      field: 'tdf_exempt';
      event_name: 'product.tdf_exempt_changed';
      severity: 'warning';
      old_value: boolean;
      new_value: boolean;
    };

function detectSensitiveChanges(
  existing: Product,
  changes: Partial<UpdateProductInput>
): ReadonlyArray<SensitiveChange> {
  const out: SensitiveChange[] = [];

  if (changes.price !== undefined && !moneyEq(existing.price, changes.price)) {
    out.push({
      field: 'price',
      event_name: 'product.price_changed',
      severity: 'notice',
      old_value: existing.price,
      new_value: changes.price,
    });
  }

  if (
    changes.tax_rate !== undefined &&
    !moneyEq(existing.tax_rate, changes.tax_rate)
  ) {
    out.push({
      field: 'tax_rate',
      event_name: 'product.tax_rate_changed',
      severity: 'warning',
      old_value: existing.tax_rate,
      new_value: changes.tax_rate,
    });
  }

  if (
    changes.tdf_exempt !== undefined &&
    existing.tdf_exempt !== changes.tdf_exempt
  ) {
    out.push({
      field: 'tdf_exempt',
      event_name: 'product.tdf_exempt_changed',
      severity: 'warning',
      old_value: existing.tdf_exempt,
      new_value: changes.tdf_exempt,
    });
  }

  return out;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

export async function getProductById(id: string): Promise<Product> {
  const tenantId = requireTenantId();
  const product = await getByIdInternal(tenantId, id);
  if (!product) {
    throw new NotFoundError('Producto', id);
  }
  return product;
}

export async function findProductByBarcode(barcode: string): Promise<Product | null> {
  const tenantId = requireTenantId();

  const result = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenant_id, tenantId),
        eq(products.barcode, barcode),
        eq(products.is_active, true)
      )
    )
    .limit(1);

  return result[0] ?? null;
}

export async function searchProducts(rawInput: unknown): Promise<Product[]> {
  const tenantId = requireTenantId();

  const parsed = SearchProductsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(
      'Busqueda invalida',
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]))
    );
  }
  const input: SearchProductsInput = parsed.data;

  const pattern = `%${input.query.replace(/[%_]/g, '\\$&')}%`;

  return db
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenant_id, tenantId),
        eq(products.is_active, true),
        or(
          ilike(products.name, pattern),
          ilike(products.sku, pattern),
          ilike(products.barcode, pattern)
        )
      )
    )
    .orderBy(desc(products.updated_at))
    .limit(input.limit);
}

export async function listLowStockProducts(): Promise<Product[]> {
  const tenantId = requireTenantId();

  return db
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenant_id, tenantId),
        eq(products.is_active, true),
        eq(products.stock_tracking_enabled, true),
        sql`${products.stock_minimum} IS NOT NULL`,
        lte(products.stock_current, products.stock_minimum)
      )
    )
    .orderBy(products.stock_current);
}

/**
 * Ajuste manual de stock.
 *
 * **Delega en `recordStockMovement`.** Antes esta función hacía su propio
 * UPDATE de `products.stock_current` + audit, sin escribir nunca en
 * `stock_movements` — el libro append-only que existe justamente para poder
 * reconstruir el stock a una fecha pasada.
 *
 * El agujero era LATENTE, no estaba perdiendo datos: `adjustStockAction` está
 * definida en `src/app/productos/actions.ts` pero ningún componente la llama
 * todavía, así que no hubo ajustes reales sin registrar (medido:
 * `stock_movements` tenía 27 filas, todas `type='sale'`). Se arregla ahora,
 * antes de cablear la pantalla, porque después cada ajuste que entrara por ahí
 * sería un hueco imposible de backfillear.
 *
 * `recordStockMovement` hace lo mismo y tres cosas más, todas en una sola
 * transacción: toma el lock `SELECT FOR UPDATE` sobre el producto (dos ajustes
 * simultáneos ya no se pisan), inserta el movimiento append-only, y respeta
 * `stock_tracking_enabled`.
 *
 * **Traducción de errores.** Los errores de `src/lib/inventory` son `Error`
 * planas, y el boundary (`runAction` en `src/app/productos/actions.ts`) solo
 * sabe convertir `DomainError` en un mensaje para la pantalla: cualquier otra
 * cosa se relanza y queda sin manejar. Por eso se traducen acá, en el service,
 * que es donde ya vivía ese contrato. Los mensajes son los mismos que antes.
 *
 * **Cambios de comportamiento** respecto de la versión anterior, los tres a
 * favor de la corrección y cubiertos en T-INV-10:
 *   - producto dado de baja: antes se le podía ajustar el stock, ahora no.
 *   - `stock_tracking_enabled = false`: antes movía el número igual, ahora
 *     registra el movimiento y deja el stock quieto (que es lo que el flag
 *     significa).
 *   - `delta = 0`: antes escribía una línea de auditoría diciendo que no pasó
 *     nada, ahora se rechaza.
 */
export async function adjustStock(rawInput: unknown): Promise<Product> {
  // Fail-fast del tenant en el boundary del service. `recordStockMovement` lo
  // vuelve a exigir desde el tracing context — es a propósito, no redundancia
  // accidental: acá se falla con el error de siempre antes de tocar nada.
  requireTenantId();

  const parsed = StockAdjustmentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(
      'Ajuste de stock invalido',
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]))
    );
  }
  const input: StockAdjustmentInput = parsed.data;

  const delta = money(input.delta);

  if (delta.isZero()) {
    throw new ValidationError('Ajuste de stock invalido', {
      delta: 'Un ajuste de 0 no cambia nada. Indica cuanto sumar o restar.',
    });
  }

  // El ledger guarda `qty` siempre positiva y el signo aparte (migration 0032).
  // El delta que manda la pantalla trae las dos cosas juntas, así que acá se
  // separan: el signo va a `direction` y el valor absoluto a `qty`.
  const direction: MovementDirection = delta.isNegative() ? 'out' : 'in';

  try {
    const { product } = await recordStockMovement({
      product_id: input.product_id,
      type: 'adjustment',
      qty: moneyToStorage(delta.abs()),
      direction,
      reason: input.reason,
    });

    logger.info(
      {
        product_id: input.product_id,
        delta: delta.toString(),
        new_stock: product.stock_current,
        reason: input.reason,
      },
      'stock.adjusted_manually'
    );

    return product;
  } catch (e) {
    if (e instanceof ProductNotFoundForMovementError) {
      throw new NotFoundError('Producto', input.product_id);
    }
    if (e instanceof ProductInactiveError) {
      throw new ValidationError('Ajuste de stock invalido', {
        product_id:
          'El producto esta dado de baja. Reactivalo antes de ajustar su stock.',
      });
    }
    if (e instanceof OversellError) {
      throw new FiscalIntegrityError(
        'Stock final no puede ser negativo. Verifica delta vs stock actual.',
        {
          product_id: input.product_id,
          current: e.available,
          delta: delta.toString(),
          requested: e.requested,
        }
      );
    }
    if (e instanceof StockValidationError) {
      throw new ValidationError('Ajuste de stock invalido', { delta: e.message });
    }
    throw e;
  }
}

export async function softDeleteProduct(id: string): Promise<void> {
  const tenantId = requireTenantId();

  const existing = await getByIdInternal(tenantId, id);
  if (!existing) {
    throw new NotFoundError('Producto', id);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({ is_active: false, updated_at: new Date() })
      .where(and(eq(products.tenant_id, tenantId), eq(products.id, id)));

    await writeAuditLog(
      {
        event_name: 'product.deactivated',
        payload: { product_id: id, name: existing.name },
        pii_level: 'internal',
        severity: 'notice',
      },
      tx
    );
  });

  logger.info({ product_id: id }, 'product.deactivated');
}
