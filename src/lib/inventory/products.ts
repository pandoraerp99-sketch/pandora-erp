/**
 * Products service — CRUD del catálogo del tenant.
 * Sprint 3 ROADMAP Inventory context.
 *
 * **Patrón Sprint 2 (audit-writer, metrics):** pure helpers testeables sin DB
 * + wrapper que orquesta context + db.insert/update.
 *
 * **Multi-tenant guard:** tenant_id viene del tracing context (Sprint 2 #1)
 * por default. Operaciones de support/system con override explícito requieren
 * `actor_type === 'system' | 'support'` (mismo patrón audit-writer §override_tenant_id).
 *
 * **Validaciones (defense-in-depth — CHECK constraints en schema más esto en TS):**
 * - sku/barcode: si vienen como string vacío → normalizar a undefined
 *   (partial unique index ignora NULL pero matchea '' como duplicado).
 * - tax_rate: 0-100, hasta 2 decimales.
 * - price/cost: >= 0, hasta 4 decimales.
 * - unit_type: enum del catálogo cerrado.
 * - tdf_exempt: bool (la aplicación de exención efectiva la decide
 *   projectToFiscalBreakdown — Sprint 6, no acá).
 *
 * **Reglas operativas:**
 * - Soft delete via `is_active = false` (NO hard delete — preserva FK histórica
 *   en stock_movements + invoices + sale_items).
 * - sku/barcode una vez seteados pueden cambiarse (catálogo es mutable),
 *   pero NO se reusan: el partial unique enforce.
 */
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  products,
  UNIT_TYPES,
  type NewProduct,
  type Product,
  type UnitType,
} from '../db/schema/products.js';
import { requireTracingContext } from '../tracing/context.js';
import type { TracingContext } from '../tracing/context.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';
import { isValidUuid } from '../tracing/ids.js';
import { writeAuditLog } from '../audit/audit-writer.js';

// ──── Errors tipados ────────────────────────────────────────────

