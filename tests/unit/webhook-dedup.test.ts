/**
 * Tests unitarios webhook-dedup — helpers puros (sin DB).
 *
 * Cubre:
 * - hashWebhookPayload (SHA-256 hex 64 chars).
 * - safeSignatureCompare (timing-safe + length mismatch).
 * - validateWebhookFreshness (±5min ventana).
 * - WEBHOOK_PROVIDERS catalogo cerrado.
 *
 * Tests con DB real (INSERT ON CONFLICT, UPDATE sale_id, cleanup,
 * concurrent dedup) van a tests/integration cuando exista Supabase
 * conectada.
 */
import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_PROVIDERS,
  type WebhookProvider,
} from '@/lib/db/schema/processed_webhook_events';
import {
  WEBHOOK_FRESHNESS_TOLERANCE_SECONDS,
  hashWebhookPayload,
  safeSignatureCompare,
  validateWebhookFreshness,
} from '@/lib/security/webhook-dedup';

describe('Catalogo WEBHOOK_PROVIDERS', () => {
  it('contiene mercadopago + afip F0', () => {
    expect(WEBHOOK_PROVIDERS).toEqual(['mercadopago', 'afip']);
  });

  it('hay exactamente 2 providers F0', () => {
    expect(WEBHOOK_PROVIDERS).toHaveLength(2);
  });

  it('typecheck WebhookProvider es union', () => {
    const a: WebhookProvider = 'mercadopago';
    const b: WebhookProvider = 'afip';
    expect([a, b]).toHaveLength(2);
  });

  it('todos lowercase + sin caracteres especiales', () => {
    for (const p of WEBHOOK_PROVIDERS) {
      expect(p).toMatch(/^[a-z]+$/);
    }
  });
});

describe('hashWebhookPayload', () => {
  it('SHA-256 hex es 64 chars', () => {
    const h = hashWebhookPayload('{"event":"payment.created","id":"abc"}');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mismo input → mismo hash (deterministico)', () => {
    const body = '{"foo":"bar"}';
    expect(hashWebhookPayload(body)).toBe(hashWebhookPayload(body));
  });

  it('input distinto → hash distinto', () => {
    expect(hashWebhookPayload('a')).not.toBe(hashWebhookPayload('b'));
  });

  it('hash conocido para empty string', () => {
    // SHA-256 of empty string is fixed.
    expect(hashWebhookPayload('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('soporta unicode UTF-8', () => {
    const h = hashWebhookPayload('María González — Ñuñoa $1.329.033');
    expect(h).toHaveLength(64);
  });
});

describe('safeSignatureCompare', () => {
  it('signatures identicas → true', () => {
    expect(safeSignatureCompare('abc123', 'abc123')).toBe(true);
  });

  it('signatures distintas misma longitud → false', () => {
    expect(safeSignatureCompare('abc123', 'xyz789')).toBe(false);
  });

  it('signatures distinta longitud → false', () => {
    expect(safeSignatureCompare('abc', 'abc1')).toBe(false);
  });

  it('ambas vacias → true (edge case)', () => {
    expect(safeSignatureCompare('', '')).toBe(true);
  });

  it('una vacia → false', () => {
    expect(safeSignatureCompare('', 'abc')).toBe(false);
    expect(safeSignatureCompare('abc', '')).toBe(false);
  });

  it('case-sensitive (HMAC hex es case-sensitive en convencion)', () => {
    expect(safeSignatureCompare('ABC', 'abc')).toBe(false);
  });
});

describe('validateWebhookFreshness', () => {
  const fixedNow = new Date('2026-06-01T12:00:00Z').getTime();

  it('timestamp ahora → true', () => {
    expect(validateWebhookFreshness(fixedNow / 1000, fixedNow)).toBe(true);
  });

  it('timestamp 4min ago → true (dentro de ventana 5min)', () => {
    const fourMinAgo = fixedNow / 1000 - 4 * 60;
    expect(validateWebhookFreshness(fourMinAgo, fixedNow)).toBe(true);
  });

  it('timestamp 4min future → true', () => {
    const fourMinFuture = fixedNow / 1000 + 4 * 60;
    expect(validateWebhookFreshness(fourMinFuture, fixedNow)).toBe(true);
  });

  it('timestamp 6min ago → false', () => {
    const sixMinAgo = fixedNow / 1000 - 6 * 60;
    expect(validateWebhookFreshness(sixMinAgo, fixedNow)).toBe(false);
  });

  it('timestamp 6min future → false', () => {
    const sixMinFuture = fixedNow / 1000 + 6 * 60;
    expect(validateWebhookFreshness(sixMinFuture, fixedNow)).toBe(false);
  });

  it('borderline exactamente 5min → true (limite inclusivo)', () => {
    const exactlyFiveMinAgo = fixedNow / 1000 - 5 * 60;
    expect(validateWebhookFreshness(exactlyFiveMinAgo, fixedNow)).toBe(true);
  });

  it('borderline 5min + 1s → false', () => {
    const justBeyond = fixedNow / 1000 - (5 * 60 + 1);
    expect(validateWebhookFreshness(justBeyond, fixedNow)).toBe(false);
  });

  it('ISO string timestamp soportado', () => {
    expect(
      validateWebhookFreshness('2026-06-01T12:00:00Z', fixedNow)
    ).toBe(true);
  });

  it('ISO string fuera de ventana → false', () => {
    expect(
      validateWebhookFreshness('2026-06-01T11:00:00Z', fixedNow)
    ).toBe(false);
  });

  it('string no parseable → false', () => {
    expect(validateWebhookFreshness('not-a-date', fixedNow)).toBe(false);
  });

  it('tolerance constant es 300s (5min)', () => {
    expect(WEBHOOK_FRESHNESS_TOLERANCE_SECONDS).toBe(300);
  });

  it('replay attack scenario: timestamp viejo de hace 1h → false', () => {
    const oneHourAgo = fixedNow / 1000 - 3600;
    expect(validateWebhookFreshness(oneHourAgo, fixedNow)).toBe(false);
  });
});
