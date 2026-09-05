/**
 * T-POS-PAY-01 — qué medios de pago puede realmente cobrar el POS.
 *
 * Fija contra el schema real lo que el cajero tiene permitido elegir, para
 * que la UI no vuelva a ofrecer una opción que el backend rechaza.
 *
 * **El bug que motivó estos casos:** el POS ofrecía "QR / MP" y mandaba
 * `{ method: 'mp_qr', amount }` sin `mp_payment_external_id`. El refine del
 * schema lo rechaza SIEMPRE, así que esa opción del menú no podía completar
 * una venta jamás. No es un caso borde: es una fila del cobro que estaba
 * rota desde que se dibujó.
 *
 * El id externo lo emite el SDK de MercadoPago al crear el pago, y ese flujo
 * todavía no existe (`mp-secret.ts` deja el onboarding de MP como TODO).
 * Hasta que exista, mp_qr no es cobrable desde el POS.
 */
import { describe, expect, it } from 'vitest';
import { PaymentItemSchema } from '@/lib/services/sales/types';
import { SALE_PAYMENT_METHODS } from '@/lib/db/schema/_common';

describe('T-POS-PAY-01 — medios cobrables desde el POS', () => {
  it('efectivo, débito y crédito se aceptan sin datos extra', () => {
    for (const method of ['efectivo', 'debito', 'credito'] as const) {
      const r = PaymentItemSchema.safeParse({ method, amount: '1500.00' });
      expect(r.success, `${method} debería ser cobrable`).toBe(true);
    }
  });

  it('mp_qr SIN external id se rechaza — el bug que tenía el POS', () => {
    const r = PaymentItemSchema.safeParse({
      method: 'mp_qr',
      amount: '1500.00',
    });

    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('mp_payment_external_id');
    }
  });

  it('mp_qr CON external id sí se acepta (cuando exista el flujo de MP)', () => {
    const r = PaymentItemSchema.safeParse({
      method: 'mp_qr',
      amount: '1500.00',
      mp_payment_external_id: 'mp-123456789',
    });

    expect(r.success).toBe(true);
  });

  it('el external id está PROHIBIDO en los medios que no son mp_qr', () => {
    const r = PaymentItemSchema.safeParse({
      method: 'efectivo',
      amount: '1500.00',
      mp_payment_external_id: 'mp-123456789',
    });

    expect(r.success).toBe(false);
  });

  it('el catálogo de medios incluye débito y crédito separados', () => {
    // El arqueo los separa (acreditan distinto), así que no alcanza con el
    // genérico 'tarjeta'. Si alguien los colapsa, el cierre de caja miente.
    expect(SALE_PAYMENT_METHODS).toContain('debito');
    expect(SALE_PAYMENT_METHODS).toContain('credito');
    // 'tarjeta' se retiene como legacy para ventas viejas del cajero que no
    // discriminaba — sigue siendo válido, pero el POS ya no lo ofrece.
    expect(SALE_PAYMENT_METHODS).toContain('tarjeta');
  });
});
