/**
 * Tests unitarios CSP — helpers puros.
 *
 * Cubre:
 * - generateCspNonce (128 bits, base64, unico por llamada).
 * - isValidCspNonce.
 * - buildCspHeader (directives canonicas + nonce + reportUri + extraConnectSrc).
 * - buildSecurityHeaders (6 headers obligatorios).
 * - Catalogos DEFAULT_CONNECT_SRC + DEFAULT_IMG_SRC.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONNECT_SRC,
  DEFAULT_IMG_SRC,
  buildCspHeader,
  buildSecurityHeaders,
  generateCspNonce,
  isValidCspNonce,
} from '@/lib/security/csp';

describe('generateCspNonce', () => {
  it('genera nonce de 24 chars (base64 de 16 bytes con padding)', () => {
    const n = generateCspNonce();
    expect(n).toHaveLength(24);
  });

  it('nonce es base64 valido', () => {
    const n = generateCspNonce();
    expect(n).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('cada llamada genera nonce distinto (sanidad — entropia W3C >= 128 bits)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      set.add(generateCspNonce());
    }
    expect(set.size).toBe(100);
  });

  it('isValidCspNonce acepta nonces generados', () => {
    for (let i = 0; i < 10; i++) {
      expect(isValidCspNonce(generateCspNonce())).toBe(true);
    }
  });
});

describe('isValidCspNonce', () => {
  it('rechaza vacio', () => {
    expect(isValidCspNonce('')).toBe(false);
  });

  it('rechaza longitud incorrecta', () => {
    expect(isValidCspNonce('abc')).toBe(false);
    expect(isValidCspNonce('A'.repeat(25))).toBe(false);
    expect(isValidCspNonce('A'.repeat(23))).toBe(false);
  });

  it('rechaza chars fuera del alfabeto base64', () => {
    expect(isValidCspNonce('!!!!!!!!!!!!!!!!!!!!!!!!')).toBe(false);
    expect(isValidCspNonce('A'.repeat(20) + '<>?@')).toBe(false);
  });

  it('acepta base64 con padding', () => {
    expect(isValidCspNonce('A'.repeat(22) + '==')).toBe(true);
  });
});

describe('buildCspHeader directives', () => {
  const nonce = generateCspNonce();
  const header = buildCspHeader(nonce);

  it('contiene default-src self', () => {
    expect(header).toContain("default-src 'self'");
  });

  it('script-src tiene self + nonce (sin strict-dynamic — rompe Next F0)', () => {
    expect(header).toContain(`'nonce-${nonce}'`);
    expect(header).toMatch(/script-src 'self'/);
  });

  it('script-src NO tiene strict-dynamic F0 (defer F0.5/F1+ con nonce wiring app/layout.tsx)', () => {
    const scriptDirective = header.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptDirective).not.toContain("'strict-dynamic'");
  });

  it('script-src NO tiene unsafe-inline (XSS defense)', () => {
    expect(header).not.toContain("script-src 'unsafe-inline'");
    // mas paranoid: no contiene unsafe-inline en CUALQUIER directive script-src
    const scriptDirective = header.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptDirective).toBeDefined();
    expect(scriptDirective).not.toContain("'unsafe-inline'");
  });

  it('style-src tiene unsafe-inline (deuda intencional ADR-0019)', () => {
    const styleDirective = header.split(';').find((d) => d.trim().startsWith('style-src'));
    expect(styleDirective).toContain("'unsafe-inline'");
  });

  it('frame-ancestors none (anti-clickjacking)', () => {
    expect(header).toContain("frame-ancestors 'none'");
  });

  it('frame-src none (no iframes externos)', () => {
    expect(header).toContain("frame-src 'none'");
  });

  it('object-src none (no Flash/plugins)', () => {
    expect(header).toContain("object-src 'none'");
  });

  it('base-uri self (anti-base-tag-injection)', () => {
    expect(header).toContain("base-uri 'self'");
  });

  it('form-action self (anti-form-hijack)', () => {
    expect(header).toContain("form-action 'self'");
  });

  it('upgrade-insecure-requests presente', () => {
    expect(header).toContain('upgrade-insecure-requests');
  });

  it('NO incluye block-all-mixed-content (deprecated W3C, MDN obsoleto)', () => {
    expect(header).not.toContain('block-all-mixed-content');
  });

  it('connect-src incluye Supabase + MercadoPago + AFIP', () => {
    expect(header).toContain('https://*.supabase.co');
    expect(header).toContain('https://api.mercadopago.com');
    expect(header).toContain('https://wsaa.afip.gov.ar');
    expect(header).toContain('https://wsaahomo.afip.gov.ar');
  });

  it('img-src permite data: + https: + self', () => {
    const imgDirective = header.split(';').find((d) => d.trim().startsWith('img-src'));
    expect(imgDirective).toContain("'self'");
    expect(imgDirective).toContain('data:');
    expect(imgDirective).toContain('https:');
  });
});

describe('buildCspHeader options', () => {
  const nonce = generateCspNonce();

  it('extraConnectSrc agrega origenes adicionales', () => {
    const header = buildCspHeader(nonce, {
      extraConnectSrc: ['https://experimental.feature.com'],
    });
    expect(header).toContain('https://experimental.feature.com');
    // Preserva los defaults
    expect(header).toContain('https://*.supabase.co');
  });

  it('reportUri agrega directive report-uri', () => {
    const header = buildCspHeader(nonce, {
      reportUri: '/api/security/csp-report',
    });
    expect(header).toContain('report-uri /api/security/csp-report');
  });

  it('sin reportUri no incluye report-uri', () => {
    const header = buildCspHeader(nonce);
    expect(header).not.toContain('report-uri');
  });

  it('nonce vacio lanza error (defensa contra bug de programacion)', () => {
    expect(() => buildCspHeader('')).toThrow(/nonce vacio/);
  });
});

describe('buildSecurityHeaders', () => {
  const nonce = generateCspNonce();
  const headers = buildSecurityHeaders(nonce);

  it('incluye los 6 headers F0', () => {
    expect(headers).toHaveProperty('Content-Security-Policy');
    expect(headers).toHaveProperty('Strict-Transport-Security');
    expect(headers).toHaveProperty('X-Content-Type-Options');
    expect(headers).toHaveProperty('X-Frame-Options');
    expect(headers).toHaveProperty('Referrer-Policy');
    expect(headers).toHaveProperty('Permissions-Policy');
  });

  it('HSTS 1 ano + subdomains + preload', () => {
    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains; preload'
    );
  });

  it('X-Content-Type-Options nosniff', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('X-Frame-Options DENY (anti-clickjacking defensa secundaria)', () => {
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('Referrer-Policy strict-origin-when-cross-origin', () => {
    expect(headers['Referrer-Policy']).toBe(
      'strict-origin-when-cross-origin'
    );
  });

  it('Permissions-Policy bloquea camera/microphone/geolocation/payment', () => {
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Permissions-Policy']).toContain('microphone=()');
    expect(headers['Permissions-Policy']).toContain('geolocation=()');
    expect(headers['Permissions-Policy']).toContain('payment=()');
  });

  it('CSP header contiene el nonce especifico', () => {
    expect(headers['Content-Security-Policy']).toContain(`'nonce-${nonce}'`);
  });
});

describe('Catalogos DEFAULT_*', () => {
  it('DEFAULT_CONNECT_SRC incluye AFIP homo + prod', () => {
    expect(DEFAULT_CONNECT_SRC).toContain('https://wsaahomo.afip.gov.ar');
    expect(DEFAULT_CONNECT_SRC).toContain('https://wsaa.afip.gov.ar');
  });

  it('DEFAULT_CONNECT_SRC incluye Supabase ws + https', () => {
    expect(DEFAULT_CONNECT_SRC).toContain('https://*.supabase.co');
    expect(DEFAULT_CONNECT_SRC).toContain('wss://*.supabase.co');
  });

  it('DEFAULT_IMG_SRC permite data + https + self', () => {
    expect(DEFAULT_IMG_SRC).toEqual(["'self'", 'data:', 'https:']);
  });
});
