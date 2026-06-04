/**
 * ProductService — operaciones sobre el catalogo de productos.
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

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({
        tenant_id: tenantId,
        name: input.name,
        description: input.description,
        sku: input.sku,
        barcode: input.barcode,
        unit_type: input.unit_type,
        price: input.price,
        cost: input.cost,
        tax_rate: input.tax_rate,
        tdf_exempt: input.tdf_exempt,
        stock_current: input.stock_current,
        stock_minimum: input.stock_minimum,
        stock_tracking_enabled: input.stock_tracking_enabled,
        is_active: input.is_active,
      })
      .returning();

    if (!row) {
      throw new Error('Insert de producto no devolvio fila');
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
        },
        pii_level: 'internal',
        severity: 'info',
      },
      tx
    );

    return row;
  });

  logger.info({ product_id: created.id, name: created.name }, 'product.created');
  return created;
}

export async function updateProduct(
  id: string,
  rawInput: unknown
): Promise<Product> {
  const tenantId = requireTenantId();

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

export async function adjustStock(rawInput: unknown): Promise<Product> {
  const tenantId = requireTenantId();

  const parsed = StockAdjustmentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(
      'Ajuste de stock invalido',
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]))
    );
  }
  const input: StockAdjustmentInput = parsed.data;

  const existing = await getByIdInternal(tenantId, input.product_id);
  if (!existing) {
    throw new NotFoundError('Producto', input.product_id);
  }

  const currentStock = money(existing.stock_current);
  const delta = money(input.delta);
  const newStock = moneyAdd(currentStock, delta);

  if (newStock.lt(0)) {
    throw new FiscalIntegrityError(
      'Stock final no puede ser negativo. Verifica delta vs stock actual.',
      {
        product_id: input.product_id,
        current: currentStock.toString(),
        delta: delta.toString(),
        would_be: newStock.toString(),
      }
    );
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(products)
      .set({
        stock_current: moneyToStorage(newStock),
        updated_at: new Date(),
      })
      .where(and(eq(products.tenant_id, tenantId), eq(products.id, input.product_id)))
      .returning();

    if (!row) {
      throw new Error('Update de stock no devolvio fila');
    }

    await writeAuditLog(
      {
        event_name: 'stock.adjusted_manually',
        payload: {
          product_id: input.product_id,
          product_name: row.name,
          before: currentStock.toString(),
          after: newStock.toString(),
          delta: delta.toString(),
          reason: input.reason,
        },
        pii_level: 'internal',
        severity: 'notice',
      },
      tx
    );

    return row;
  });

  logger.info(
    {
      product_id: input.product_id,
      delta: delta.toString(),
      new_stock: newStock.toString(),
      reason: input.reason,
    },
    'stock.adjusted_manually'
  );

  return updated;
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
