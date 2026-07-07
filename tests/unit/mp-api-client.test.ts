/**
 * Tests unitarios — cliente HTTP getMpPayment (re-fetch autoritativo).
 * Sprint 5 Sales+MP · Integrations context. Sin keys reales: fetch inyectado.
 *
 * Cubre:
 * - happy path (200 + payment valido) → ok, y llama la URL + Bearer correctos
 * - 401/403 → unauthorized · 404 → not_found · 5xx → http_error
 * - fetch throw (red) → network_error
 * - 200 con body corrupto → parse_error
 */
import { describe, expect, it, vi } from 'vitest';
import { getMpPayment, type MpFetch } from '@/lib/integrations/mercadopago/mp-api-client';

const APPROVED = {
  id: 123456789,
  status: 'approved',
  status_detail: 'accredited',
  transaction_amount: 1500,
  external_reference: 'sale_payment_xyz',
  payment_method_id: 'master',
};

function mockFetch(status: number, bodyText: string): MpFetch {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => bodyText,
  }));
}

describe('getMpPayment — happy path', () => {
  it('200 + payment valido → ok con el payment parseado', async () => {
    const fetchFn = mockFetch(200, JSON.stringify(APPROVED));
    const res = await getMpPayment('123456789', {
      accessToken: 'TEST-TOKEN',
      baseUrl: 'https://api.test',
      fetchFn,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payment.status).toBe('approved');
    expect(res.payment.externalReference).toBe('sale_payment_xyz');
    // llama la URL correcta con Bearer token
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.test/v1/payments/123456789',
      { headers: { Authorization: 'Bearer TEST-TOKEN', Accept: 'application/json' } }
    );
  });
});

describe('getMpPayment — errores HTTP', () => {
  it('401 → unauthorized', async () => {
    const res = await getMpPayment('1', { accessToken: 't', fetchFn: mockFetch(401, '') });
    expect(res).toEqual({ ok: false, reason: 'unauthorized', status: 401 });
  });

  it('403 → unauthorized', async () => {
    const res = await getMpPayment('1', { accessToken: 't', fetchFn: mockFetch(403, '') });
    expect(res).toEqual({ ok: false, reason: 'unauthorized', status: 403 });
  });

  it('404 → not_found', async () => {
    const res = await getMpPayment('1', { accessToken: 't', fetchFn: mockFetch(404, '') });
    expect(res).toEqual({ ok: false, reason: 'not_found', status: 404 });
  });

  it('500 → http_error', async () => {
    const res = await getMpPayment('1', { accessToken: 't', fetchFn: mockFetch(500, '') });
    expect(res).toEqual({ ok: false, reason: 'http_error', status: 500 });
  });
});

describe('getMpPayment — red y parseo', () => {
  it('fetch lanza (timeout/red) → network_error', async () => {
    const fetchFn: MpFetch = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const res = await getMpPayment('1', { accessToken: 't', fetchFn });
    expect(res).toEqual({ ok: false, reason: 'network_error' });
  });

  it('200 con body corrupto → parse_error', async () => {
    const res = await getMpPayment('1', { accessToken: 't', fetchFn: mockFetch(200, 'no-json {') });
    expect(res).toEqual({ ok: false, reason: 'parse_error' });
  });
});
