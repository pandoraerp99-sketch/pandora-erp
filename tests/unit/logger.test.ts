/**
 * Tests unitarios logger — auto-inject + redact + integration con tracing context.
 *
 * Cubre:
 * - SECRET_PATHS catalogo canonico CLAUDE.md §10.5 + §11.8
 * - enrichWithContext: sin context / con context / tenant null
 * - Redact end-to-end con Pino destination stream custom (valida que
 *   SECRET_PATHS efectivamente censura los campos en el output JSON)
 * - Integration: logger.info dentro de withTracingContext → auto-inyecta
 *   correlation_id + request_id + tenant_id + actor en cada line
 * - child logger preserva el wrap (bindings se mantienen + auto-inject sigue)
 *
 * Cierra T-OBS-03 (logger auto-inject desde AsyncLocalStorage) +
 * T-SEC-07 (secret no logueado lista canonica) del COVERAGE-MATRIX.md.
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import {
  SECRET_PATHS,
  enrichWithContext,
  logger,
  wrapPino,
} from '@/lib/observability/logger';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';

// Helper: capture stream que parsea cada line como JSON
function makeCaptureStream(): { stream: Writable; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, cb): void {
      const text = chunk.toString();
      // Pino emite una line por log (newline-delimited JSON)
      for (const part of text.split('\n').filter(Boolean)) {
        try {
          lines.push(JSON.parse(part));
        } catch {
          // Pino-pretty u otros transports pueden emitir non-JSON; tests
          // configuran base pino para que esto no pase
        }
      }
      cb();
    },
  });
  return { stream, lines };
}

// Helper: pino instance con MISMOS redact paths que el productivo, con
// destination en memoria para verificar redact end-to-end.
function makeTestPino(stream: Writable): pino.Logger {
  return pino(
    {
      level: 'trace',
      redact: {
        paths: SECRET_PATHS,
        censor: '[REDACTED]',
      },
    },
    stream
  );
}

describe('SECRET_PATHS — catalogo canonico', () => {
  it('contiene password + variants', () => {
    expect(SECRET_PATHS).toContain('password');
    expect(SECRET_PATHS).toContain('*.password');
  });

  it('contiene token + variants para auth bearer / WSAA', () => {
    expect(SECRET_PATHS).toContain('token');
    expect(SECRET_PATHS).toContain('*.token');
    expect(SECRET_PATHS).toContain('access_token');
    expect(SECRET_PATHS).toContain('refresh_token');
    expect(SECRET_PATHS).toContain('wsaa_token');
  });

  it('contiene api_key + variants para webhook signing secrets', () => {
    expect(SECRET_PATHS).toContain('api_key');
    expect(SECRET_PATHS).toContain('*.api_key');
    expect(SECRET_PATHS).toContain('secret');
    expect(SECRET_PATHS).toContain('*.secret');
  });

  it('contiene cert + cert_password para AFIP X.509 Sprint 6', () => {
    expect(SECRET_PATHS).toContain('cert');
    expect(SECRET_PATHS).toContain('cert_password');
  });

  it('contiene encryption_key para SECRETS_ENCRYPTION_KEY_V1 (vault Sprint 1)', () => {
    expect(SECRET_PATHS).toContain('encryption_key');
    expect(SECRET_PATHS).toContain('*.encryption_key');
  });

  it('contiene authorization + cookies + session', () => {
    expect(SECRET_PATHS).toContain('authorization');
    expect(SECRET_PATHS).toContain('cookie');
    expect(SECRET_PATHS).toContain('set-cookie');
    expect(SECRET_PATHS).toContain('session');
  });

  it('cada entry tiene tanto root como nested wildcard (defense layered)', () => {
    // Patron: si X esta listado, *.X tambien deberia (cubre nested objects)
    const rootEntries = SECRET_PATHS.filter(p => !p.includes('*'));
    for (const root of rootEntries) {
      expect(SECRET_PATHS).toContain(`*.${root}`);
    }
  });

  // Fix advisor 2026-06-02: camelCase + env-var root keys gaps cerrados
  // antes de Sprint 5-6 (Supabase auth + MercadoPago SDK + AFIP devuelven
  // estos shapes; Pino redact es case-sensitive).

  it('contiene camelCase variants (Supabase/MP/jose libs)', () => {
    expect(SECRET_PATHS).toContain('accessToken');
    expect(SECRET_PATHS).toContain('refreshToken');
    expect(SECRET_PATHS).toContain('apiKey');
    expect(SECRET_PATHS).toContain('apiSecret');
    expect(SECRET_PATHS).toContain('jwtSecret');
    expect(SECRET_PATHS).toContain('encryptionKey');
    expect(SECRET_PATHS).toContain('wsaaToken');
    expect(SECRET_PATHS).toContain('certPassword');
    expect(SECRET_PATHS).toContain('setCookie');
  });

  it('contiene SECRETS_ENCRYPTION_KEY_V* env vars como root keys', () => {
    // Pattern `encryption_key` solo matchea key llamada exactamente asi —
    // NO matchea `SECRETS_ENCRYPTION_KEY_V1`. Sin esto, logueo accidental
    // de process.env en boot debug = leak.
    expect(SECRET_PATHS).toContain('SECRETS_ENCRYPTION_KEY_V1');
    expect(SECRET_PATHS).toContain('SECRETS_ENCRYPTION_KEY_V2');
    expect(SECRET_PATHS).toContain('SECRETS_ENCRYPTION_KEY_ACTIVE_VERSION');
  });

  it('contiene api_secret + variantes (no estaba en V1)', () => {
    expect(SECRET_PATHS).toContain('api_secret');
    expect(SECRET_PATHS).toContain('*.api_secret');
  });
});

describe('enrichWithContext — pure helper', () => {
  it('sin tracing context activo → devuelve {}', () => {
    // Fuera de withTracingContext
    expect(enrichWithContext()).toEqual({});
  });

  it('con context completo → devuelve todos los campos', () => {
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-abc',
      actor_user_id: 'user-123',
      actor_type: 'user' as const,
    };
    const result = withTracingContext(ctx, () => enrichWithContext()) as Record<
      string,
      unknown
    >;
    expect(result.correlation_id).toBe(ctx.correlation_id);
    expect(result.request_id).toBe(ctx.request_id);
    expect(result.tenant_id).toBe('tenant-abc');
    expect(result.actor_user_id).toBe('user-123');
    expect(result.actor_type).toBe('user');
  });

  it('tenant_id null → undefined (Pino skipea key, no loguea "tenant_id": null)', () => {
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: null,
      actor_user_id: null,
      actor_type: 'cron' as const,
    };
    const result = withTracingContext(ctx, () => enrichWithContext()) as Record<
      string,
      unknown
    >;
    expect(result.tenant_id).toBeUndefined();
    expect(result.actor_user_id).toBeUndefined();
    expect(result.correlation_id).toBe(ctx.correlation_id);
    expect(result.actor_type).toBe('cron');
  });
});

describe('Redact end-to-end — Pino con SECRET_PATHS censura output', () => {
  it('password en root → [REDACTED]', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    p.info({ password: 'super-secret-leak-attempt' }, 'msg');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.password).toBe('[REDACTED]');
    expect(JSON.stringify(lines[0])).not.toContain('super-secret-leak-attempt');
  });

  it('password nested → [REDACTED]', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    p.info({ user: { password: 'leak-nested' } }, 'msg');
    const user = lines[0]!.user as Record<string, unknown>;
    expect(user.password).toBe('[REDACTED]');
    expect(JSON.stringify(lines[0])).not.toContain('leak-nested');
  });

  it('wsaa_token en root → [REDACTED]', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    p.info(
      { wsaa_token: 'PD94bWwgdmVyc2lvbj0iMS4wIj8+leak-afip-token' },
      'afip refresh'
    );
    expect(lines[0]!.wsaa_token).toBe('[REDACTED]');
  });

  it('cert_password (AFIP X.509) → [REDACTED]', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    p.info({ tenant_id: 't1', cert_password: 'leak-cert-pass' }, 'cert load');
    expect(lines[0]!.cert_password).toBe('[REDACTED]');
    expect(lines[0]!.tenant_id).toBe('t1');
  });

  it('encryption_key nested → [REDACTED]', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    p.info(
      { vault: { encryption_key: '64charHexLeakAttempt00000000000000000000000000000000000000000000' } },
      'msg'
    );
    const vault = lines[0]!.vault as Record<string, unknown>;
    expect(vault.encryption_key).toBe('[REDACTED]');
  });

  it('authorization header → [REDACTED]', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    p.info({ authorization: 'Bearer leak-jwt' }, 'inbound req');
    expect(lines[0]!.authorization).toBe('[REDACTED]');
  });

  it('set-cookie nested → [REDACTED]', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    p.info({ headers: { 'set-cookie': 'sb-access=leak; HttpOnly' } }, 'resp');
    const h = lines[0]!.headers as Record<string, unknown>;
    expect(h['set-cookie']).toBe('[REDACTED]');
  });

  it('campo NO sensible queda visible (sanity)', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    p.info({ tenant_id: 'tenant-xyz', amount: 12345 }, 'venta cobrada');
    expect(lines[0]!.tenant_id).toBe('tenant-xyz');
    expect(lines[0]!.amount).toBe(12345);
    expect(lines[0]!.msg).toBe('venta cobrada');
  });

  it('camelCase accessToken (Supabase auth) → [REDACTED]', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    p.info(
      { session: { user_id: 'u1' }, accessToken: 'eyJhbGc.leak-sb-jwt' },
      'auth'
    );
    expect(lines[0]!.accessToken).toBe('[REDACTED]');
  });

  it('camelCase apiKey nested (MercadoPago config) → [REDACTED]', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    p.info({ mp: { apiKey: 'APP_USR-leak-mp-key' } }, 'mp config');
    const mp = lines[0]!.mp as Record<string, unknown>;
    expect(mp.apiKey).toBe('[REDACTED]');
  });

  it('SECRETS_ENCRYPTION_KEY_V1 root (env dump) → [REDACTED]', () => {
    const { stream, lines } = makeCaptureStream();
    const p = makeTestPino(stream);
    // Simula logueo accidental de process.env en boot debug
    p.info(
      {
        NODE_ENV: 'production',
        SECRETS_ENCRYPTION_KEY_V1: 'aaaa'.repeat(16),
      },
      'boot env dump (debug)'
    );
    expect(lines[0]!.SECRETS_ENCRYPTION_KEY_V1).toBe('[REDACTED]');
    expect(lines[0]!.NODE_ENV).toBe('production');
  });
});

describe('wrapPino + tracing context — T-OBS-03 closure end-to-end', () => {
  // Estos tests validan la composicion REAL (wrap + tracing + Pino destination)
  // que el smoke test del singleton NO podia probar. Cierran T-OBS-03 del
  // COVERAGE-MATRIX.md honestamente.

  it('logger.info dentro de withTracingContext → correlation_id en output JSON', () => {
    const { stream, lines } = makeCaptureStream();
    const testLogger = wrapPino(makeTestPino(stream));
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-trace',
      actor_user_id: 'user-1',
      actor_type: 'user' as const,
    };

    withTracingContext(ctx, () => testLogger.info({ event: 'sale.created' }, 'venta'));

    expect(lines).toHaveLength(1);
    expect(lines[0]!.correlation_id).toBe(ctx.correlation_id);
    expect(lines[0]!.request_id).toBe(ctx.request_id);
    expect(lines[0]!.tenant_id).toBe('tenant-trace');
    expect(lines[0]!.actor_user_id).toBe('user-1');
    expect(lines[0]!.actor_type).toBe('user');
    expect(lines[0]!.event).toBe('sale.created');
    expect(lines[0]!.msg).toBe('venta');
  });

  it('logger.info FUERA de context → NO correlation_id (boot logs validos)', () => {
    const { stream, lines } = makeCaptureStream();
    const testLogger = wrapPino(makeTestPino(stream));
    testLogger.info({ event: 'boot' }, 'starting up');
    expect(lines[0]!.correlation_id).toBeUndefined();
    expect(lines[0]!.event).toBe('boot');
  });

  it('SPREAD ORDER INVARIANTE: context GANA sobre payload (fix advisor)', () => {
    // Sin este test, alguien podria reintroducir el bug spread order
    // {...ctx, ...payload} → payload override context. El test verifica
    // que un payload con tenant_id="FALSO" NO override el ctx real.
    const { stream, lines } = makeCaptureStream();
    const testLogger = wrapPino(makeTestPino(stream));
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-REAL',
      actor_user_id: 'user-real',
      actor_type: 'user' as const,
    };

    withTracingContext(ctx, () =>
      testLogger.info(
        {
          // Payload con campos que COINCIDEN con context — context debe ganar
          tenant_id: 'tenant-FALSO-override',
          correlation_id: 'correlation-FALSO-override',
          actor_user_id: 'user-FALSO-override',
          event: 'tampering.attempt',
        },
        'msg'
      )
    );

    expect(lines[0]!.tenant_id).toBe('tenant-REAL');
    expect(lines[0]!.correlation_id).toBe(ctx.correlation_id);
    expect(lines[0]!.actor_user_id).toBe('user-real');
    // Pero campos NO-context del payload siguen apareciendo
    expect(lines[0]!.event).toBe('tampering.attempt');
  });

  it('child logger hereda wrap + sigue auto-inyectando context', () => {
    const { stream, lines } = makeCaptureStream();
    const testLogger = wrapPino(makeTestPino(stream));
    const child = testLogger.child({ subsystem: 'fiscal' });
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-child',
      actor_user_id: null,
      actor_type: 'worker' as const,
    };

    withTracingContext(ctx, () => child.info({ event: 'cae.requested' }, 'WSFEv1'));

    expect(lines[0]!.subsystem).toBe('fiscal');
    expect(lines[0]!.correlation_id).toBe(ctx.correlation_id);
    expect(lines[0]!.tenant_id).toBe('tenant-child');
    expect(lines[0]!.actor_type).toBe('worker');
  });

  it('multiple log levels (info + warn + error) cada uno con context', () => {
    const { stream, lines } = makeCaptureStream();
    const testLogger = wrapPino(makeTestPino(stream));
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-levels',
      actor_user_id: null,
      actor_type: 'system' as const,
    };

    withTracingContext(ctx, () => {
      testLogger.info('info msg');
      testLogger.warn({ code: 'CAE_TIMEOUT' }, 'warn msg');
      testLogger.error({ err: 'fatal-not-quite' }, 'error msg');
    });

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.correlation_id).toBe(ctx.correlation_id);
      expect(line.tenant_id).toBe('tenant-levels');
    }
    expect(lines[1]!.code).toBe('CAE_TIMEOUT');
    expect(lines[2]!.err).toBe('fatal-not-quite');
  });

  it('tenant_id null en context → key NO aparece en output (no "tenant_id": null)', () => {
    const { stream, lines } = makeCaptureStream();
    const testLogger = wrapPino(makeTestPino(stream));
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: null, // cron sin tenant
      actor_user_id: null,
      actor_type: 'cron' as const,
    };

    withTracingContext(ctx, () => testLogger.info('cron tick'));

    expect(lines[0]!.actor_type).toBe('cron');
    expect(lines[0]!.tenant_id).toBeUndefined();
    expect(lines[0]!.actor_user_id).toBeUndefined();
    // Verificar que ni siquiera la KEY aparece en el JSON serializado
    expect(Object.keys(lines[0]!)).not.toContain('tenant_id');
  });
});

describe('logger singleton — integracion con tracing context', () => {
  it('logger esta definido + tiene todos los levels', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('logger.child devuelve AppLogger con bindings + levels', () => {
    const child = logger.child({ subsystem: 'fiscal' });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
    expect(typeof child.child).toBe('function');
  });

  // T-OBS-03 closure REAL via wrapPino + destination stream esta en el
  // describe('wrapPino + tracing context') abajo. El smoke test "no throwa"
  // se quito porque NO probaba el invariante de T-OBS-03 (advisor fix).

  it('logger.info fuera de tracing context NO throwa (boot logs)', () => {
    expect(() => logger.info('boot log sin context')).not.toThrow();
    expect(() => logger.info({ event: 'boot' }, 'with payload')).not.toThrow();
  });
});
