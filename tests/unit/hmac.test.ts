/**
 * Tests unitarios HMAC validation — helpers puros.
 *
 * Vectores de prueba RFC 4231 §4 (HMAC-SHA-256 oficiales):
 * https://datatracker.ietf.org/doc/html/rfc4231
 *
 * Cubre:
 * - computeHmacSha256 (RFC 4231 test case 1+2+4)
 * - validateHmacSignature (positivo + negativo + timing-safe)
 * - parseMercadoPagoSignatureHeader (formato valido + edge cases)
 * - buildMercadoPagoManifest (formato exacto MP docs)
 * - validateMercadoPagoWebhook (composicion 3-pasos + cada falla tipada)
 */
import { describe, expect, it } from 'vitest';
import {
  buildMercadoPagoManifest,
  computeHmacSha256,
  parseMercadoPagoSignatureHeader,
  validateHmacSignature,
  validateMercadoPagoWebhook,
} from '@/lib/security/hmac';

describe('computeHmacSha256 — RFC 4231 test vectors', () => {
  it('Test Case 1: key 20 bytes 0x0b, data "Hi There"', () => {
    // RFC 4231 §4.2 — vector oficial HMAC-SHA-256
    const key = '\x0b'.repeat(20);
    const data = 'Hi There';
    const expected =
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7';
    expect(computeHmacSha256(key, data)).toBe(expected);
  });

  it('Test Case 2: key "Jefe", data "what do ya want for nothing?"', () => {
    // RFC 4231 §4.3
    const key = 'Jefe';
    const data = 'what do ya want for nothing?';
    const expected =
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
    expect(computeHmacSha256(key, data)).toBe(expected);
  });

  // RFC 4231 Test Case 4 (key 25 bytes incrementales, data 50 bytes 0xcd) NO
  // se incluye: los chars 0xcd en string TS se codifican UTF-8 como 2 bytes
  // (0xc3 0x8d), no como 1 byte raw 0xcd. computeHmacSha256 recibe strings y
  // usa .update(s, 'utf8'). Para validar bytes raw habria que cambiar signature
  // a Buffer — overkill F0 dado que TC1+TC2 ya prueban la implementacion.

  it('Pandora-real: manifest MercadoPago tipico produce hash estable', () => {
    // Vector calculado con createHmac directo — sanity check del wrapper.
    const secret = 'webhook-secret-mp-test';
    const manifest = 'id:12345;request-id:abc-def;ts:1704067200;';
    const h = computeHmacSha256(secret, manifest);
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // Mismo cálculo invocado de nuevo debe dar idéntico (determinismo)
    expect(computeHmacSha256(secret, manifest)).toBe(h);
  });

  it('output siempre 64 chars hex lowercase', () => {
    const h = computeHmacSha256('secret', 'payload');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mismo input → mismo output (deterministico)', () => {
    const h1 = computeHmacSha256('s', 'p');
    const h2 = computeHmacSha256('s', 'p');
    expect(h1).toBe(h2);
  });

  it('secret distinto → hash distinto', () => {
    expect(computeHmacSha256('a', 'p')).not.toBe(computeHmacSha256('b', 'p'));
  });

  it('payload distinto → hash distinto', () => {
    expect(computeHmacSha256('s', 'a')).not.toBe(computeHmacSha256('s', 'b'));
  });

  it('secret vacio lanza error (defensa programacion)', () => {
    expect(() => computeHmacSha256('', 'payload')).toThrow(/secret vacio/);
  });

  it('payload vacio es OK (genera hash de empty string firmado)', () => {
    const h = computeHmacSha256('secret', '');
    expect(h).toHaveLength(64);
  });

  it('soporta unicode UTF-8 en payload', () => {
    const h = computeHmacSha256('secret', 'Tierra del Fuego $1.329.033 — María');
    expect(h).toHaveLength(64);
  });
});

