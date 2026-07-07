/**
 * Tests unitarios — parseo del body de notificaciones webhook MercadoPago.
 * Sprint 5 Sales+MP · Integrations context.
 *
 * Cubre:
 * - notificacion de pago valida (data.id numerico y string)
 * - recursos no-payment → ignored
 * - body corrupto / shape invalido → invalid (cada razon tipada)
 * - INVARIANTE "verify, don't trust": el parser NUNCA expone un status del body
 */
import { describe, expect, it } from 'vitest';
import { parseMpWebhookNotification } from '@/lib/integrations/mercadopago';

function body(obj: unknown): string {
  return JSON.stringify(obj);
}

describe('parseMpWebhookNotification — payment valido', () => {
  it('parsea una notificacion de pago (data.id numerico)', () => {
    const res = parseMpWebhookNotification(
      body({
        id: 12345,
        live_mode: true,
        type: 'payment',
        action: 'payment.updated',
        date_created: '2026-06-21T10:04:58.396-03:00',
        data: { id: 999999999 },
      })
    );
    expect(res).toEqual({
      kind: 'payment',
      notificationId: '12345',
      paymentId: '999999999',
      action: 'payment.updated',
      liveMode: true,
    });
  });

  it('normaliza data.id string y tolera campos opcionales ausentes', () => {
    const res = parseMpWebhookNotification(
      body({ type: 'payment', data: { id: 'abc-123' } })
    );
    expect(res).toEqual({
      kind: 'payment',
      notificationId: null,
      paymentId: 'abc-123',
      action: null,
      liveMode: false,
    });
  });
});

describe('parseMpWebhookNotification — ignored', () => {
  it('ignora recursos que no son payment (merchant_order)', () => {
    const res = parseMpWebhookNotification(
      body({ type: 'merchant_order', data: { id: 1 } })
    );
    expect(res).toEqual({ kind: 'ignored', type: 'merchant_order' });
  });

  it('sin type → ignored con type "unknown"', () => {
    const res = parseMpWebhookNotification(body({ data: { id: 1 } }));
    expect(res).toEqual({ kind: 'ignored', type: 'unknown' });
  });
});

describe('parseMpWebhookNotification — invalid', () => {
  it('body que no es JSON → body_not_json', () => {
    expect(parseMpWebhookNotification('no soy json {')).toEqual({
      kind: 'invalid',
      reason: 'body_not_json',
    });
  });

  it('payment sin objeto data → payment_without_data_id', () => {
    expect(parseMpWebhookNotification(body({ type: 'payment' }))).toEqual({
      kind: 'invalid',
      reason: 'payment_without_data_id',
    });
  });

  it('payment con data.id vacio → payment_without_data_id', () => {
    expect(
      parseMpWebhookNotification(body({ type: 'payment', data: { id: '' } }))
    ).toEqual({ kind: 'invalid', reason: 'payment_without_data_id' });
  });

  it('data presente pero sin id → schema_mismatch', () => {
    expect(
      parseMpWebhookNotification(body({ type: 'payment', data: {} }))
    ).toEqual({ kind: 'invalid', reason: 'schema_mismatch' });
  });

  it('tipos incorrectos (live_mode string) → schema_mismatch', () => {
    expect(
      parseMpWebhookNotification(
        body({ type: 'payment', live_mode: 'yes', data: { id: 1 } })
      )
    ).toEqual({ kind: 'invalid', reason: 'schema_mismatch' });
  });
});

describe('parseMpWebhookNotification — invariante verify-dont-trust', () => {
  it('un `status` inyectado en el body NUNCA se expone en el resultado', () => {
    const res = parseMpWebhookNotification(
      body({
        type: 'payment',
        action: 'payment.updated',
        // atacante/legacy intenta colar un status "aprobado" en el body
        status: 'approved',
        data: { id: 42, status: 'approved' },
      })
    );
    expect(res.kind).toBe('payment');
    // el resultado no debe cargar ningun status confiable del body
    expect(res).not.toHaveProperty('status');
    expect(JSON.stringify(res)).not.toContain('approved');
  });
});
