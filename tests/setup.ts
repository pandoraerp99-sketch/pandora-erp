/**
 * Vitest setup global.
 * Inicializa env mockeada para que src/lib/env.ts no falle al cargar
 * (porque tiene fail-fast con .env real).
 *
 * Cast a Record porque @types/node 20+ tipa NODE_ENV como readonly y bloquea
 * la asignacion directa. process.env sigue siendo mutable en runtime —
 * solo el tipo es restrictivo.
 */
const env = process.env as Record<string, string | undefined>;

env['NODE_ENV'] = 'test';
env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://test.supabase.co';
env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'eyJtest_anon_key_minimo_20_chars';
env['SUPABASE_SERVICE_ROLE_KEY'] = 'eyJtest_service_role_minimo_20_chars';
env['JWT_SECRET'] = 'test_jwt_secret_minimum_32_chars_for_zod_validation';
env['SECRETS_ENCRYPTION_KEY_V1'] =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
env['SECRETS_ENCRYPTION_KEY_ACTIVE_VERSION'] = '1';
env['AFIP_ENVIRONMENT'] = 'homologacion';
env['MONEY_ROUNDING_MODE'] = 'HALF_EVEN';
env['MONEY_ROUNDING_STAGE'] = 'PER_LINE';
env['MONEY_CURRENCY'] = 'ARS';
env['LOG_LEVEL'] = 'error';
