/**
 * Tests unitarios products service — pure helpers.
 * Sprint 3 ROADMAP Inventory T-INV-01 (parcial — multi-tenant guard cubierto).
 *
 * Cubre:
 * - normalizeOptionalString (sku/barcode handling con whitespace)
 * - normalizeDecimal (numeric validation + scale formatting)
 * - prepareCreateProductValues (defaults + validation + multi-tenant guard)
 *
 * Tests con DB real (INSERT con partial unique, multi-tenant RLS, trigger
 * append-only stock_movements) → diferidos a tests/integration cuando exista
 * Supabase test instance (mismo patrón Sprint 1/2).
 */
import { describe, expect, it } from 'vitest';
import {
  prepareCreateProductValues,
  normalizeOptionalString,
  normalizeDecimal,
  ProductValidationError,
  createProduct,
  findProductById,
  type CreateProductInput,
} from '@/lib/inventory/products';
import { CrossTenantAccessError } from '@/lib/multi_tenant/errors';
import type { TracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';

function makeCtx(overrides: Partial<TracingContext> = {}): TracingContext {
  return {
    correlation_id: generateCorrelationId(),
    request_id: generateRequestId(),
    tenant_id: '11111111-1111-1111-1111-111111111111',
    actor_user_id: 'user-x',
    actor_type: 'user',
    ...overrides,
  };
}

const validInput: CreateProductInput = {
  name: 'Tela algodón blanco',
  price: '1500.50',
};

describe('normalizeOptionalString', () => {
  it('null → undefined', () => {
    expect(normalizeOptionalString(null)).toBeUndefined();
  });

  it('undefined → undefined', () => {
    expect(normalizeOptionalString(undefined)).toBeUndefined();
  });

  it('"" → undefined (importante para partial unique index)', () => {
    expect(normalizeOptionalString('')).toBeUndefined();
  });

  it('"   " (solo whitespace) → undefined', () => {
    expect(normalizeOptionalString('   ')).toBeUndefined();
  });

  it('"  abc  " → "abc" (trim)', () => {
    expect(normalizeOptionalString('  abc  ')).toBe('abc');
  });

  it('"abc" → "abc" (passthrough)', () => {
    expect(normalizeOptionalString('abc')).toBe('abc');
  });
});

describe('normalizeDecimal — validation + scale formatting', () => {
  it('number con scale 4 → string 4 decimales', () => {
    expect(normalizeDecimal(1500.5, 'price', 4)).toBe('1500.5000');
  });

  it('string parsea + scale formatting', () => {
    expect(normalizeDecimal('21.5', 'tax_rate', 2)).toBe('21.50');
  });

  it('0 acepta (price puede ser 0)', () => {
    expect(normalizeDecimal(0, 'price', 4)).toBe('0.0000');
  });

  it('negativo → throw invalid_price', () => {
    expect(() => normalizeDecimal(-1, 'price', 4)).toThrow(ProductValidationError);
  });

  it('NaN → throw', () => {
    expect(() => normalizeDecimal('abc', 'price', 4)).toThrow(ProductValidationError);
  });

  it('Infinity → throw', () => {
    expect(() => normalizeDecimal(Infinity, 'price', 4)).toThrow(ProductValidationError);
  });

  it('tax_rate 0-100 con min/max', () => {
    expect(normalizeDecimal(21, 'tax_rate', 2, { min: 0, max: 100 })).toBe('21.00');
    expect(() => normalizeDecimal(101, 'tax_rate', 2, { min: 0, max: 100 })).toThrow();
    expect(() => normalizeDecimal(-0.1, 'tax_rate', 2, { min: 0, max: 100 })).toThrow();
  });
});

describe('prepareCreateProductValues — happy path + defaults', () => {
  it('input mínimo (name + price) → defaults aplicados', () => {
    const result = prepareCreateProductValues(validInput, makeCtx());
    expect(result.name).toBe('Tela algodón blanco');
    expect(result.price).toBe('1500.5000');
    expect(result.unit_type).toBe('unidad');
    expect(result.tax_rate).toBe('21.00');
    expect(result.tdf_exempt).toBe(false);
    expect(result.stock_current).toBe('0');
    expect(result.stock_tracking_enabled).toBe(true);
    expect(result.is_active).toBe(true);
    expect(result.tenant_id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('todos los campos custom → respetados', () => {
    const result = prepareCreateProductValues(
      {
        name: 'Vino Malbec 750ml',
        description: 'Mendoza, 2024',
        sku: 'V-MAL-750',
        barcode: '7790000123456',
        unit_type: 'unidad',
        price: 8500,
        cost: 5000,
        tax_rate: 21,
        tdf_exempt: false,
        stock_current: '12',
        stock_minimum: '3',
        stock_tracking_enabled: true,
      },
      makeCtx()
    );
    expect(result.sku).toBe('V-MAL-750');
    expect(result.barcode).toBe('7790000123456');
    expect(result.cost).toBe('5000.0000');
    expect(result.stock_minimum).toBe('3.0000');
  });

  it('TDF tdf_exempt=true para Ley 19.640 → respetado', () => {
    const result = prepareCreateProductValues(
      { ...validInput, tdf_exempt: true },
      makeCtx({
        tenant_id: '11111111-1111-1111-1111-111111111111',
      })
    );
    expect(result.tdf_exempt).toBe(true);
  });
});

describe('prepareCreateProductValues — validaciones input', () => {
  it('name vacío → throw invalid_name', () => {
    expect(() =>
      prepareCreateProductValues({ ...validInput, name: '' }, makeCtx())
    ).toThrow(ProductValidationError);
  });

  it('name solo whitespace → throw', () => {
    expect(() =>
      prepareCreateProductValues({ ...validInput, name: '   ' }, makeCtx())
    ).toThrow(ProductValidationError);
  });

  it('sku vacío (whitespace) → normalizado a null (no falso duplicado)', () => {
    const result = prepareCreateProductValues(
      { ...validInput, sku: '   ' },
      makeCtx()
    );
    expect(result.sku).toBeNull();
  });

  it('barcode vacío → null', () => {
    const result = prepareCreateProductValues(
      { ...validInput, barcode: '' },
      makeCtx()
    );
    expect(result.barcode).toBeNull();
  });

  it('unit_type inválido → throw', () => {
    expect(() =>
      prepareCreateProductValues(
        // @ts-expect-error testing runtime guard
        { ...validInput, unit_type: 'cucharada' },
        makeCtx()
      )
    ).toThrow(ProductValidationError);
  });

  it('price negativo → throw', () => {
    expect(() =>
      prepareCreateProductValues({ ...validInput, price: -1 }, makeCtx())
    ).toThrow(ProductValidationError);
  });

  it('tax_rate > 100 → throw', () => {
    expect(() =>
      prepareCreateProductValues({ ...validInput, tax_rate: 150 }, makeCtx())
    ).toThrow(ProductValidationError);
  });

  it('tax_rate negativa → throw', () => {
    expect(() =>
      prepareCreateProductValues({ ...validInput, tax_rate: -1 }, makeCtx())
    ).toThrow(ProductValidationError);
  });
});

describe('prepareCreateProductValues — multi-tenant guard (override_tenant_id)', () => {
  const VALID_UUID = '22222222-2222-2222-2222-222222222222';

  it('SIN override + actor user → tenant_id = ctx.tenant_id', () => {
    const ctx = makeCtx({ tenant_id: '33333333-3333-3333-3333-333333333333' });
    const result = prepareCreateProductValues(validInput, ctx);
    expect(result.tenant_id).toBe('33333333-3333-3333-3333-333333333333');
  });

  it('CON override + actor system → tenant_id = override', () => {
    const ctx = makeCtx({
      tenant_id: null,
      actor_user_id: null,
      actor_type: 'system',
    });
    const result = prepareCreateProductValues(
      { ...validInput, override_tenant_id: VALID_UUID },
      ctx
    );
    expect(result.tenant_id).toBe(VALID_UUID);
  });

  it('CON override + actor support → tenant_id = override (audit-writer pattern)', () => {
    const ctx = makeCtx({ actor_type: 'support' });
    const result = prepareCreateProductValues(
      { ...validInput, override_tenant_id: VALID_UUID },
      ctx
    );
    expect(result.tenant_id).toBe(VALID_UUID);
  });

  it('CON override + actor user → throw CrossTenantAccessError', () => {
    const ctx = makeCtx({ actor_type: 'user' });
    expect(() =>
      prepareCreateProductValues(
        { ...validInput, override_tenant_id: VALID_UUID },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('CON override + actor worker → throw CrossTenantAccessError', () => {
    const ctx = makeCtx({ actor_type: 'worker', actor_user_id: null });
    expect(() =>
      prepareCreateProductValues(
        { ...validInput, override_tenant_id: VALID_UUID },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('override_tenant_id "" → throw CrossTenantAccessError (UUID validation)', () => {
    const ctx = makeCtx({ actor_type: 'system' });
    expect(() =>
      prepareCreateProductValues(
        { ...validInput, override_tenant_id: '' },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('override_tenant_id "not-uuid" → throw CrossTenantAccessError', () => {
    const ctx = makeCtx({ actor_type: 'system' });
    expect(() =>
      prepareCreateProductValues(
        { ...validInput, override_tenant_id: 'garbage-not-uuid' },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('UUID validation corre ANTES de actor check (defense layered)', () => {
    // Mismo patrón que audit-writer: si UUID inválido + actor user → throw por UUID
    const ctx = makeCtx({ actor_type: 'user' });
    try {
      prepareCreateProductValues(
        { ...validInput, override_tenant_id: 'garbage' },
        ctx
      );
    } catch (e) {
      expect(e).toBeInstanceOf(CrossTenantAccessError);
      expect((e as CrossTenantAccessError).resource).toContain('UUID format');
    }
  });

  it('SIN override + ctx.tenant_id null → throw CrossTenantAccessError', () => {
    const ctx = makeCtx({ tenant_id: null });
    expect(() => prepareCreateProductValues(validInput, ctx)).toThrow(
      CrossTenantAccessError
    );
  });
});

// Advisor fix #5 2026-06-03: wrapper smoke tests (createProduct + findProductById).
// Mismo patrón que audit-writer Sprint 2 — no requieren DB (no llegan a insert).
// Tests con DB real (INSERT atómico + audit_log emit + RLS) → diferidos a
// tests/integration cuando exista Supabase test instance.
describe('createProduct wrapper — requireTracingContext gate', () => {
  it('llamado FUERA de tracing context → throw requireTracingContext error', async () => {
    // Sin AsyncLocalStorage context, requireTracingContext() throws ANTES de
    // llegar a prepareCreateProductValues / INSERT / writeAuditLog.
    // Sin esto, audit_log seria orphan (sin correlation_id/request_id) o
    // multi-tenant guard falla sin info de actor.
    await expect(
      createProduct({ name: 'X', price: '100.00' })
    ).rejects.toThrow(/no esta inicializado/);
  });
});

describe('findProductById wrapper — UUID validation + context gate', () => {
  it('product_id no es UUID válido → throw ProductValidationError(invalid_product_id)', async () => {
    // Trust boundary: input externo (Server Action params / API path) puede
    // ser garbage. Validación corre ANTES de requireTracingContext → throw
    // determinístico aunque NO haya context activo (lo mismo que pasaría
    // dentro de context con UUID inválido).
    await expect(findProductById('not-a-uuid')).rejects.toThrow(
      ProductValidationError
    );
    await expect(findProductById('')).rejects.toThrow(ProductValidationError);
    await expect(findProductById('garbage-xxx-yyy')).rejects.toThrow(
      ProductValidationError
    );
  });

  it('UUID válido pero SIN context → throw requireTracingContext error', async () => {
    // UUID OK pasa la primera guard, llega a requireTracingContext() que
    // throws. Confirma orden de checks (UUID → context → DB).
    await expect(
      findProductById('11111111-1111-1111-1111-111111111111')
    ).rejects.toThrow(/no esta inicializado/);
  });
});