export class ProductValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_name'
      | 'invalid_unit_type'
      | 'invalid_tax_rate'
      | 'invalid_price'
      | 'invalid_cost'
      | 'invalid_stock_current'
      | 'invalid_stock_minimum'
      | 'invalid_sku'
      | 'invalid_barcode'
      | 'invalid_product_id',
    message: string
  ) {
    super(message);
    this.name = 'ProductValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProductNotFoundError extends Error {
  constructor(public readonly product_id: string) {
    super(`Product ${product_id} no encontrado en tenant actual`);
    this.name = 'ProductNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ──── Inputs ────────────────────────────────────────────────────

export interface CreateProductInput {
  name: string;
  description?: string | null;
  sku?: string | null;
  barcode?: string | null;
  unit_type?: UnitType;
  price: string | number;            // permite string (decimal-safe) o number
  cost?: string | number | null;
  tax_rate?: string | number;        // default 21.00 en DB
  tdf_exempt?: boolean;
  stock_current?: string | number;
  stock_minimum?: string | number | null;
  stock_tracking_enabled?: boolean;
  /**
   * Override del tenant_id del context. SOLO permitido cuando
   * actor_type === 'system' o 'support' (multi-tenant guard — mismo
   * patrón que audit-writer override_tenant_id).
   */
  override_tenant_id?: string;
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  sku?: string | null;
  barcode?: string | null;
  unit_type?: UnitType;
  price?: string | number;
  cost?: string | number | null;
  tax_rate?: string | number;
  tdf_exempt?: boolean;
  stock_minimum?: string | number | null;
  stock_tracking_enabled?: boolean;
  is_active?: boolean;
  override_tenant_id?: string;
}

// ──── Pure validators (testeables sin DB) ──────────────────────

/**
 * Normaliza string opcional a undefined cuando es null, undefined o string
 * de solo whitespace. Importante para sku/barcode con partial unique index
 * (que cuenta '' como valor → causaría falso positivo de duplicado).
 */
export function normalizeOptionalString(
  value: string | null | undefined
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Valida y normaliza un numeric input a string formato Decimal(precision,scale).
 * Acepta number o string. Throws ProductValidationError si negativo (cuando
 * !allowNegative) o no parseable.
 *
 * NO usa Decimal.js acá (lib money es responsability del context fiscal).
 * Validación numeric básica F0 — strict typing al schema.
 */
export function normalizeDecimal(
  raw: string | number,
  field: 'price' | 'cost' | 'tax_rate' | 'stock_current' | 'stock_minimum',
  scale: 2 | 4,
  options: { allowNegative?: boolean; min?: number; max?: number } = {}
): string {
  const { allowNegative = false, min, max } = options;

  // Validación strict: parseFloat es permisivo ("21abc" → 21, "1,500" → 1).
  // Number() + regex strict evita inputs maliciosos o user error silencioso.
  // Mismo patrón defensivo que vault.isStrictBase64 (Sprint 1 #6).
  let num: number;
  if (typeof raw === 'number') {
    num = raw;
  } else {
    const trimmed = raw.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new ProductValidationError(
        `invalid_${field}` as ProductValidationError['code'],
        `${field}: formato numérico inválido "${raw}" (esperado: dígitos opcionales con punto decimal)`
      );
    }
    num = Number(trimmed);
  }
  if (!Number.isFinite(num)) {
    throw new ProductValidationError(
      `invalid_${field}` as ProductValidationError['code'],
      `${field}: valor no numérico "${raw}"`
    );
  }
  if (!allowNegative && num < 0) {
    throw new ProductValidationError(
      `invalid_${field}` as ProductValidationError['code'],
      `${field}: no puede ser negativo (recibido ${num})`
    );
  }
  if (min !== undefined && num < min) {
    throw new ProductValidationError(
      `invalid_${field}` as ProductValidationError['code'],
      `${field}: debe ser >= ${min} (recibido ${num})`
    );
  }
  if (max !== undefined && num > max) {
    throw new ProductValidationError(
      `invalid_${field}` as ProductValidationError['code'],
      `${field}: debe ser <= ${max} (recibido ${num})`
    );
  }
  return num.toFixed(scale);
}

/**
 * Prepara los valores del INSERT a products — pure helper testeable sin DB.
 * Hace todas las validaciones críticas + normalización.
 *
 * @throws ProductValidationError si input inválido
 * @throws CrossTenantAccessError si override_tenant_id con actor no autorizado
 */
export function prepareCreateProductValues(
  input: CreateProductInput,
  ctx: TracingContext
): NewProduct {
  // ──── Name obligatorio + non-empty ───────
  const name = normalizeOptionalString(input.name);
  if (!name) {
    throw new ProductValidationError(
      'invalid_name',
      'name: obligatorio, no puede ser vacío o solo whitespace'
    );
  }

  // ──── Unit type del catálogo ───────────
  const unit_type = input.unit_type ?? 'unidad';
  if (!UNIT_TYPES.includes(unit_type)) {
    throw new ProductValidationError(
      'invalid_unit_type',
      `unit_type: "${unit_type}" no válido. Valores: ${UNIT_TYPES.join(', ')}`
    );
  }

  // ──── Numerics con scale + rango ───────
  const price = normalizeDecimal(input.price, 'price', 4);
  const cost =
    input.cost !== null && input.cost !== undefined
      ? normalizeDecimal(input.cost, 'cost', 4)
      : undefined;
  const tax_rate = normalizeDecimal(input.tax_rate ?? '21.00', 'tax_rate', 2, {
    min: 0,
    max: 100,
  });
  // stock_current acepta 0 explícitamente (default cuando undefined/null).
  // NO usar truthy check: 0 es valor válido (producto recién creado sin stock).
  const stock_current =
    input.stock_current !== null && input.stock_current !== undefined
      ? normalizeDecimal(input.stock_current, 'stock_current', 4)
      : '0';
  const stock_minimum =
    input.stock_minimum !== null && input.stock_minimum !== undefined
      ? normalizeDecimal(input.stock_minimum, 'stock_minimum', 4)
      : undefined;

  // ──── Multi-tenant guard (override_tenant_id) ───────
  if (input.override_tenant_id !== undefined) {
    if (!isValidUuid(input.override_tenant_id)) {
      throw new CrossTenantAccessError(
        input.override_tenant_id,
        ctx.tenant_id,
        'products.create.override_tenant_id (UUID format inválido)'
      );
    }
    if (ctx.actor_type !== 'system' && ctx.actor_type !== 'support') {
      throw new CrossTenantAccessError(
        input.override_tenant_id,
        ctx.tenant_id,
        'products.create.override_tenant_id'
      );
    }
  }

  const tenant_id = input.override_tenant_id ?? ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'products.create: tenant_id ausente en context y sin override'
    );
  }

  return {
    tenant_id,
    name,
    description: normalizeOptionalString(input.description) ?? null,
    sku: normalizeOptionalString(input.sku) ?? null,
    barcode: normalizeOptionalString(input.barcode) ?? null,
    unit_type,
    price,
    cost: cost ?? null,
    tax_rate,
    tdf_exempt: input.tdf_exempt ?? false,
    stock_current,
    stock_minimum: stock_minimum ?? null,
    stock_tracking_enabled: input.stock_tracking_enabled ?? true,
    is_active: true,
  };
}

