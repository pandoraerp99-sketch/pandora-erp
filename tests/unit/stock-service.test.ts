/**
 * Tests unitarios stock service — pure helpers + wrapper smoke.
 * Sprint 3 ROADMAP Inventory T-INV-04 (SELECT FOR UPDATE oversell) + T-INV-05.
 *
 * Cubre:
 * - inferDirection (sale/loss→out, purchase/return→in, adjustment requiere explicit)
 * - computeNextStockCurrent (pure math entera escala 10000, sin float drift)
 * - isOversell (boolean check)
 * - prepareStockMovementValues (validaciones input + multi-tenant guard)
 * - Wrapper smoke (recordStockMovement requireTracingContext gate)
 *
 * Tests con DB real (SELECT FOR UPDATE concurrente + INSERT append-only +
 * UPDATE atómico + RLS cross-tenant + trigger immutable) → diferidos a
 * tests/integration cuando exista Supabase test instance.
 */
import { describe, expect, it } from 'vitest';
import {
  inferDirection,
  computeNextStockCurrent,
  isOversell,
  prepareStockMovementValues,
  recordStockMovement,
  StockValidationError,
  type RecordMovementInput,
} from '@/lib/inventory/stock';
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

const VALID_PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const VALID_SALE_ID = '33333333-3333-3333-3333-333333333333';

const validAdjustmentInput: RecordMovementInput = {
  product_id: VALID_PRODUCT_ID,
  type: 'adjustment',
  qty: 5,
  reason: 'recuento físico semanal',
  direction: 'in',
};

describe('inferDirection — direction inference per type', () => {
  it('sale → out', () => {
    expect(inferDirection('sale')).toBe('out');
  });

  it('loss → out', () => {
    expect(inferDirection('loss')).toBe('out');
  });

  it('purchase → in', () => {
    expect(inferDirection('purchase')).toBe('in');
  });

  it('return → in', () => {
    expect(inferDirection('return')).toBe('in');
  });

  it('adjustment + explicit in → in', () => {
    expect(inferDirection('adjustment', 'in')).toBe('in');
  });

  it('adjustment + explicit out → out', () => {
    expect(inferDirection('adjustment', 'out')).toBe('out');
  });

  it('adjustment SIN direction explícita → throw', () => {
    expect(() => inferDirection('adjustment')).toThrow(StockValidationError);
  });

  it('explicit direction en non-adjustment es ignorado (sale gana)', () => {
    // sale fuerza out aunque caller pase 'in' por error
    expect(inferDirection('sale', 'in')).toBe('out');
  });
});

describe('computeNextStockCurrent — pure math sin float drift', () => {
  it('in: 10 + 5 = 15', () => {
    expect(computeNextStockCurrent('10.0000', '5.0000', 'in')).toBe('15.0000');
  });

  it('out: 10 - 5 = 5', () => {
    expect(computeNextStockCurrent('10.0000', '5.0000', 'out')).toBe('5.0000');
  });

  it('decimal preserving: 100.1234 - 0.0001 = 100.1233', () => {
    expect(computeNextStockCurrent('100.1234', '0.0001', 'out')).toBe('100.1233');
  });

  it('out: 0 - 1 puede dar negativo (caller debe haber chequeado isOversell antes)', () => {
    // computeNextStockCurrent es pure math — NO valida oversell.
    // El service flow chequea isOversell ANTES de llamar acá.
    expect(computeNextStockCurrent('0.0000', '1.0000', 'out')).toBe('-1.0000');
  });

  it('escala 10000 evita drift: 0.1 + 0.2 = 0.3 exacto', () => {
    expect(computeNextStockCurrent('0.1000', '0.2000', 'in')).toBe('0.3000');
  });

  it('venta sedería 5.5 metros − 1.234 metros = 4.266', () => {
    // Caso real retail TDF: comerciante vende tela por metro
    expect(computeNextStockCurrent('5.5000', '1.2340', 'out')).toBe('4.2660');
  });

  it('venta carnicería 2 kg − 0.5 kg = 1.5 kg', () => {
    expect(computeNextStockCurrent('2.0000', '0.5000', 'out')).toBe('1.5000');
  });

  it('valores no parseables → throw', () => {
    expect(() => computeNextStockCurrent('abc', '5', 'in')).toThrow(
      StockValidationError
    );
  });
});

