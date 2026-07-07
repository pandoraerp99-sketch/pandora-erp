/**
 * Tests unitarios — mapeo status API MercadoPago → enum canonico F0.
 * Sprint 5 Sales+MP · Integrations context.
 *
 * Cubre:
 * - statuses canonicos 1:1 (reclassified false)
 * - no-canonicos conocidos → pending + reclassified (fail-safe "reclassify with audit")
 * - desconocidos → pending + reclassified (nunca se descarta en silencio)
 * - case-insensitive + trim
 * - isKnownMpApiStatus
 */
import { describe, expect, it } from 'vitest';
import {
  mapMpApiPaymentStatus,
  isKnownMpApiStatus,
} from '@/lib/integrations/mercadopago';

describe('mapMpApiPaymentStatus — canonicos F0', () => {
  it.each([
    ['pending', 'pending'],
    ['approved', 'approved'],
    ['rejected', 'rejected'],
    ['cancelled', 'cancelled'],
    ['refunded', 'refunded'],
  ] as const)('%s → %s (sin reclasificar)', (raw, expected) => {
    expect(mapMpApiPaymentStatus(raw)).toEqual({
      status: expected,
      reclassified: false,
      raw,
    });
  });
});

describe('mapMpApiPaymentStatus — no-canonicos conocidos → pending + reclassify', () => {
  it.each(['authorized', 'in_process', 'in_mediation', 'charged_back'])(
    '%s → pending con reclassified=true',
    (raw) => {
      expect(mapMpApiPaymentStatus(raw)).toEqual({
        status: 'pending',
        reclassified: true,
        raw,
      });
    }
  );
});

describe('mapMpApiPaymentStatus — fail-safe', () => {
  it('status desconocido → pending + reclassified (nunca se descarta)', () => {
    expect(mapMpApiPaymentStatus('quantum_state')).toEqual({
      status: 'pending',
      reclassified: true,
      raw: 'quantum_state',
    });
  });

  it('es case-insensitive y hace trim', () => {
    expect(mapMpApiPaymentStatus('  APPROVED  ')).toEqual({
      status: 'approved',
      reclassified: false,
      raw: 'approved',
    });
  });

  it('nunca lanza (input arbitrario siempre devuelve un MpPaymentStatus)', () => {
    expect(() => mapMpApiPaymentStatus('')).not.toThrow();
    expect(mapMpApiPaymentStatus('').status).toBe('pending');
  });
});

describe('isKnownMpApiStatus', () => {
  it('reconoce canonicos y no-canonicos documentados', () => {
    expect(isKnownMpApiStatus('approved')).toBe(true);
    expect(isKnownMpApiStatus('charged_back')).toBe(true);
    expect(isKnownMpApiStatus('IN_PROCESS')).toBe(true);
  });

  it('rechaza desconocidos', () => {
    expect(isKnownMpApiStatus('quantum_state')).toBe(false);
    expect(isKnownMpApiStatus('')).toBe(false);
  });
});