// ──── Service wrappers ─────────────────────────────────────────

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Crea un producto en el tenant del context (o el override autorizado).
 *
 * **Atomicidad:** INSERT product + audit_log emit en la MISMA transacción
 * (CLAUDE.md §15.2 + §16.9). Si caller pasó `db` (no tx), abrimos tx propia.
 * Si caller pasó tx, reusamos (caller decide la atomicidad).
 *
 * @throws ProductValidationError input inválido
 * @throws CrossTenantAccessError multi-tenant guard
 */
export async function createProduct(
  input: CreateProductInput,
  txOrDb: DbOrTransaction = db
): Promise<Product> {
  const ctx = requireTracingContext();
  const values = prepareCreateProductValues(input, ctx);

  const runInTx = async (
    tx: DbOrTransaction
  ): Promise<Product> => {
    const inserted = await tx.insert(products).values(values).returning();
    if (inserted.length === 0) {
      throw new Error('createProduct: INSERT no devolvió row (esperado .returning())');
    }
    const product = inserted[0]!;

    // audit_log en la misma tx. Si audit falla, rollback del INSERT product
    // (atomicidad — sin esto el producto existe sin huella auditable).
    await writeAuditLog(
      {
        event_name: 'product.created',
        payload: {
          product_id: product.id,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          unit_type: product.unit_type,
          price: product.price,
          tax_rate: product.tax_rate,
          tdf_exempt: product.tdf_exempt,
          stock_tracking_enabled: product.stock_tracking_enabled,
        },
        pii_level: 'internal',
        severity: 'info',
        ...(input.override_tenant_id !== undefined && {
          override_tenant_id: input.override_tenant_id,
        }),
      },
      tx
    );

    return product;
  };

  // Si caller pasó db plain, abrir tx propia. Si pasó tx, reusar (no anidar).
  if (txOrDb === db) {
    return await db.transaction(runInTx);
  }
  return await runInTx(txOrDb);
}

/**
 * Busca un producto por id verificando que pertenezca al tenant del context.
 * Retorna null si no existe O si pertenece a otro tenant (NO throw — el caller
 * lo trata como "no existe" desde su perspectiva de tenant).
 *
 * Para distinguir "no existe globalmente" vs "no existe en mi tenant",
 * usar admin/support tools con override_tenant_id.
 */
export async function findProductById(
  product_id: string,
  txOrDb: DbOrTransaction = db
): Promise<Product | null> {
  // Trust boundary: input externo (Server Action params / API path) puede
  // ser garbage. Mismo patrón de validación UUID que audit-writer Sprint 2 #1.
  if (!isValidUuid(product_id)) {
    throw new ProductValidationError(
      'invalid_product_id',
      `findProductById: product_id no es UUID válido ("${product_id}")`
    );
  }
  const ctx = requireTracingContext();
  const tenant_id = ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'findProductById: tenant_id ausente en context'
    );
  }
  const rows = await txOrDb
    .select()
    .from(products)
    .where(and(eq(products.id, product_id), eq(products.tenant_id, tenant_id)))
    .limit(1);
  return rows[0] ?? null;
}