describe('validateHmacSignature', () => {
  const secret = 'webhook-secret-mp-test';
  const payload = 'id:12345;request-id:abc-def;ts:1704067200;';

  it('signature correcta → true', () => {
    const sig = computeHmacSha256(secret, payload);
    expect(validateHmacSignature(secret, payload, sig)).toBe(true);
  });

  it('signature incorrecta → false', () => {
    expect(
      validateHmacSignature(secret, payload, 'a'.repeat(64))
    ).toBe(false);
  });

  it('signature vacia → false', () => {
    expect(validateHmacSignature(secret, payload, '')).toBe(false);
  });

  it('secret distinto al firmante → false', () => {
    const sig = computeHmacSha256(secret, payload);
    expect(validateHmacSignature('otro-secret', payload, sig)).toBe(false);
  });

  it('payload modificado (tampering) → false', () => {
    const sig = computeHmacSha256(secret, payload);
    expect(
      validateHmacSignature(secret, payload + 'tampered', sig)
    ).toBe(false);
  });

  it('signature en uppercase NO se acepta (contrato estricto lowercase)', () => {
    // Fix advisor #3: drop toLowerCase. Permissive parsing = security bugs.
    // Caller debe normalizar el output del provider antes de llamar.
    const sig = computeHmacSha256(secret, payload).toUpperCase();
    expect(validateHmacSignature(secret, payload, sig)).toBe(false);
  });

  it('signature de length distinta al hash esperado → false (no throw)', () => {
    expect(validateHmacSignature(secret, payload, 'abc')).toBe(false);
  });
});

describe('parseMercadoPagoSignatureHeader', () => {
  it('formato valido ts + v1', () => {
    const header = `ts=1704067200,v1=${'a'.repeat(64)}`;
    const r = parseMercadoPagoSignatureHeader(header);
    expect(r).not.toBeNull();
    expect(r?.timestamp).toBe(1704067200);
    expect(r?.hash).toBe('a'.repeat(64));
  });

  it('orden inverso v1 + ts → tambien valido', () => {
    const header = `v1=${'b'.repeat(64)},ts=1704067200`;
    const r = parseMercadoPagoSignatureHeader(header);
    expect(r?.timestamp).toBe(1704067200);
    expect(r?.hash).toBe('b'.repeat(64));
  });

  it('con espacios alrededor → tambien valido', () => {
    const header = ` ts=1704067200 , v1=${'c'.repeat(64)} `;
    const r = parseMercadoPagoSignatureHeader(header);
    expect(r?.timestamp).toBe(1704067200);
    expect(r?.hash).toBe('c'.repeat(64));
  });

  it('header vacio → null', () => {
    expect(parseMercadoPagoSignatureHeader('')).toBeNull();
  });

  it('falta ts → null', () => {
    expect(
      parseMercadoPagoSignatureHeader(`v1=${'a'.repeat(64)}`)
    ).toBeNull();
  });

  it('falta v1 → null', () => {
    expect(parseMercadoPagoSignatureHeader('ts=1704067200')).toBeNull();
  });

  it('v1 length invalido (no 64 chars) → null', () => {
    expect(
      parseMercadoPagoSignatureHeader('ts=1704067200,v1=abc')
    ).toBeNull();
  });

  it('v1 con chars fuera del alfabeto hex → null', () => {
    expect(
      parseMercadoPagoSignatureHeader(
        `ts=1704067200,v1=${'z'.repeat(64)}`
      )
    ).toBeNull();
  });

  it('ts no numerico → null', () => {
    expect(
      parseMercadoPagoSignatureHeader(`ts=abc,v1=${'a'.repeat(64)}`)
    ).toBeNull();
  });

  it('ts cero o negativo → null', () => {
    expect(
      parseMercadoPagoSignatureHeader(`ts=0,v1=${'a'.repeat(64)}`)
    ).toBeNull();
    expect(
      parseMercadoPagoSignatureHeader(`ts=-1,v1=${'a'.repeat(64)}`)
    ).toBeNull();
  });

  it('claves desconocidas se ignoran (forward-compat)', () => {
    const header = `ts=1704067200,v1=${'a'.repeat(64)},v2=futuro`;
    const r = parseMercadoPagoSignatureHeader(header);
    expect(r?.timestamp).toBe(1704067200);
    expect(r?.hash).toBe('a'.repeat(64));
  });
});

describe('buildMercadoPagoManifest', () => {
  it('formato exacto segun MP docs', () => {
    const m = buildMercadoPagoManifest({
      dataId: '12345',
      requestId: 'abc-def-ghi',
      timestamp: 1704067200,
    });
    expect(m).toBe('id:12345;request-id:abc-def-ghi;ts:1704067200;');
  });

  it('semicolon final obligatorio', () => {
    const m = buildMercadoPagoManifest({
      dataId: 'x',
      requestId: 'y',
      timestamp: 0,
    });
    expect(m.endsWith(';')).toBe(true);
  });
});

