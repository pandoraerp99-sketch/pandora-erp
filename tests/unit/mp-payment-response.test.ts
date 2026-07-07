/**
 * Tests unitarios — parseo de la respuesta GET /v1/payments/{id} de MercadoPago.
 * Sprint 5 Sales+MP · Integrations context.
 *
 * Cubre:
 * - pago approved valido → campos + status canonico + amount storage + external_reference
 * - status no-canonico (authorized) → pending + statusReclassified
 * - conversion de transaction_amount (number MP) → money storage
 * - body invalido / shape incorrecto → ok:false tipado
 */
import { describe, expect, it } from 'vitest';
import { parseMpPaymentResponse } from '@/lib/integrations/mercadopago';
import { moneyEq } from '@/lib/money/decimal';

function body(obj: unknown): string {
  return JSON.stringify(obj);
}

const APPROVED = {
  id: 123456789,
  status: 'approved',
  status_detail: 'accredited',
  transaction_amount: 1234.56,
  external_reference: 'sale_payment_abc',
  payment_method_id: 'visa',
  date_approved: '2026-06-21T10:05:12.000-03:00',
};

describe('parseMpPaymentResponse — pago valido', () => {
  it('parsea un pago approved con todos los campos F0', () => {
    const res = parseMpPaymentResponse(body(APPROVED));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payment.paymentId).toBe('123456789');
    expect(res.payment.status).toBe('approved');
    expect(res.payment.statusReclassified).toBe(false);
    expect(res.payment.rawStatus).toBe('approved');
    expect(res.payment.statusDetail).toBe('accredited');
    expect(res.payment.externalReference).toBe('sale_payment_abc');
    expect(res.payment.paymentMethodId).toBe('visa');
    // amount convertido a storage; comparamos por valor monetario (scale-agnostic)
    expect(moneyEq(res.payment.amount, '1234.56')).toBe(true);
  });

  it('status no-canonico (authorized) → pending + statusReclassified', () => {
    const res = parseMpPaymentResponse(
      body({ ...APPROVED, status: 'authorized', status_detail: 'pending_capture' })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payment.status).toBe('pending');
    expect(res.payment.statusReclassified).toBe(true);
    expect(res.payment.rawStatus).toBe('authorized');
  });

  it('campos opcionales null/ausentes → null', () => {
    const res = parseMpPaymentResponse(
      body({ id: 1, status: 'pending', transaction_amount: 10 })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payment.externalReference).toBeNull();
    expect(res.payment.statusDetail).toBeNull();
    expect(res.payment.paymentMethodId).toBeNull();
    expect(res.payment.dateApproved).toBeNull();
  });
});

describe('parseMpPaymentResponse — invalido', () => {
  it('body que no es JSON → not_json', () => {
    expect(parseMpPaymentResponse('roto {')).toEqual({ ok: false, reason: 'not_json' });
  });

  it('sin status → schema_mismatch', () => {
    expect(
      parseMpPaymentResponse(body({ id: 1, transaction_amount: 10 }))
    ).toEqual({ ok: false, reason: 'schema_mismatch' });
  });

  it('transaction_amount ausente → schema_mismatch', () => {
    expect(
      parseMpPaymentResponse(body({ id: 1, status: 'approved' }))
    ).toEqual({ ok: false, reason: 'schema_mismatch' });
  });

  it('transaction_amount como string → schema_mismatch (nunca coercionamos money)', () => {
    expect(
      parseMpPaymentResponse(body({ id: 1, status: 'approved', transaction_amount: '10' }))
    ).toEqual({ ok: false, reason: 'schema_mismatch' });
  });
});
