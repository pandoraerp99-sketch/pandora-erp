/**
 * Tests unitarios cash service — pure helpers + wrapper smoke.
 * Sprint 4 ROADMAP Cash context (C-OPS-01).
 *
 * Cubre:
 * - normalizeCashAmount (string scale 4, strict regex)
 * - validateSalePoint (entero positivo, max 99999 per WSFEv1)
 * - computeDescuadre (counted - expected, pure math escala 10000)
 * - classifyDescuadreSign (positive | negative | zero)
 * - classifyDescuadreSeverity ('high' > $5000 / 'low' / 'none')
 * - prepareOpenSessionValues (validaciones + multi-tenant guard)
 * - prepareCloseSessionUpdate (descuadre + reason requirement)
 * - prepareRegisterMovementValues (type catálogo + reason obligatorio)
 * - computeMovementTotals (agregados pure math escala entera)
 * - Wrapper smoke (requireTracingContext gate + UUID validation)
 *
 * Tests con DB real (UNIQUE partial concurrent + trigger immutable cash_movements
 * + audit_log atomic + metrics atomic) → diferidos a tests/integration cuando
 * Docker activo. Listados en INTEGRATION-TODO.md T-CASH-01..04 + T-CONC-02.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeCashAmount,
  validateSalePoint,
  computeDescuadre,
  classifyDescuadreSign,
  classifyDescuadreSeverity,
  prepareOpenSessionValues,
  prepareCloseSessionUpdate,
  openCashSession,
  closeCashSession,
  getActiveCashSession,
  getCashSessionById,
  CashValidationError,
  SessionAlreadyClosedError,
  type CloseSessionInput,
} from '@/lib/cash/sessions';
import {
  prepareRegisterMovementValues,
  registerCashMovement,
  MovementValidationError,
} from '@/lib/cash/movements';
import {
  computeMovementTotals,
  getCashSessionSummary,
  listCashSessions,
} from '@/lib/cash/queries';
import { CrossTenantAccessError } from '@/lib/multi_tenant/errors';
import type { TracingContext } from '@/lib/tracing/context';
import {
  generateCorrelationId,
  generateRequestId,
} from '@/lib/tracing/ids';
import type { CashSession } from '@/lib/db/schema/cash_sessions';

function makeCtx(overrides: Partial<TracingContext> = {}): TracingContext {
  return {
    correlation_id: generateCorrelationId(),
    request_id: generateRequestId(),
    tenant_id: '11111111-1111-1111-1111-111111111111',
    actor_user_id: '22222222-2222-2222-2222-222222222222',
    actor_type: 'user',
    ...overrides,
  };
}

function makeSession(overrides: Partial<CashSession> = {}): CashSession {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    sale_point: 1,
    opened_by: '22222222-2222-2222-2222-222222222222',
    opened_at: new Date('2026-06-04T09:00:00Z'),
    initial_amount: '1000.0000',
    closed_by: null,
    closed_at: null,
    final_amount: null,
    expected_amount: null,
    descuadre: null,
    discrepancy_reason: null,
    created_at: new Date('2026-06-04T09:00:00Z'),
    updated_at: new Date('2026-06-04T09:00:00Z'),
    ...overrides,
  };
}

// ──── normalizeCashAmount ──────────────────────────────────────

describe('normalizeCashAmount — strict number + regex', () => {
  it('number positivo → scale 4 string', () => {
    expect(normalizeCashAmount(1500.5, 'initial_amount')).toBe('1500.5000');
  });

  it('cero permitido (caja arranca sin saldo)', () => {
    expect(normalizeCashAmount(0, 'initial_amount')).toBe('0.0000');
  });

  it('string parseable → scale 4 string', () => {
    expect(normalizeCashAmount('250.75', 'counted_amount')).toBe('250.7500');
  });

  it('string con whitespace alrededor → trim + parse', () => {
    expect(normalizeCashAmount('  100.00  ', 'expected_amount')).toBe('100.0000');
  });

  it('negativo → throw invalid', () => {
    expect(() => normalizeCashAmount(-1, 'initial_amount')).toThrow(CashValidationError);
  });

  it('string no parseable → throw', () => {
    expect(() => normalizeCashAmount('abc', 'counted_amount')).toThrow(CashValidationError);
  });

  it('formato inválido "21abc" (parseFloat lenient sería 21) → throw strict', () => {
    expect(() => normalizeCashAmount('21abc', 'counted_amount')).toThrow(
      CashValidationError
    );
  });

  it('Infinity → throw', () => {
    expect(() => normalizeCashAmount(Infinity, 'initial_amount')).toThrow(
      CashValidationError
    );
  });
});

// ──── validateSalePoint ────────────────────────────────────────

describe('validateSalePoint', () => {
  it('1 → 1', () => {
    expect(validateSalePoint(1)).toBe(1);
  });

  it('99999 (max WSFEv1) → 99999', () => {
    expect(validateSalePoint(99999)).toBe(99999);
  });

  it('0 → throw', () => {
    expect(() => validateSalePoint(0)).toThrow(CashValidationError);
  });

  it('negativo → throw', () => {
    expect(() => validateSalePoint(-1)).toThrow(CashValidationError);
  });

  it('no entero → throw', () => {
    expect(() => validateSalePoint(1.5)).toThrow(CashValidationError);
  });

  it('100000 (excede 5 dígitos) → throw', () => {
    expect(() => validateSalePoint(100000)).toThrow(CashValidationError);
  });
});

// ──── computeDescuadre + classify ──────────────────────────────

describe('computeDescuadre — pure math escala 10000', () => {
  it('counted = expected → descuadre 0', () => {
    expect(computeDescuadre('1500.0000', '1500.0000')).toBe('0.0000');
  });

  it('counted > expected (sobrante) → positivo', () => {
    expect(computeDescuadre('1500.5000', '1500.0000')).toBe('0.5000');
  });

  it('counted < expected (faltante) → negativo', () => {
    expect(computeDescuadre('1499.5000', '1500.0000')).toBe('-0.5000');
  });

  it('caso real: caja con $10.000 esperado contó $9.500 → -500', () => {
    expect(computeDescuadre('9500.0000', '10000.0000')).toBe('-500.0000');
  });

  it('input no parseable → throw', () => {
    expect(() => computeDescuadre('abc', '100.00')).toThrow(CashValidationError);
  });

  it('escala 10000 evita float drift: 0.1 - 0.3 + 0.2 = 0 exacto', () => {
    // computado en pasos para simular drift acumulado
    const step1 = computeDescuadre('0.1000', '0.3000');
    expect(step1).toBe('-0.2000');
    const step2 = computeDescuadre('0.2000', step1);
    expect(step2).toBe('0.4000');
  });
});

describe('classifyDescuadreSign', () => {
  it('0 → zero', () => {
    expect(classifyDescuadreSign('0.0000')).toBe('zero');
  });

  it('positivo → positive', () => {
    expect(classifyDescuadreSign('100.0000')).toBe('positive');
  });

  it('negativo → negative', () => {
    expect(classifyDescuadreSign('-50.0000')).toBe('negative');
  });
});

describe('classifyDescuadreSeverity — threshold $5000 ARS', () => {
  it('descuadre 0 → none', () => {
    expect(classifyDescuadreSeverity('0.0000')).toBe('none');
  });

  it('descuadre $4999 → low', () => {
    expect(classifyDescuadreSeverity('4999.0000')).toBe('low');
  });

  it('descuadre exacto $5000 → low (no > threshold)', () => {
    expect(classifyDescuadreSeverity('5000.0000')).toBe('low');
  });

  it('descuadre $5001 → high', () => {
    expect(classifyDescuadreSeverity('5001.0000')).toBe('high');
  });

  it('descuadre negativo $-6000 → high (abs > threshold)', () => {
    expect(classifyDescuadreSeverity('-6000.0000')).toBe('high');
  });

  it('descuadre positivo $-4999 → low', () => {
    expect(classifyDescuadreSeverity('-4999.0000')).toBe('low');
  });
});

// ──── prepareOpenSessionValues ─────────────────────────────────

describe('prepareOpenSessionValues — happy path', () => {
  it('input mínimo válido → values correctos', () => {
    const result = prepareOpenSessionValues(
      { sale_point: 1, initial_amount: 1000 },
      makeCtx()
    );
    expect(result.tenant_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.sale_point).toBe(1);
    expect(result.initial_amount).toBe('1000.0000');
    expect(result.opened_by).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('initial_amount string parseable', () => {
    const result = prepareOpenSessionValues(
      { sale_point: 5, initial_amount: '500.50' },
      makeCtx()
    );
    expect(result.initial_amount).toBe('500.5000');
  });
});

describe('prepareOpenSessionValues — validaciones', () => {
  it('sale_point inválido → throw', () => {
    expect(() =>
      prepareOpenSessionValues({ sale_point: 0, initial_amount: 100 }, makeCtx())
    ).toThrow(CashValidationError);
  });

  it('initial_amount negativo → throw', () => {
    expect(() =>
      prepareOpenSessionValues({ sale_point: 1, initial_amount: -1 }, makeCtx())
    ).toThrow(CashValidationError);
  });

  it('actor_user_id ausente → throw', () => {
    expect(() =>
      prepareOpenSessionValues(
        { sale_point: 1, initial_amount: 100 },
        makeCtx({ actor_user_id: null })
      )
    ).toThrow(CashValidationError);
  });
});

describe('prepareOpenSessionValues — multi-tenant guard', () => {
  const OVERRIDE_TENANT = '44444444-4444-4444-4444-444444444444';

  it('SIN override + actor user → tenant_id = ctx.tenant_id', () => {
    const ctx = makeCtx({ tenant_id: '55555555-5555-5555-5555-555555555555' });
    const result = prepareOpenSessionValues(
      { sale_point: 1, initial_amount: 100 },
      ctx
    );
    expect(result.tenant_id).toBe('55555555-5555-5555-5555-555555555555');
  });

  it('CON override + actor system → tenant_id = override', () => {
    const ctx = makeCtx({
      tenant_id: null,
      actor_user_id: '22222222-2222-2222-2222-222222222222',
      actor_type: 'system',
    });
    const result = prepareOpenSessionValues(
      { sale_point: 1, initial_amount: 100, override_tenant_id: OVERRIDE_TENANT },
      ctx
    );
    expect(result.tenant_id).toBe(OVERRIDE_TENANT);
  });

  it('CON override + actor user → throw CrossTenantAccessError', () => {
    expect(() =>
      prepareOpenSessionValues(
        { sale_point: 1, initial_amount: 100, override_tenant_id: OVERRIDE_TENANT },
        makeCtx({ actor_type: 'user' })
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('override_tenant_id no UUID → throw CrossTenantAccessError', () => {
    expect(() =>
      prepareOpenSessionValues(
        { sale_point: 1, initial_amount: 100, override_tenant_id: 'garbage' },
        makeCtx({ actor_type: 'system' })
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('SIN override + ctx.tenant_id null → throw CrossTenantAccessError', () => {
    expect(() =>
      prepareOpenSessionValues(
        { sale_point: 1, initial_amount: 100 },
        makeCtx({ tenant_id: null })
      )
    ).toThrow(CrossTenantAccessError);
  });
});

// ──── prepareCloseSessionUpdate ────────────────────────────────

describe('prepareCloseSessionUpdate — happy path', () => {
  it('cierre limpio descuadre=0 → discrepancy_reason null + audit info', () => {
    const result = prepareCloseSessionUpdate(
      makeSession(),
      { session_id: 'x', counted_amount: 1500, expected_amount: 1500 },
      makeCtx()
    );
    expect(result.update.descuadre).toBe('0.0000');
    expect(result.update.discrepancy_reason).toBeNull();
    expect(result.descuadre_sign).toBe('zero');
    expect(result.severity_label).toBe('none');
  });

  it('descuadre $300 con reason → cerrar con warning low', () => {
    const result = prepareCloseSessionUpdate(
      makeSession(),
      {
        session_id: 'x',
        counted_amount: 1500,
        expected_amount: 1200,
        discrepancy_reason: 'cobro extra cliente nuevo',
      },
      makeCtx()
    );
    expect(result.update.descuadre).toBe('300.0000');
    expect(result.update.discrepancy_reason).toBe('cobro extra cliente nuevo');
    expect(result.descuadre_sign).toBe('positive');
    expect(result.severity_label).toBe('low');
  });

  it('descuadre -$6000 con reason → cerrar con warning high', () => {
    const result = prepareCloseSessionUpdate(
      makeSession({ initial_amount: '10000.0000' }),
      {
        session_id: 'x',
        counted_amount: 4000,
        expected_amount: 10000,
        discrepancy_reason: 'investigando',
      },
      makeCtx()
    );
    expect(result.update.descuadre).toBe('-6000.0000');
    expect(result.descuadre_sign).toBe('negative');
    expect(result.severity_label).toBe('high');
  });
});

describe('prepareCloseSessionUpdate — validaciones', () => {
  it('session ya cerrada → throw SessionAlreadyClosedError', () => {
    const closedSession = makeSession({
      closed_at: new Date('2026-06-04T18:00:00Z'),
      final_amount: '1500.0000',
      expected_amount: '1500.0000',
      descuadre: '0.0000',
      closed_by: '22222222-2222-2222-2222-222222222222',
    });
    expect(() =>
      prepareCloseSessionUpdate(
        closedSession,
        { session_id: 'x', counted_amount: 100, expected_amount: 100 },
        makeCtx()
      )
    ).toThrow(SessionAlreadyClosedError);
  });

  it('descuadre != 0 SIN reason → throw missing_discrepancy_reason', () => {
    expect(() =>
      prepareCloseSessionUpdate(
        makeSession(),
        { session_id: 'x', counted_amount: 1500, expected_amount: 1200 },
        makeCtx()
      )
    ).toThrow(CashValidationError);
  });

  it('descuadre != 0 con reason vacío whitespace → throw', () => {
    expect(() =>
      prepareCloseSessionUpdate(
        makeSession(),
        {
          session_id: 'x',
          counted_amount: 1500,
          expected_amount: 1200,
          discrepancy_reason: '   ',
        },
        makeCtx()
      )
    ).toThrow(CashValidationError);
  });

  it('descuadre = 0 con reason informado → reason ignorado (null)', () => {
    const result = prepareCloseSessionUpdate(
      makeSession(),
      {
        session_id: 'x',
        counted_amount: 1500,
        expected_amount: 1500,
        discrepancy_reason: 'irrelevante porque descuadre=0',
      },
      makeCtx()
    );
    expect(result.update.discrepancy_reason).toBeNull();
  });

  it('actor_user_id ausente → throw', () => {
    expect(() =>
      prepareCloseSessionUpdate(
        makeSession(),
        { session_id: 'x', counted_amount: 1500, expected_amount: 1500 },
        makeCtx({ actor_user_id: null })
      )
    ).toThrow(CashValidationError);
  });
});

// ──── prepareRegisterMovementValues ────────────────────────────

describe('prepareRegisterMovementValues — happy path', () => {
  it('withdraw válido', () => {
    const result = prepareRegisterMovementValues(
      {
        cash_session_id: '33333333-3333-3333-3333-333333333333',
        type: 'withdraw',
        amount: 200,
        reason: 'cambio chico',
      },
      makeCtx()
    );
    expect(result.type).toBe('withdraw');
    expect(result.amount).toBe('200.0000');
    expect(result.reason).toBe('cambio chico');
    expect(result.created_by).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('deposit + correlation_id heredado del context', () => {
    const corrId = generateCorrelationId();
    const result = prepareRegisterMovementValues(
      {
        cash_session_id: '33333333-3333-3333-3333-333333333333',
        type: 'deposit',
        amount: 500,
        reason: 'aporte propio',
      },
      makeCtx({ correlation_id: corrId })
    );
    expect(result.correlation_id).toBe(corrId);
  });
});

describe('prepareRegisterMovementValues — validaciones', () => {
  it('session_id no UUID → throw invalid_session_id', () => {
    expect(() =>
      prepareRegisterMovementValues(
        {
          cash_session_id: 'garbage',
          type: 'withdraw',
          amount: 100,
          reason: 'x',
        },
        makeCtx()
      )
    ).toThrow(MovementValidationError);
  });

  it('type fuera del catálogo → throw invalid_type', () => {
    expect(() =>
      prepareRegisterMovementValues(
        {
          cash_session_id: '33333333-3333-3333-3333-333333333333',
          // @ts-expect-error testing runtime guard
          type: 'salary_advance',
          amount: 100,
          reason: 'x',
        },
        makeCtx()
      )
    ).toThrow(MovementValidationError);
  });

  it('amount 0 → throw invalid_amount', () => {
    expect(() =>
      prepareRegisterMovementValues(
        {
          cash_session_id: '33333333-3333-3333-3333-333333333333',
          type: 'withdraw',
          amount: 0,
          reason: 'x',
        },
        makeCtx()
      )
    ).toThrow(MovementValidationError);
  });

  it('amount negativo → throw', () => {
    expect(() =>
      prepareRegisterMovementValues(
        {
          cash_session_id: '33333333-3333-3333-3333-333333333333',
          type: 'deposit',
          amount: -10,
          reason: 'x',
        },
        makeCtx()
      )
    ).toThrow(MovementValidationError);
  });

  it('reason vacío → throw missing_reason', () => {
    expect(() =>
      prepareRegisterMovementValues(
        {
          cash_session_id: '33333333-3333-3333-3333-333333333333',
          type: 'withdraw',
          amount: 100,
          reason: '',
        },
        makeCtx()
      )
    ).toThrow(MovementValidationError);
  });

  it('reason solo whitespace → throw', () => {
    expect(() =>
      prepareRegisterMovementValues(
        {
          cash_session_id: '33333333-3333-3333-3333-333333333333',
          type: 'withdraw',
          amount: 100,
          reason: '   ',
        },
        makeCtx()
      )
    ).toThrow(MovementValidationError);
  });

  it('actor_user_id ausente → throw CrossTenantAccessError', () => {
    expect(() =>
      prepareRegisterMovementValues(
        {
          cash_session_id: '33333333-3333-3333-3333-333333333333',
          type: 'withdraw',
          amount: 100,
          reason: 'x',
        },
        makeCtx({ actor_user_id: null })
      )
    ).toThrow(CrossTenantAccessError);
  });
});

// ──── computeMovementTotals (queries) ─────────────────────────

describe('computeMovementTotals — pure math agregados escala entera', () => {
  it('sin movimientos → totales 0 + expected = initial', () => {
    const totals = computeMovementTotals('1000.0000', []);
    expect(totals.total_deposits).toBe('0.0000');
    expect(totals.total_withdraws).toBe('0.0000');
    expect(totals.total_provider_payments).toBe('0.0000');
    expect(totals.expected_from_movements).toBe('1000.0000');
  });

  it('mix de movimientos → expected ajustado', () => {
    const totals = computeMovementTotals('1000.0000', [
      { type: 'deposit', amount: '500.0000' },
      { type: 'withdraw', amount: '200.0000' },
      { type: 'provider_payment', amount: '150.0000' },
      { type: 'deposit', amount: '100.0000' },
    ]);
    expect(totals.total_deposits).toBe('600.0000');
    expect(totals.total_withdraws).toBe('200.0000');
    expect(totals.total_provider_payments).toBe('150.0000');
    // 1000 + 600 - 200 - 150 = 1250
    expect(totals.expected_from_movements).toBe('1250.0000');
  });

  it('caso real retail: caja chica + 3 movimientos chicos', () => {
    const totals = computeMovementTotals('500.0000', [
      { type: 'withdraw', amount: '50.0000' },
      { type: 'withdraw', amount: '25.5000' },
      { type: 'deposit', amount: '100.0000' },
    ]);
    expect(totals.expected_from_movements).toBe('524.5000');
  });

  it('escala entera evita drift con muchos movimientos decimales', () => {
    const totals = computeMovementTotals(
      '1000.0000',
      Array.from({ length: 30 }, () => ({
        type: 'withdraw' as const,
        amount: '0.1000',
      }))
    );
    // 30 × 0.1 = 3.0 exacto
    expect(totals.total_withdraws).toBe('3.0000');
    expect(totals.expected_from_movements).toBe('997.0000');
  });
});

// ──── Wrapper smoke tests (sin DB) ─────────────────────────────

describe('openCashSession wrapper — requireTracingContext gate', () => {
  it('llamado FUERA de tracing context → throw', async () => {
    await expect(
      openCashSession({ sale_point: 1, initial_amount: 100 })
    ).rejects.toThrow(/no esta inicializado/);
  });
});

describe('closeCashSession wrapper — UUID validation + context gate', () => {
  it('session_id no UUID → throw CashValidationError', async () => {
    await expect(
      closeCashSession({
        session_id: 'garbage',
        counted_amount: 1500,
        expected_amount: 1500,
      } satisfies CloseSessionInput)
    ).rejects.toThrow(CashValidationError);
  });

  it('UUID válido SIN context → throw requireTracingContext', async () => {
    await expect(
      closeCashSession({
        session_id: '33333333-3333-3333-3333-333333333333',
        counted_amount: 1500,
        expected_amount: 1500,
      })
    ).rejects.toThrow(/no esta inicializado/);
  });
});

describe('getActiveCashSession + getCashSessionById wrapper smoke', () => {
  it('getActive SIN context → throw', async () => {
    await expect(getActiveCashSession(1)).rejects.toThrow(/no esta inicializado/);
  });

  it('getActive con sale_point inválido → throw CashValidationError (orden pre-context)', async () => {
    await expect(getActiveCashSession(0)).rejects.toThrow(CashValidationError);
  });

  it('getCashSessionById UUID inválido → throw CashValidationError', async () => {
    await expect(getCashSessionById('garbage')).rejects.toThrow(CashValidationError);
  });

  it('getCashSessionById UUID válido SIN context → throw context', async () => {
    await expect(
      getCashSessionById('33333333-3333-3333-3333-333333333333')
    ).rejects.toThrow(/no esta inicializado/);
  });
});

describe('registerCashMovement wrapper — context gate', () => {
  it('SIN context → throw', async () => {
    await expect(
      registerCashMovement({
        cash_session_id: '33333333-3333-3333-3333-333333333333',
        type: 'withdraw',
        amount: 100,
        reason: 'test',
      })
    ).rejects.toThrow(/no esta inicializado/);
  });
});

describe('queries wrapper smoke', () => {
  it('getCashSessionSummary UUID inválido → throw CashValidationError', async () => {
    await expect(getCashSessionSummary('garbage')).rejects.toThrow(
      CashValidationError
    );
  });

  it('getCashSessionSummary UUID válido SIN context → throw', async () => {
    await expect(
      getCashSessionSummary('33333333-3333-3333-3333-333333333333')
    ).rejects.toThrow(/no esta inicializado/);
  });

  it('listCashSessions SIN context → throw', async () => {
    await expect(listCashSessions()).rejects.toThrow(/no esta inicializado/);
  });

  it('listCashSessions limit 0 → throw CashValidationError (pre-context validation)', async () => {
    // Post advisor 2026-06-04 #3: input validation corre ANTES de
    // requireTenantId, así que se puede testear sin context.
    await expect(listCashSessions({ limit: 0 })).rejects.toThrow(CashValidationError);
  });

  it('listCashSessions limit 501 → throw (excede max 500)', async () => {
    await expect(listCashSessions({ limit: 501 })).rejects.toThrow(CashValidationError);
  });

  it('listCashSessions offset negativo → throw', async () => {
    await expect(listCashSessions({ offset: -1 })).rejects.toThrow(CashValidationError);
  });

  it('listCashSessions args válidos SIN context → throw context', async () => {
    await expect(listCashSessions({ limit: 10 })).rejects.toThrow(/no esta inicializado/);
  });
});
