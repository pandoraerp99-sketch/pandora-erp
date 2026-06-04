/**
 * Tests unitarios scrub — recursive secret scrubbing para audit_log payloads.
 *
 * Cubre:
 * - Root level password/token/secret → [REDACTED]
 * - Nested cualquier depth (login.user.password) → [REDACTED]
 * - SECRETS_ENCRYPTION_KEY_V1 root → [REDACTED]
 * - PII (DNI, email, direccion) queda INTACTA (no es secret, es PII legal)
 * - Arrays con secrets nested
 * - Input no se muta (immutability)
 * - scrubbedPaths report exacto de paths reemplazados
 * - MAX_DEPTH limit (8)
 * - Custom paths list (caller puede override)
 */
import { describe, expect, it } from 'vitest';
import { scrubSecretsFromPayload } from '@/lib/observability/scrub';

describe('scrubSecretsFromPayload — root level secrets', () => {
  it('password root → [REDACTED]', () => {
    const input = { password: 'leak-123', user_id: 'u1' };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    expect(scrubbed.password).toBe('[REDACTED]');
    expect(scrubbed.user_id).toBe('u1');
    expect(scrubbedPaths).toEqual(['password']);
  });

  it('SECRETS_ENCRYPTION_KEY_V1 root → [REDACTED]', () => {
    const input = {
      NODE_ENV: 'production',
      SECRETS_ENCRYPTION_KEY_V1: 'aaaa'.repeat(16),
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    expect(scrubbed.SECRETS_ENCRYPTION_KEY_V1).toBe('[REDACTED]');
    expect(scrubbed.NODE_ENV).toBe('production');
    expect(scrubbedPaths).toEqual(['SECRETS_ENCRYPTION_KEY_V1']);
  });

  it('multiples secrets root → todos scrubeados', () => {
    const input = {
      password: 'X',
      token: 'Y',
      api_key: 'Z',
      tenant_id: 'tenant-A',
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    expect(scrubbed.password).toBe('[REDACTED]');
    expect(scrubbed.token).toBe('[REDACTED]');
    expect(scrubbed.api_key).toBe('[REDACTED]');
    expect(scrubbed.tenant_id).toBe('tenant-A');
    expect(scrubbedPaths.sort()).toEqual(['api_key', 'password', 'token']);
  });
});

describe('scrubSecretsFromPayload — nested secrets', () => {
  it('password nested 1 nivel → [REDACTED] con path correcto', () => {
    const input = {
      user: { id: 'u1', password: 'leak-nested' },
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    const user = scrubbed.user as Record<string, unknown>;
    expect(user.password).toBe('[REDACTED]');
    expect(user.id).toBe('u1');
    expect(scrubbedPaths).toEqual(['user.password']);
  });

  it('password nested 3 niveles → [REDACTED]', () => {
    const input = {
      request: {
        headers: {
          auth: { password: 'deep-leak' },
        },
      },
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    const auth = (
      (scrubbed.request as Record<string, unknown>).headers as Record<
        string,
        unknown
      >
    ).auth as Record<string, unknown>;
    expect(auth.password).toBe('[REDACTED]');
    expect(scrubbedPaths).toEqual(['request.headers.auth.password']);
  });

  it('camelCase apiKey nested (Supabase/MP) → [REDACTED]', () => {
    const input = { mp: { config: { apiKey: 'APP_USR-leak' } } };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    const config = (scrubbed.mp as Record<string, unknown>).config as Record<
      string,
      unknown
    >;
    expect(config.apiKey).toBe('[REDACTED]');
    expect(scrubbedPaths).toEqual(['mp.config.apiKey']);
  });

  it('accessToken nested (Supabase auth response) → [REDACTED]', () => {
    // Wrapper key NO es secret (auth_response). Si fuera `session`, TODO el
    // subtree quedaria scrubeado porque `session` es root secret en SECRET_PATHS
    // (cookies de sesion son secrets por contrato CLAUDE.md §10.5).
    const input = {
      auth_response: { user_id: 'u1', accessToken: 'eyJ.leak.jwt' },
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    const auth = scrubbed.auth_response as Record<string, unknown>;
    expect(auth.accessToken).toBe('[REDACTED]');
    expect(auth.user_id).toBe('u1');
    expect(scrubbedPaths).toEqual(['auth_response.accessToken']);
  });

  it('AFIP Token + Sign nested PascalCase (WSFEv1 SOAP) → [REDACTED]', () => {
    // PascalCase Token/Sign matchea por entries explicitas en SECRET_PATHS
    // (advisor fix 2026-06-02). AFIP SOAP devuelve estos campos en XML
    // PascalCase, sin esto NO matchearia `token` lowercase del SECRET_PATHS.
    const input = {
      request: {
        Auth: {
          Token: 'WSAA-leak-token',
          Sign: 'leak-signature',
          Cuit: 30712345678,
        },
      },
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    const auth = (scrubbed.request as Record<string, unknown>).Auth as Record<
      string,
      unknown
    >;
    expect(auth.Token).toBe('[REDACTED]');
    expect(auth.Sign).toBe('[REDACTED]');
    // Cuit NO es secret, es PII fiscal — queda intacto
    expect(auth.Cuit).toBe(30712345678);
    expect(scrubbedPaths.sort()).toEqual([
      'request.Auth.Sign',
      'request.Auth.Token',
    ]);
  });
});

describe('scrubSecretsFromPayload — PII queda intacta (scope legal)', () => {
  it('email + dni + direccion → NO scrubeados (PII no es secret)', () => {
    const input = {
      customer_email: 'maria@example.com',
      customer_dni: '20-12345678-9',
      customer_address: 'Calle Real 123, Rio Grande TDF',
      cuit: '30-71868423-0',
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    expect(scrubbed.customer_email).toBe('maria@example.com');
    expect(scrubbed.customer_dni).toBe('20-12345678-9');
    expect(scrubbed.customer_address).toBe('Calle Real 123, Rio Grande TDF');
    expect(scrubbed.cuit).toBe('30-71868423-0');
    expect(scrubbedPaths).toEqual([]);
  });

  it('sale_id + amount + correlation_id → NO scrubeados', () => {
    const input = {
      sale_id: 's-001',
      amount_cents: 12345,
      correlation_id: '550e8400-e29b-41d4-a716-446655440000',
      iva: 21,
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    expect(scrubbed).toEqual(input);
    expect(scrubbedPaths).toEqual([]);
  });
});

describe('scrubSecretsFromPayload — arrays', () => {
  it('array de objects con password nested → cada uno scrubeado', () => {
    const input = {
      attempts: [
        { ip: '1.1.1.1', password: 'leak1' },
        { ip: '2.2.2.2', password: 'leak2' },
      ],
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    const attempts = scrubbed.attempts as Record<string, unknown>[];
    expect(attempts[0]!.password).toBe('[REDACTED]');
    expect(attempts[0]!.ip).toBe('1.1.1.1');
    expect(attempts[1]!.password).toBe('[REDACTED]');
    expect(scrubbedPaths.sort()).toEqual([
      'attempts[0].password',
      'attempts[1].password',
    ]);
  });

  it('array de strings (no objects) → queda intacto', () => {
    const input = {
      tags: ['fiscal', 'pos', 'venta'],
      ips: ['1.1.1.1', '2.2.2.2'],
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input);
    expect(scrubbed).toEqual(input);
    expect(scrubbedPaths).toEqual([]);
  });
});

describe('scrubSecretsFromPayload — immutability', () => {
  it('NO muta el input', () => {
    const input = {
      password: 'original-leak',
      nested: { token: 'original-token' },
    };
    const inputBackup = JSON.parse(JSON.stringify(input));
    scrubSecretsFromPayload(input);
    expect(input).toEqual(inputBackup);
    expect(input.password).toBe('original-leak');
    expect((input.nested as Record<string, unknown>).token).toBe('original-token');
  });

  it('devuelve copia distinta (no === al input)', () => {
    const input = { password: 'X', nested: { foo: 'bar' } };
    const { scrubbed } = scrubSecretsFromPayload(input);
    expect(scrubbed).not.toBe(input);
    expect(scrubbed.nested).not.toBe(input.nested);
  });
});

describe('scrubSecretsFromPayload — edge cases', () => {
  it('payload vacio {} → scrubbed vacio, no paths', () => {
    const result = scrubSecretsFromPayload({});
    expect(result.scrubbed).toEqual({});
    expect(result.scrubbedPaths).toEqual([]);
  });

  it('values null/undefined → preservados (no se rompe el walk)', () => {
    const input = {
      sale_id: null,
      customer_id: undefined,
      password: 'leak',
    };
    const { scrubbed } = scrubSecretsFromPayload(input);
    expect(scrubbed.sale_id).toBeNull();
    expect(scrubbed.customer_id).toBeUndefined();
    expect(scrubbed.password).toBe('[REDACTED]');
  });

  it('numbers + booleans + Date no son scrubeados (no son objects)', () => {
    const date = new Date('2026-01-01');
    const input = {
      amount: 1500,
      is_active: true,
      created_at: date,
      password: 'leak',
    };
    const { scrubbed } = scrubSecretsFromPayload(input);
    expect(scrubbed.amount).toBe(1500);
    expect(scrubbed.is_active).toBe(true);
    expect(scrubbed.created_at).toBe(date);
    expect(scrubbed.password).toBe('[REDACTED]');
  });

  it('custom paths list override default', () => {
    const input = {
      password: 'no-deberia-scrubear-aca',
      custom_field: 'sin-default',
    };
    const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input, [
      'custom_field',
    ]);
    expect(scrubbed.password).toBe('no-deberia-scrubear-aca');
    expect(scrubbed.custom_field).toBe('[REDACTED]');
    expect(scrubbedPaths).toEqual(['custom_field']);
  });
});

describe('scrubSecretsFromPayload — MAX_DEPTH protection', () => {
  it('payload con > 8 niveles → trunca + reporta path', () => {
    // 10 niveles deep
    let payload: Record<string, unknown> = { password: 'deep-leak' };
    for (let i = 0; i < 10; i++) {
      payload = { nested: payload };
    }
    const { scrubbedPaths } = scrubSecretsFromPayload(payload);
    // Debe haber un path con `<truncated_at_depth_8>`
    const truncated = scrubbedPaths.some(p => p.includes('truncated_at_depth_8'));
    expect(truncated).toBe(true);
  });
});
