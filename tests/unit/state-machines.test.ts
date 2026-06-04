import { describe, expect, it } from 'vitest';
import {
  assertCommercialTransition,
  assertFiscalTransition,
  canTransitionCommercial,
  canTransitionFiscal,
  isCommercialTerminal,
  isFiscalTerminal,
  listAllowedFiscalTransitions,
} from '@/lib/domain/state-machines';
import { StateTransitionError } from '@/lib/multi_tenant/errors';

describe('commercial state machine', () => {
  it('permite happy path draft -> terminada', () => {
    expect(canTransitionCommercial('draft', 'in_progress')).toBe(true);
    expect(canTransitionCommercial('in_progress', 'cobrando')).toBe(true);
    expect(canTransitionCommercial('cobrando', 'cobrada')).toBe(true);
    expect(canTransitionCommercial('cobrada', 'terminada')).toBe(true);
  });

  it('permite cancelar desde estados no-terminales', () => {
    expect(canTransitionCommercial('draft', 'cancelada')).toBe(true);
    expect(canTransitionCommercial('in_progress', 'cancelada')).toBe(true);
    expect(canTransitionCommercial('cobrando', 'cancelada')).toBe(true);
    expect(canTransitionCommercial('cobrada', 'cancelada')).toBe(true);
  });

  it('terminada y cancelada son terminales', () => {
    expect(isCommercialTerminal('terminada')).toBe(true);
    expect(isCommercialTerminal('cancelada')).toBe(true);
    expect(canTransitionCommercial('terminada', 'draft')).toBe(false);
    expect(canTransitionCommercial('cancelada', 'draft')).toBe(false);
  });

  it('skip de estados no permitido', () => {
    expect(canTransitionCommercial('draft', 'cobrada')).toBe(false);
    expect(canTransitionCommercial('in_progress', 'terminada')).toBe(false);
  });

  it('assertCommercialTransition lanza StateTransitionError', () => {
    expect(() => assertCommercialTransition('terminada', 'draft')).toThrow(
      StateTransitionError
    );
  });
});

describe('fiscal state machine', () => {
  it('happy path pending -> requesting -> issued', () => {
    expect(canTransitionFiscal('pending', 'requesting')).toBe(true);
    expect(canTransitionFiscal('requesting', 'issued')).toBe(true);
  });

  it('issued es terminal — no se transiciona afuera', () => {
    expect(isFiscalTerminal('issued')).toBe(true);
    expect(canTransitionFiscal('issued', 'pending')).toBe(false);
    expect(canTransitionFiscal('issued', 'failed')).toBe(false);
  });

  it('requires_reconciliation puede retry (a si mismo)', () => {
    expect(canTransitionFiscal('requires_reconciliation', 'requires_reconciliation')).toBe(
      true
    );
  });

  it('recovery exitoso: requires_reconciliation -> reconciled_issued', () => {
    expect(canTransitionFiscal('requires_reconciliation', 'reconciled_issued')).toBe(true);
  });

  it('recovery mismatch: requires_reconciliation -> number_burned -> manual', () => {
    expect(canTransitionFiscal('requires_reconciliation', 'number_burned')).toBe(true);
    expect(canTransitionFiscal('number_burned', 'manual_resolution_required')).toBe(true);
  });

  it('failed (rechazo AFIP) -> manual', () => {
    expect(canTransitionFiscal('requesting', 'failed')).toBe(true);
    expect(canTransitionFiscal('failed', 'manual_resolution_required')).toBe(true);
    expect(canTransitionFiscal('failed', 'requesting')).toBe(false);
  });

  it('contingency permite vuelta a issued cuando AFIP responde', () => {
    expect(canTransitionFiscal('requesting', 'contingency')).toBe(true);
    expect(canTransitionFiscal('contingency', 'issued')).toBe(true);
    expect(canTransitionFiscal('contingency', 'manual_resolution_required')).toBe(true);
  });

  it('assertFiscalTransition lanza StateTransitionError', () => {
    expect(() => assertFiscalTransition('issued', 'pending')).toThrow(StateTransitionError);
  });

  it('not_required es terminal', () => {
    expect(isFiscalTerminal('not_required')).toBe(true);
    expect(listAllowedFiscalTransitions('not_required')).toEqual([]);
  });
});
