/**
 * withRlsContext = ejecuta un callback dentro de una transacción que tiene
 *   (a) el role Postgres `authenticated` activo (RLS aplica)
 *   (b) JWT claims setteadas en `request.jwt.claims` (auth.jwt() las lee)
 *
 * Por qué este helper EXISTE (mini-audit pre-Sprint 6 advisor catch 2026-06-12):
 *   El `db` client del repo conecta como role privileged que bypassa RLS.
 *   Todos los tests "cross-tenant" hasta hoy (T-INV-08, T-CASH-08, T-PADRON-01.4,
 *   T-WSAA-01.6) verificaban comportamiento del service layer + UNIQUE
 *   constraints scoped per-tenant, NO RLS isolation real. CLAUDE.md §7.9 exige
 *   T-MT-01..07 explícitamente y este helper habilita escribirlos.
 *
 * Diseño:
 *   - `SET LOCAL role authenticated` dura sólo la transacción (sale al
 *     COMMIT/ROLLBACK). No contamina la conexión para otros tests.
 *   - `set_config('request.jwt.claims', $1, true)` es la variante de SET LOCAL
 *     que ACEPTA parámetros bindeables (SET LOCAL no acepta placeholders).
 *     El `true` final es `is_local=true` — mismo scope que SET LOCAL.
 *   - El callback recibe el `tx` de la transacción. **Si el callback usa
 *     el `db` global en lugar del `tx`, sale del context** — esa query
 *     correrá como role privileged sin RLS. Documentado explícito acá +
 *     en cada test cross-tenant.
 *
 * Forma del JWT (compatible con `pandora.current_company_ids()` definida en
 * migration 0003_rls_policies.sql):
 *   - `company_id`: single (owner/admin/cashier path) — la function lo
 *     envuelve en array de 1 elemento.
 *   - `company_ids`: array (accountant multi-empresa path, ADR-0008) — la
 *     function los devuelve todos.
 *   - Cuando hay AMBOS, `current_company_ids()` da prioridad al array (line 35
 *     del SQL: `COALESCE(company_ids, jsonb_build_array(company_id))`).
 *   - `sub`: user_id. Usado por policies que filtran por `auth.uid()`
 *     (ej. users.id::text = auth.uid()::text).
 *
 * Uso típico (T-MT-01 pattern):
 *
 *   await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
 *     const rowsVisibles = await tx.select().from(sales);
 *     // Solo ve sales de tenantA — RLS filtra el resto.
 *   });
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

export interface RlsJwtClaims {
  /** user_id (UUID). Auth.uid() lo lee como `sub` claim. */
  sub: string;
  /** Single-company path (owner/admin/cashier). UUID. Mutuamente con company_ids. */
  company_id?: string;
  /** Multi-company path (accountant ADR-0008). Array de UUIDs. */
  company_ids?: string[];
  /**
   * Override explícito de "qué company es la activa ahora mismo" cuando el
   * accountant cambia de empresa en la UI. La migration 0003 actual NO lo
   * usa (sólo lee company_id + company_ids) — placeholder para refinamiento
   * futuro de `pandora.current_company_ids()`.
   */
  active_company_id?: string;
  /** Role JWT (no DB role) — usado por algunas policies que diferencian. */
  role?: string;
}

/**
 * Ejecuta `callback` dentro de una transacción con role=authenticated y
 * JWT claims setteados. **EL CALLBACK DEBE USAR EL `tx` RECIBIDO** —
 * usar el `db` global lo saca del context.
 *
 * @param jwt — claims a setear (al menos `sub` + (`company_id` o `company_ids`))
 * @param callback — función async que recibe el `tx` de la transacción
 * @returns lo que devuelva el callback
 *
 * @throws lo que tire el callback. La transacción rollback automáticamente
 *   en error, descartando role + claims.
 */
export async function withRlsContext<T>(
  jwt: RlsJwtClaims,
  callback: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  if (!jwt.company_id && (!jwt.company_ids || jwt.company_ids.length === 0)) {
    throw new Error(
      'withRlsContext: jwt must include company_id (single) OR company_ids (array). ' +
        'A JWT sin ningún company_id setea RLS a "ninguna company" y todo SELECT ' +
        'devuelve vacío silenciosamente — error de test típico.'
    );
  }

  const claimsJson = JSON.stringify(jwt);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL role authenticated`);
    await tx.execute(
      sql`SELECT set_config('request.jwt.claims', ${claimsJson}, true)`
    );
    return callback(tx);
  });
}

/**
 * Variante para "anon" (sin JWT) — RLS aplica pero no hay company_ids,
 * usada para testear policies negativas (un endpoint público no debería
 * poder leer datos de tenant). Setea role=anon (otro rol de Supabase con
 * menos grants que authenticated).
 *
 * Si un test usa esto, el callback debería verificar que SELECT devuelve
 * 0 rows (RLS bloquea) — o que INSERT/UPDATE tira permission denied.
 */
export async function withAnonContext<T>(
  callback: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL role anon`);
    return callback(tx);
  });
}
