/**
 * Pino structured logger con auto-inject de tracing context.
 * CLAUDE.md §10.5 — Pino con AsyncLocalStorage Proxy.
 *
 * Toda llamada a logger.{info,warn,error,...} auto-incluye correlation_id,
 * request_id, tenant_id, actor_user_id desde el tracing context.
 *
 * SECRET LIST: los campos en SECRET_PATHS NUNCA se loguean
 * (CLAUDE.md §10.5).
 */
import pino, { type Logger as PinoLogger } from 'pino';
import { env, isDevelopment, isProduction } from '../env.js';
import { getTracingContext } from '../tracing/context.js';

// CLAUDE.md §10.5 SECRET LIST — campos que NUNCA se loguean.
// Tipo string[] mutable (no `as const`) porque Pino redactOptions.paths
// pide string[] mutable, no readonly.
// Exportado para que tests verifiquen lista canonica + para extender con
// secrets domain-specific en F1+ (ej: AFIP cert paths Sprint 6).
export const SECRET_PATHS: string[] = [
  // snake_case (convencion interna Pandora)
  'password',
  '*.password',
  'jwt_secret',
  '*.jwt_secret',
  'token',
  '*.token',
  'wsaa_token',
  '*.wsaa_token',
  'access_token',
  '*.access_token',
  'refresh_token',
  '*.refresh_token',
  'api_key',
  '*.api_key',
  'api_secret',
  '*.api_secret',
  'secret',
  '*.secret',
  'cert',
  '*.cert',
  'cert_password',
  '*.cert_password',
  'encryption_key',
  '*.encryption_key',
  'authorization',
  '*.authorization',
  'set-cookie',
  '*.set-cookie',
  'cookie',
  '*.cookie',
  'session',
  '*.session',

  // camelCase (devuelto por Supabase auth, MercadoPago SDK, jose, etc.)
  // Pino redact es case-sensitive — un solo missing match = leak.
  // Fix advisor 2026-06-02 antes de Sprint 5-6 que va a integrar esas libs.
  'apiKey',
  '*.apiKey',
  'apiSecret',
  '*.apiSecret',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'jwtSecret',
  '*.jwtSecret',
  'encryptionKey',
  '*.encryptionKey',
  'wsaaToken',
  '*.wsaaToken',
  'certPassword',
  '*.certPassword',
  'setCookie',
  '*.setCookie',

  // PascalCase AFIP SOAP — `Token` y `Sign` aparecen en <Auth> de WSFEv1
  // requests (XML SOAP standard). Sin esto, audit de error WSFEv1
  // con request crudo persiste cleartext en jsonb (10 anios inmutable).
  // Fix advisor 2026-06-02.
  'Token',
  '*.Token',
  'Sign',
  '*.Sign',

  // Env vars de boot — root keys explicitos (pattern `encryption_key`
  // solo matchea key llamada exactamente `encryption_key`, NO
  // `SECRETS_ENCRYPTION_KEY_V1`). Si alguien loguea process.env crudo
  // en debug de boot, sin estas entries hay leak.
  'SECRETS_ENCRYPTION_KEY_V1',
  'SECRETS_ENCRYPTION_KEY_V2',
  'SECRETS_ENCRYPTION_KEY_V3',
  'SECRETS_ENCRYPTION_KEY_ACTIVE_VERSION',
  '*.SECRETS_ENCRYPTION_KEY_V1',
  '*.SECRETS_ENCRYPTION_KEY_V2',
  '*.SECRETS_ENCRYPTION_KEY_V3',
  '*.SECRETS_ENCRYPTION_KEY_ACTIVE_VERSION',
];

const basePinoConfig = {
  level: env.LOG_LEVEL,
  base: {
    service: 'pandora-erp',
    env: env.NODE_ENV,
    afip_env: env.AFIP_ENVIRONMENT,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: SECRET_PATHS,
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label: string): { level: string } => ({ level: label }),
  },
};

const baseLogger: PinoLogger = isProduction()
  ? pino(basePinoConfig)
  : pino({
      ...basePinoConfig,
      transport: isDevelopment()
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname,service,env,afip_env',
              singleLine: false,
            },
          }
        : undefined,
    });

/**
 * Lee el tracing context (AsyncLocalStorage) y devuelve los campos que
 * deben auto-inyectarse en cada log line.
 *
 * Exportado para test directo del auto-inject sin atravesar Pino.
 *
 * - Sin context activo (boot, top-level): devuelve `{}` — log sale sin
 *   correlation_id/request_id, valido pre-tracing.
 * - Con context: devuelve campos completos. `tenant_id` y `actor_user_id`
 *   se mapean a `undefined` cuando son null para que Pino los OMITA de la
 *   linea (Pino skipea undefined). Importante: NO loguear `"tenant_id": null`
 *   porque ensucia el output con keys vacias.
 */
export function enrichWithContext(): Record<string, unknown> {
  const ctx = getTracingContext();
  if (!ctx) return {};

  return {
    correlation_id: ctx.correlation_id,
    request_id: ctx.request_id,
    tenant_id: ctx.tenant_id ?? undefined,
    actor_user_id: ctx.actor_user_id ?? undefined,
    actor_type: ctx.actor_type,
  };
}

type LogMethod = (objOrMsg: object | string, msg?: string) => void;

interface AppLogger {
  trace: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
  child(bindings: Record<string, unknown>): AppLogger;
}

/**
 * Wrap un Pino instance para auto-inject del tracing context en cada log.
 *
 * Exportado para tests que validan T-OBS-03 (auto-inject end-to-end) sin
 * tener que mockear el destination del singleton productivo.
 *
 * **Invariante critica de spread order:** el tracing context SIEMPRE gana
 * sobre el payload del caller. Sin esto, `logger.info({tenant_id: 'X'}, ...)`
 * (deliberado o accidental — campo "tenant_id" en error de cliente, row de
 * DB spreado, etc.) override-aria el context auto-inyectado y manchar-ia
 * audit_log/Pino con tenants falsos. Fix advisor 2026-06-02.
 */
export function wrapPino(p: PinoLogger): AppLogger {
  const call =
    (level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'): LogMethod =>
    (objOrMsg, msg) => {
      const ctx = enrichWithContext();
      if (typeof objOrMsg === 'string') {
        p[level]({ ...ctx }, objOrMsg);
      } else {
        // Order critico: payload PRIMERO, ctx DESPUES → ctx wins.
        p[level]({ ...objOrMsg, ...ctx }, msg);
      }
    };

  return {
    trace: call('trace'),
    debug: call('debug'),
    info: call('info'),
    warn: call('warn'),
    error: call('error'),
    fatal: call('fatal'),
    child(bindings) {
      return wrapPino(p.child(bindings));
    },
  };
}

export const logger: AppLogger = wrapPino(baseLogger);

export type { AppLogger };