describe('isOversell — boolean check', () => {
  it('in direction → siempre false (incrementos nunca oversell)', () => {
    expect(isOversell('0.0000', '10.0000', 'in')).toBe(false);
    expect(isOversell('5.0000', '1000.0000', 'in')).toBe(false);
  });

  it('out: stock 10, qty 5 → no oversell', () => {
    expect(isOversell('10.0000', '5.0000', 'out')).toBe(false);
  });

  it('out: stock 5, qty 10 → oversell', () => {
    expect(isOversell('5.0000', '10.0000', 'out')).toBe(true);
  });

  it('out: stock 5, qty 5 (exacto al límite) → no oversell', () => {
    expect(isOversell('5.0000', '5.0000', 'out')).toBe(false);
  });

  it('out: stock 0, qty 0.0001 → oversell', () => {
    expect(isOversell('0.0000', '0.0001', 'out')).toBe(true);
  });
});

describe('prepareStockMovementValues — happy path', () => {
  it('input mínimo válido (adjustment) → values correctos', () => {
    const result = prepareStockMovementValues(validAdjustmentInput, makeCtx());
    expect(result.product_id).toBe(VALID_PRODUCT_ID);
    expect(result.type).toBe('adjustment');
    expect(result.qty).toBe('5.0000');
    expect(result.reason).toBe('recuento físico semanal');
    expect(result.tenant_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.created_by).toBe('user-x');
  });

  it('sale type con related_sale_id válido + skip_audit=true (Sales context) → OK', () => {
    const result = prepareStockMovementValues(
      {
        product_id: VALID_PRODUCT_ID,
        type: 'sale',
        qty: 1,
        related_sale_id: VALID_SALE_ID,
        skip_audit: true, // Sales context emite 'sale.completed' propio
      },
      makeCtx()
    );
    expect(result.type).toBe('sale');
    expect(result.related_sale_id).toBe(VALID_SALE_ID);
  });

  it('correlation_id heredado del context', () => {
    const corrId = generateCorrelationId();
    const result = prepareStockMovementValues(
      validAdjustmentInput,
      makeCtx({ correlation_id: corrId })
    );
    expect(result.correlation_id).toBe(corrId);
  });

  it('reason whitespace → trim a null (purchase con skip_audit=true)', () => {
    const result = prepareStockMovementValues(
      {
        ...validAdjustmentInput,
        type: 'purchase' as const,
        reason: '   ',
        skip_audit: true, // purchase requiere skip_audit
      },
      makeCtx()
    );
    expect(result.reason).toBeNull();
  });
});