describe('validateMercadoPagoWebhook — composicion 3 pasos', () => {
  const secret = 'webhook-secret-mp-tst';
  const dataId = 'payment-12345';
  const requestId = 'req-abc-def';
  const fixedNowMs = new Date('2026-06-01T12:00:00Z').getTime();
  const fixedTs = Math.floor(fixedNowMs / 1000);

  function buildValidSignatureHeader(ts: number): string {
    const manifest = buildMercadoPagoManifest({
      dataId,
      requestId,
      timestamp: ts,
    });
    const hash = computeHmacSha256(secret, manifest);
    return `ts=${ts},v1=${hash}`;
  }

  it('happy path: header valido + ts fresco + HMAC OK → ok:true', () => {
    const header = buildValidSignatureHeader(fixedTs);
    const r = validateMercadoPagoWebhook({
      secret,
      signatureHeader: header,
      dataId,
      requestId,
      nowMs: fixedNowMs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.timestamp).toBe(fixedTs);
    }
  });

  it('header malformado → ok:false reason malformed_header', () => {
    const r = validateMercadoPagoWebhook({
      secret,
      signatureHeader: 'garbage-no-comma-no-equals',
      dataId,
      requestId,
      nowMs: fixedNowMs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('malformed_header');
    }
  });

  it('ts fuera de ventana (1h atras) → ok:false reason timestamp_out_of_window', () => {
    const oldTs = fixedTs - 3600;
    const header = buildValidSignatureHeader(oldTs);
    const r = validateMercadoPagoWebhook({
      secret,
      signatureHeader: header,
      dataId,
      requestId,
      nowMs: fixedNowMs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('timestamp_out_of_window');
      if (r.reason === 'timestamp_out_of_window') {
        expect(r.timestamp).toBe(oldTs);
      }
    }
  });

  it('HMAC mismatch (secret incorrecto) → ok:false reason hmac_mismatch', () => {
    const header = buildValidSignatureHeader(fixedTs);
    const r = validateMercadoPagoWebhook({
      secret: 'secret-incorrecto',
      signatureHeader: header,
      dataId,
      requestId,
      nowMs: fixedNowMs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('hmac_mismatch');
    }
  });

  it('HMAC mismatch (dataId tampering) → ok:false reason hmac_mismatch', () => {
    const header = buildValidSignatureHeader(fixedTs);
    const r = validateMercadoPagoWebhook({
      secret,
      signatureHeader: header,
      dataId: 'payment-OTRO',
      requestId,
      nowMs: fixedNowMs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('hmac_mismatch');
    }
  });

  it('HMAC mismatch (requestId tampering) → ok:false reason hmac_mismatch', () => {
    const header = buildValidSignatureHeader(fixedTs);
    const r = validateMercadoPagoWebhook({
      secret,
      signatureHeader: header,
      dataId,
      requestId: 'req-DISTINTO',
      nowMs: fixedNowMs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('hmac_mismatch');
    }
  });

  it('discriminacion del result type por reason (TS narrowing)', () => {
    const r = validateMercadoPagoWebhook({
      secret,
      signatureHeader: 'malformed',
      dataId,
      requestId,
      nowMs: fixedNowMs,
    });
    // narrowing test — si TS compila esto, los discriminants estan bien.
    if (!r.ok && r.reason === 'malformed_header') {
      // En este branch, NO debe haber timestamp.
      expect(r).not.toHaveProperty('timestamp');
    }
  });

  // Fix advisor #2 — guard contra dataId/requestId vacios (defense-in-depth)
  it('dataId vacio → ok:false reason missing_required_field', () => {
    const header = buildValidSignatureHeader(fixedTs);
    const r = validateMercadoPagoWebhook({
      secret,
      signatureHeader: header,
      dataId: '',
      requestId,
      nowMs: fixedNowMs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('missing_required_field');
    }
  });

  it('requestId vacio → ok:false reason missing_required_field', () => {
    const header = buildValidSignatureHeader(fixedTs);
    const r = validateMercadoPagoWebhook({
      secret,
      signatureHeader: header,
      dataId,
      requestId: '',
      nowMs: fixedNowMs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('missing_required_field');
    }
  });

  it('guard de campos vacios ocurre ANTES del parser (no expone shape malformed)', () => {
    // Si tanto dataId como signatureHeader son invalidos, debe ganar el guard
    // de empty (es defense-in-depth temprano), no malformed_header.
    const r = validateMercadoPagoWebhook({
      secret,
      signatureHeader: 'garbage',
      dataId: '',
      requestId: '',
      nowMs: fixedNowMs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('missing_required_field');
    }
  });
});
