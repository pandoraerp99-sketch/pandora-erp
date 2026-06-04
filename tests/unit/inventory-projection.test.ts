/**
 * Tests unitarios inventory projection — pure functions.
 * Sprint 3 ROADMAP Inventory T-INV-07.
 *
 * Cubre:
 * - toSaleItemSnapshot (snapshot autosuficiente Product + qty)
 * - snapshotsEqual (determinism check)
 * - Validaciones: producto inactivo, qty <= 0, qty NaN
 *
 * NO cubre F0 (PENDIENTE contadora A-1 + A-10):
 * - Cálculo IVA per-line vs per-bracket
 * - Aplicación TDF Ley 19.640 (la decisión final la toma projectToFiscalBreakdown)
 */
import { describe, expect, it } from 'vitest';
import {
  toSaleItemSnapshot,
  snapshotsEqual,
  ProjectionError,
  type SaleItemSnapshot,
} from '@/lib/inventory/projection';
import type { Product } from '@/lib/db/schema/products';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenant_id: '22222222-2222-2222-2222-222222222222',
    name: 'Tela algodón blanco',
    description: null,
    sku: 'T-ALG-BLA',
    barcode: '7790000111222',
    unit_type: 'metro',
    price: '1500.5000',
    cost: '1000.0000',
    tax_rate: '21.00',
    tdf_exempt: false,
    stock_current: '50.0000',
    stock_minimum: '5.0000',
    stock_tracking_enabled: true,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('toSaleItemSnapshot — happy path', () => {
  it('snapshot completo del producto + qty', () => {
    const product = makeProduct();
    const snapshot = toSaleItemSnapshot(product, 2.5);

    expect(snapshot).toStrictEqual<SaleItemSnapshot>({
      product_id: '11111111-1111-1111-1111-111111111111',
      name_at_sale: 'Tela algodón blanco',
      unit_type_at_sale: 'metro',
      qty: '2.5000',
      unit_price_at_sale: '1500.5000',
      tax_rate_at_sale: '21.00',
      tdf_exempt_at_sale: false,
      sku_at_sale: 'T-ALG-BLA',
      barcode_at_sale: '7790000111222',
    });
  });

  it('producto TDF exento → tdf_exempt_at_sale=true persistido', () => {
    const product = makeProduct({ tdf_exempt: true, name: 'Notebook Lenovo TDF' });
    const snapshot = toSaleItemSnapshot(product, 1);
    expect(snapshot.tdf_exempt_at_sale).toBe(true);
    expect(snapshot.name_at_sale).toBe('Notebook Lenovo TDF');
  });

  it('producto sin sku/barcode → null en snapshot (NO undefined)', () => {
    const product = makeProduct({ sku: null, barcode: null });
    const snapshot = toSaleItemSnapshot(product, 1);
    expect(snapshot.sku_at_sale).toBeNull();
    expect(snapshot.barcode_at_sale).toBeNull();
  });

  it('qty como string → normalizado a scale 4', () => {
    const product = makeProduct();
    const snapshot = toSaleItemSnapshot(product, '3.14');
    expect(snapshot.qty).toBe('3.1400');
  });

  it('qty con muchos decimales → trunca a scale 4 (Number.toFixed semántica implementation-defined)', () => {
    const product = makeProduct();
    const snapshot = toSaleItemSnapshot(product, '0.12345');
    // ⚠️ NO es HALF_EVEN money-grade. Number.toFixed semántica varía por motor
    // (típicamente HALF_AWAY_FROM_ZERO + ruido IEEE 754). Para path inventory
    // (qty/cost/precio) es suficiente porque input viene limpio.
    // Para path FISCAL (Sprint 6+) usar Decimal.js + HALF_EVEN directo
    // (CLAUDE.md §9.2 + ADR-0005).
    expect(['0.1234', '0.1235']).toContain(snapshot.qty);
  });
});

describe('toSaleItemSnapshot — determinism', () => {
  it('mismo (product, qty) → snapshots idénticos (string-equal)', () => {
    const product = makeProduct();
    const s1 = toSaleItemSnapshot(product, 5);
    const s2 = toSaleItemSnapshot(product, 5);
    expect(snapshotsEqual(s1, s2)).toBe(true);
  });

  it('mismo product distinto qty → snapshots distintos', () => {
    const product = makeProduct();
    const s1 = toSaleItemSnapshot(product, 5);
    const s2 = toSaleItemSnapshot(product, 6);
    expect(snapshotsEqual(s1, s2)).toBe(false);
  });

  it('mismo qty distinto product → snapshots distintos', () => {
    const p1 = makeProduct({ price: '100.0000' });
    const p2 = makeProduct({ price: '200.0000' });
    const s1 = toSaleItemSnapshot(p1, 1);
    const s2 = toSaleItemSnapshot(p2, 1);
    expect(snapshotsEqual(s1, s2)).toBe(false);
    expect(s1.unit_price_at_sale).toBe('100.0000');
    expect(s2.unit_price_at_sale).toBe('200.0000');
  });
});

describe('toSaleItemSnapshot — validaciones', () => {
  it('producto inactivo → throw product_inactive', () => {
    const product = makeProduct({ is_active: false });
    expect(() => toSaleItemSnapshot(product, 1)).toThrow(ProjectionError);
  });

  it('qty 0 → throw invalid_qty', () => {
    const product = makeProduct();
    expect(() => toSaleItemSnapshot(product, 0)).toThrow(ProjectionError);
  });

  it('qty negativa → throw invalid_qty (vía normalizeDecimal)', () => {
    const product = makeProduct();
    expect(() => toSaleItemSnapshot(product, -1)).toThrow(ProjectionError);
  });

  it('qty no parseable → throw invalid_qty', () => {
    const product = makeProduct();
    expect(() => toSaleItemSnapshot(product, 'abc')).toThrow(ProjectionError);
  });
});

describe('snapshotsEqual — comparator', () => {
  it('snapshots idénticos campo a campo → true', () => {
    const a: SaleItemSnapshot = {
      product_id: '11111111-1111-1111-1111-111111111111',
      name_at_sale: 'X',
      unit_type_at_sale: 'unidad',
      qty: '1.0000',
      unit_price_at_sale: '100.0000',
      tax_rate_at_sale: '21.00',
      tdf_exempt_at_sale: false,
      sku_at_sale: null,
      barcode_at_sale: null,
    };
    const b = { ...a };
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it('un solo campo distinto → false', () => {
    const a: SaleItemSnapshot = {
      product_id: '11111111-1111-1111-1111-111111111111',
      name_at_sale: 'X',
      unit_type_at_sale: 'unidad',
      qty: '1.0000',
      unit_price_at_sale: '100.0000',
      tax_rate_at_sale: '21.00',
      tdf_exempt_at_sale: false,
      sku_at_sale: null,
      barcode_at_sale: null,
    };
    const b = { ...a, name_at_sale: 'Y' };
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it('null vs string en sku → false (no equivalente)', () => {
    const a: SaleItemSnapshot = {
      product_id: '11111111-1111-1111-1111-111111111111',
      name_at_sale: 'X',
      unit_type_at_sale: 'unidad',
      qty: '1.0000',
      unit_price_at_sale: '100.0000',
      tax_rate_at_sale: '21.00',
      tdf_exempt_at_sale: false,
      sku_at_sale: null,
      barcode_at_sale: null,
    };
    const b = { ...a, sku_at_sale: 'X-1' };
    expect(snapshotsEqual(a, b)).toBe(false);
  });
});
