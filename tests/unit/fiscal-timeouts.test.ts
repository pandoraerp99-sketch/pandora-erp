/**
 * El timeout de AFIP tiene que entrar dentro del de la base.
 *
 * La otra mitad de HIGH-2 (auditoría externa 2026-07-10). `emitInvoice`
 * sostiene una transacción abierta —con el lock de la secuencia fiscal—
 * mientras espera a AFIP. Si Postgres tiene `idle_in_transaction_session_timeout`
 * y ese número es MENOR que lo que esperamos, la base corta primero: el número
 * no avanza, el snapshot no se escribe, y si AFIP igual autorizó queda un CAE
 * emitido que la app no registró. Es el peor estado posible: hay que
 * resolverlo a mano contra AFIP.
 *
 * Se testea PURO a propósito. En desarrollo el timeout de la base está en 0
 * (sin límite), así que un test contra la base real pasaría siempre y no
 * probaría nada — que es exactamente cómo esta clase de bug llega a producción.
 */
import { describe, expect, it } from 'vitest';
import { assertAfipTimeoutFitsDb } from '@/lib/fiscal/fiscal-db-guard';
import { AFIP_TIMEOUT_MS } from '@/lib/integrations/afip/soap-transport';

const seg = (n: number) => n * 1000;

describe('orden de timeouts AFIP vs base', () => {
  it('pasa cuando la base aguanta más que AFIP + margen', () => {
    expect(() => assertAfipTimeoutFitsDb(seg(30), seg(60))).not.toThrow();
  });

  it('FALLA si la base corta antes que nosotros', () => {
    expect(() => assertAfipTimeoutFitsDb(seg(30), seg(20))).toThrow(/timeout/i);
  });

  it('FALLA también cuando están justos: el margen existe por algo', () => {
    // Entre que AFIP corta y que la transición de estado se escribe pasa
    // tiempo. Sin margen, la base corta en el medio de esa escritura.
    expect(() => assertAfipTimeoutFitsDb(seg(30), seg(31))).toThrow();
  });

  it('la base en 0 significa SIN LÍMITE: no hay conflicto', () => {
    // Es el caso de desarrollo. Que no falle acá es lo que hace inútil probar
    // esto contra la base local.
    expect(() => assertAfipTimeoutFitsDb(seg(30), 0)).not.toThrow();
  });

  it('el timeout real del transporte entra en un Postgres típico', () => {
    // Guardia sobre la constante de verdad: si alguien sube AFIP_TIMEOUT_MS a
    // 60s, esto se pone rojo y lo obliga a mirar el otro lado.
    expect(() => assertAfipTimeoutFitsDb(AFIP_TIMEOUT_MS, seg(60))).not.toThrow();
    expect(AFIP_TIMEOUT_MS).toBeLessThanOrEqual(seg(30));
  });
});
