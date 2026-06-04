/**
 * Setup global para tests integration.
 *
 * **Diferencia vs tests/setup.ts (unit):**
 * - Carga `.env.test` con dotenv (DATABASE_URL real apuntando a Supabase Local
 *   CLI o cloud dev).
 * - NO sobreescribe env vars con placeholders — los tests integration
 *   necesitan DATABASE_URL válido para conectar.
 * - Aborta el run si faltan vars críticas (fail-fast).
 *
 * **Cleanup entre tests:**
 * - Cada test es responsable de su cleanup (BEGIN/ROLLBACK pattern preferido)
 *   o de operar en datasets aislados por tenant_id único.
 * - No hay truncate global automático — tests deben coexistir.
 */
import { config } from 'dotenv';
import { beforeAll } from 'vitest';

config({ path: '.env.test' });

const REQUIRED_VARS = [
  'NODE_ENV',
  'DATABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'SECRETS_ENCRYPTION_KEY_V1',
  'SECRETS_ENCRYPTION_KEY_ACTIVE_VERSION',
  'AFIP_ENVIRONMENT',
] as const;

beforeAll(() => {
  const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Integration tests requieren .env.test con las siguientes vars: ${missing.join(', ')}.\n` +
        `Setup: cp .env.test.example .env.test (después de supabase start).`
    );
  }
  // Confirmar que apuntamos a Supabase LOCAL (no managed prod por accidente).
  const dbUrl = process.env['DATABASE_URL']!;
  const isLocal = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
  const isExplicitlyCloudDev = process.env['INTEGRATION_TARGET'] === 'cloud_dev';
  if (!isLocal && !isExplicitlyCloudDev) {
    throw new Error(
      `DATABASE_URL apunta a ${dbUrl.replace(/:[^@]*@/, ':***@')}, parece NO ser local.\n` +
        `Para correr contra cloud dev project: setear INTEGRATION_TARGET=cloud_dev en .env.test.\n` +
        `FAIL-FAST guard: previene correr tests destructivos contra Supabase managed prod por accidente.`
    );
  }
});