describe('prepareStockMovementValues — validaciones input', () => {
  it('product_id no UUID → throw invalid_product_id', () => {
    expect(() =>
      prepareStockMovementValues(
        { ...validAdjustmentInput, product_id: 'garbage' },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });

  it('type fuera del catálogo → throw invalid_type', () => {
    expect(() =>
      prepareStockMovementValues(
        // @ts-expect-error testing runtime guard
        { ...validAdjustmentInput, type: 'merma' },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });

  it('qty 0 → throw invalid_qty', () => {
    expect(() =>
      prepareStockMovementValues(
        { ...validAdjustmentInput, qty: 0 },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });

  it('qty negativa → throw invalid_qty (signo va por type+direction)', () => {
    expect(() =>
      prepareStockMovementValues(
        { ...validAdjustmentInput, qty: -1 },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });

  it('adjustment sin reason → throw missing_reason_for_adjustment', () => {
    expect(() =>
      prepareStockMovementValues(
        { ...validAdjustmentInput, reason: '' },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });

  it('adjustment con reason solo whitespace → throw', () => {
    expect(() =>
      prepareStockMovementValues(
        { ...validAdjustmentInput, reason: '   ' },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });

  it('sale sin related_sale_id → throw missing_related_sale_for_sale_type', () => {
    expect(() =>
      prepareStockMovementValues(
        { product_id: VALID_PRODUCT_ID, type: 'sale', qty: 1 },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });

  it('sale con related_sale_id no UUID → throw', () => {
    expect(() =>
      prepareStockMovementValues(
        {
          product_id: VALID_PRODUCT_ID,
          type: 'sale',
          qty: 1,
          related_sale_id: 'not-a-uuid',
        },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });

  it('type sale SIN skip_audit → throw invalid_type (advisor fix 2026-06-03 — contrato pre-mutation)', () => {
    // Caller que NO es Sales context (ej: test directo o llamada mal hecha)
    // intenta type='sale' sin marcar skip_audit. Catálogo F0 EVENT-TAXONOMY
    // solo tiene 'stock.adjusted_manually' → throw ANTES de cualquier
    // mutation (SELECT FOR UPDATE / INSERT / UPDATE no deben correr).
    expect(() =>
      prepareStockMovementValues(
        {
          product_id: VALID_PRODUCT_ID,
          type: 'sale',
          qty: 1,
          related_sale_id: VALID_SALE_ID,
          // skip_audit ausente
        },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });

  it('type sale CON skip_audit=true → OK (Sales emite audit propio)', () => {
    const result = prepareStockMovementValues(
      {
        product_id: VALID_PRODUCT_ID,
        type: 'sale',
        qty: 1,
        related_sale_id: VALID_SALE_ID,
        skip_audit: true,
      },
      makeCtx()
    );
    expect(result.type).toBe('sale');
  });

  it('type loss SIN skip_audit → throw (mismo principio, esperando F1+ resolución)', () => {
    expect(() =>
      prepareStockMovementValues(
        { product_id: VALID_PRODUCT_ID, type: 'loss', qty: 1 },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });

  it('related_sale_id + related_purchase_id ambos seteados → throw related_exclusive_violation', () => {
    expect(() =>
      prepareStockMovementValues(
        {
          product_id: VALID_PRODUCT_ID,
          type: 'adjustment',
          qty: 1,
          reason: 'transferencia inter-domain',
          direction: 'out',
          related_sale_id: VALID_SALE_ID,
          related_purchase_id: '44444444-4444-4444-4444-444444444444',
        },
        makeCtx()
      )
    ).toThrow(StockValidationError);
  });
});

describe('prepareStockMovementValues — multi-tenant guard (override_tenant_id)', () => {
  const OVERRIDE_TENANT = '55555555-5555-5555-5555-555555555555';

  it('SIN override + actor user → tenant_id = ctx.tenant_id', () => {
    const ctx = makeCtx({ tenant_id: '66666666-6666-6666-6666-666666666666' });
    const result = prepareStockMovementValues(validAdjustmentInput, ctx);
    expect(result.tenant_id).toBe('66666666-6666-6666-6666-666666666666');
  });

  it('CON override + actor system → tenant_id = override', () => {
    const ctx = makeCtx({
      tenant_id: null,
      actor_user_id: null,
      actor_type: 'system',
    });
    const result = prepareStockMovementValues(
      { ...validAdjustmentInput, override_tenant_id: OVERRIDE_TENANT },
      ctx
    );
    expect(result.tenant_id).toBe(OVERRIDE_TENANT);
  });

  it('CON override + actor support → tenant_id = override (audit-writer pattern)', () => {
    const ctx = makeCtx({ actor_type: 'support' });
    const result = prepareStockMovementValues(
      { ...validAdjustmentInput, override_tenant_id: OVERRIDE_TENANT },
      ctx
    );
    expect(result.tenant_id).toBe(OVERRIDE_TENANT);
  });

  it('CON override + actor user → throw CrossTenantAccessError', () => {
    const ctx = makeCtx({ actor_type: 'user' });
    expect(() =>
      prepareStockMovementValues(
        { ...validAdjustmentInput, override_tenant_id: OVERRIDE_TENANT },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('override_tenant_id "not-uuid" → throw CrossTenantAccessError (UUID validation antes de actor check)', () => {
    const ctx = makeCtx({ actor_type: 'system' });
    expect(() =>
      prepareStockMovementValues(
        { ...validAdjustmentInput, override_tenant_id: 'garbage' },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('SIN override + ctx.tenant_id null → throw CrossTenantAccessError', () => {
    const ctx = makeCtx({ tenant_id: null });
    expect(() => prepareStockMovementValues(validAdjustmentInput, ctx)).toThrow(
      CrossTenantAccessError
    );
  });
});

describe('recordStockMovement wrapper — requireTracingContext gate', () => {
  it('llamado FUERA de tracing context → throw requireTracingContext error', async () => {
    // Mismo patrón Sprint 2 audit-writer + Sprint 3 #4 products createProduct.
    // requireTracingContext() throws ANTES de llegar a SELECT FOR UPDATE / INSERT.
    await expect(
      recordStockMovement({
        product_id: VALID_PRODUCT_ID,
        type: 'adjustment',
        qty: 1,
        reason: 'test',
        direction: 'in',
      })
    ).rejects.toThrow(/no esta inicializado/);
  });
});
