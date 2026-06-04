/**
 * Vitest config dedicada para tests integration (DB real).
 *
 * **Diferencias vs vitest.config.ts (unit tests):**
 * - Lee `.env.test` con DATABASE_URL real (Supabase Local CLI o cloud dev).
 * - Setup file distinto (`tests/integration/setup.ts`) que NO mockea env.
 * - Solo glob `tests/integration/**\/*.test.ts` (no toca unit tests).
 * - `fileParallelism: false` — evita race conditions entre tests con tx que
 *   comparten DB. Tests DENTRO de un archivo pueden paralelizar; entre
 *   archivos secuencial.
 * - Timeout más alto (15s default) — DB roundtrip + Supabase Auth pueden tardar.
 *
 * **Uso:**
 *   pnpm test:integration              # corre todo
 *   pnpm test:integration --watch      # watch mode
 *   pnpm test:integration inventory    # solo tests con 'inventory' en path
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./tests/integration/setup.ts'],
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['tests/unit/**', 'node_modules/**'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // Vitest 4.x: serializar entre archivos (singleThread/poolOptions cambió).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
