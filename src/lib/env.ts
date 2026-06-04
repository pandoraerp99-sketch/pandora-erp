/**
 * Environment validation — fail-fast at boot.
 * ADR-0019 S9: zod validation de todas las env vars criticas.
 * Si falta una variable o tiene tipo invalido, la app NO arranca.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_ISSUER: z.string().default('pandora-erp'),
  JWT_AUDIENCE: z.string().default('pandora-erp-clients'),

  SECRETS_ENCRYPTION_KEY_V1: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'SECRETS_ENCRYPTION_KEY_V1 debe ser 64 hex chars (256 bits)'),
  SECRETS_ENCRYPTION_KEY_V2: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  SECRETS_ENCRYPTION_KEY_V3: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  SECRETS_ENCRYPTION_KEY_ACTIVE_VERSION: z.coerce.number().int().min(1).default(1),

  AFIP_ENVIRONMENT: z.enum(['homologacion', 'produccion']).default('homologacion'),

  MONEY_ROUNDING_MODE: z.enum(['HALF_EVEN']).default('HALF_EVEN'),
  MONEY_ROUNDING_STAGE: z.enum(['PER_LINE', 'PER_TAX_BRACKET']).default('PER_LINE'),
  MONEY_CURRENCY: z.enum(['ARS']).default('ARS'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SENTRY_DSN: z.string().url().optional(),

  DEMO_TRIAL_DAYS: z.coerce.number().int().positive().default(60),
  DEMO_READ_ONLY_DAYS: z.coerce.number().int().positive().default(22),
  DEMO_TOTAL_LIFECYCLE_DAYS: z.coerce.number().int().positive().default(82),

  SYSTEM_TENANT_ID: z.string().uuid().default('00000000-0000-0000-0000-000000000000'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    const message = `Environment validation failed:\n${errors}\n\nCopia .env.example a .env.local y completa los valores requeridos.`;

    if (typeof process !== 'undefined' && process.stderr) {
      process.stderr.write(`\n[env] ${message}\n\n`);
    }

    throw new Error(message);
  }

  if (
    parsed.data.AFIP_ENVIRONMENT === 'produccion' &&
    parsed.data.NODE_ENV !== 'production'
  ) {
    throw new Error(
      'AFIP_ENVIRONMENT=produccion solo permitido con NODE_ENV=production. ' +
        'ADR-0019 S13: hard isolation homologacion vs prod.'
    );
  }

  const activeVersion = parsed.data.SECRETS_ENCRYPTION_KEY_ACTIVE_VERSION;
  const activeKey = parsed.data[
    `SECRETS_ENCRYPTION_KEY_V${activeVersion}` as keyof Env
  ];
  if (!activeKey) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY_ACTIVE_VERSION=${activeVersion} pero SECRETS_ENCRYPTION_KEY_V${activeVersion} no esta definida.`
    );
  }

  return parsed.data;
}

export const env: Env = loadEnv();

export function isProduction(): boolean {
  return env.NODE_ENV === 'production';
}

export function isDevelopment(): boolean {
  return env.NODE_ENV === 'development';
}

export function isTest(): boolean {
  return env.NODE_ENV === 'test';
}

export function isAfipProduction(): boolean {
  return env.AFIP_ENVIRONMENT === 'produccion';
}
