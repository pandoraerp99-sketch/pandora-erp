/**
 * Tests unitarios — status_detail MercadoPago → mensaje para el cajero.
 * Sprint 5 Sales+MP · Integrations context.
 *
 * Cubre:
 * - approved / pending / rejected con su categoria
 * - recoverable segun el tipo de rechazo (corregible vs conviene otro medio)
 * - desconocido / null / vacio → fallback generico seguro (nunca throw)
 * - case-insensitive + trim
 */
import { describe, expect, it } from 'vitest';
import { statusDetailMessage } from '@/lib/integrations/mercadopago';

describe('statusDetailMessage — categorias', () => {
  it('accredited → approved', () => {
    const r = statusDetailMessage('accredited');
    expect(r.category).toBe('approved');
  });

  it('pending_contingency → pending', () => {
    expect(statusDetailMessage('pending_contingency').category).toBe('pending');
  });

  it('cc_rejected_insufficient_amount → rejected, NO recoverable, menciona fondos', () => {
    const r = statusDetailMessage('cc_rejected_insufficient_amount');
    expect(r.category).toBe('rejected');
    expect(r.recoverable).toBe(false);
    expect(r.message.toLowerCase()).toContain('fondos');
  });

  it('cc_rejected_bad_filled_security_code → rejected pero recoverable (corregible)', () => {
    const r = statusDetailMessage('cc_rejected_bad_filled_security_code');
    expect(r.category).toBe('rejected');
    expect(r.recoverable).toBe(true);
  });

  it('cc_rejected_call_for_authorize → recoverable (el cliente autoriza con el banco)', () => {
    expect(statusDetailMessage('cc_rejected_call_for_authorize').recoverable).toBe(true);
  });
});

describe('statusDetailMessage — fail-safe', () => {
  it('codigo desconocido → unknown generico, no recoverable', () => {
    const r = statusDetailMessage('cc_rejected_martian_invasion');
    expect(r).toEqual({
      message: 'El pago no se pudo completar.',
      category: 'unknown',
      recoverable: false,
    });
  });

  it('null / undefined / vacio → unknown', () => {
    expect(statusDetailMessage(null).category).toBe('unknown');
    expect(statusDetailMessage(undefined).category).toBe('unknown');
    expect(statusDetailMessage('').category).toBe('unknown');
  });

  it('case-insensitive + trim', () => {
    const r = statusDetailMessage('  CC_REJECTED_INSUFFICIENT_AMOUNT  ');
    expect(r.category).toBe('rejected');
    expect(r.recoverable).toBe(false);
  });
});
