/**
 * T-MT-08 — RLS sobre las 8 tablas que quedaron sin proteger + particiones de audit_log.
 *
 * REGRESIÓN DE UNA FUGA REAL (2026-09-02). No es un test preventivo: estas
 * tablas tenían `relrowsecurity = f` y CERO policies en la base viva, y como
 * Supabase expone PostgREST con la anon key (que VIAJA AL BROWSER), cualquiera
 * leía datos de todos los comercios:
 *
 *   GET /rest/v1/sale_payments   -> 59 filas de todos los tenants
 *   GET /rest/v1/metrics_counter -> 202
 *   GET /rest/v1/cash_sessions   -> 2 (con tenant_id visible)
 *
 * Por qué la suite de 961 tests no lo detectó: el cliente `db` conecta con un
 * role `rolbypassrls = t`, así que RLS nunca aplica al path de la app. El vector
 * era PostgREST corriendo como `anon` (rolbypassrls = f). De ahí que este archivo
 * pruebe LAS DOS superficies:
 *
 *   Bloque 1 — capa SQL:  withRlsContext (role authenticated + JWT claims)
 *   Bloque 2 — capa HTTP: fetch real a PostgREST con la anon key
 *
 * Fix: migration 0020_rls_tablas_faltantes.sql.
 * CLAUDE.md §7.2 (RLS = capa 1) + §7.6 (invariante cross-tenant) + §7.9.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { withRlsContext } from '@/lib/multi_tenant/rls_context';

const tenantA = crypto.randomUUID();
const tenantB = crypto.randomUUID();
const userA = crypto.randomUUID();
const userB = crypto.randomUUID();

const sessionA = crypto.randomUUID();
const sessionB = crypto.randomUUID();

const randomCuit = () =>
  '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

describe('T-MT-08 — RLS en tablas antes desprotegidas', () => {
  beforeAll(async () => {
    // Setup con el `db` privileged (bypassa RLS) — sembramos 2 tenants desde
    // un solo contexto, igual que T-MT-04.
    for (const [tenantId, userId] of [
      [tenantA, userA],
      [tenantB, userB],
    ] as const) {
      await db.insert(companies).values({
        id: tenantId,
        name: `T-MT-08 Co ${tenantId.slice(0, 8)}`,
        legal_name: `T-MT-08 Co SRL ${tenantId.slice(0, 8)}`,
        cuit: randomCuit(),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      });

      await db.insert(users).values({
        id: userId,
        email: `t-mt-08-${userId.slice(0, 8)}@test.local`,
        full_name: `User T-MT-08 ${userId.slice(0, 4)}`,
        is_support: false,
      });

      await db.insert(company_users).values({
        id: crypto.randomUUID(),
        company_id: tenantId,
        user_id: userId,
        role: 'cashier',
      });
    }

    // Una sesión de caja por tenant, cada una con un movimiento.
    // cash_movements NO tiene tenant_id: su policy resuelve por el join con
    // cash_sessions. Esa es justamente la rama que hay que probar.
    for (const [sessionId, tenantId, userId] of [
      [sessionA, tenantA, userA],
      [sessionB, tenantB, userB],
    ] as const) {
      await db.insert(cash_sessions).values({
        id: sessionId,
        tenant_id: tenantId,
        sale_point: 1,
        opened_by: userId,
        opened_at: new Date(),
        initial_amount: '1000.0000',
      });

      await db.insert(cash_movements).values({
        cash_session_id: sessionId,
        type: 'deposit',
        amount: '500.0000',
        reason: `movimiento de ${tenantId.slice(0, 8)}`,
        created_by: userId,
      });
    }
  });

  afterAll(async () => {
    // cash_movements es append-only (trigger cash_movements_immutable): el
    // DELETE se bloquea. Para limpiar datos de test se suspenden los triggers
    // dentro de la transacción — mismo patrón que T-CASH-10.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx
        .delete(cash_movements)
        .where(inArray(cash_movements.cash_session_id, [sessionA, sessionB]));
    });
    await db.delete(cash_sessions).where(inArray(cash_sessions.id, [sessionA, sessionB]));
    await db
      .delete(company_users)
      .where(inArray(company_users.company_id, [tenantA, tenantB]));
    await db.delete(users).where(inArray(users.id, [userA, userB]));
    await db.delete(companies).where(inArray(companies.id, [tenantA, tenantB]));
  });

  // ---------------------------------------------------------------
  // Bloque 1 — capa SQL (role authenticated)
  // ---------------------------------------------------------------

  it('cash_sessions: el tenant A no ve la sesión del tenant B', async () => {
    const visto = await withRlsContext(
      { sub: userA, company_id: tenantA },
      async (tx) => tx.select().from(cash_sessions)
    );

    const ids = visto.map((s) => s.id);
    expect(ids).toContain(sessionA);
    expect(ids).not.toContain(sessionB);
  });

  it('cash_movements: la policy por join (sin tenant_id propio) aísla igual', async () => {
    const visto = await withRlsContext(
      { sub: userA, company_id: tenantA },
      async (tx) => tx.select().from(cash_movements)
    );

    const sesiones = visto.map((m) => m.cash_session_id);
    expect(sesiones).toContain(sessionA);
    expect(sesiones).not.toContain(sessionB);
  });

  it('la partición audit_log_2026 no se puede usar para saltear el RLS del padre', async () => {
    // El bug original: el padre tenía RLS y las particiones no, así que
    // `SELECT FROM audit_log_2026` devolvía TODAS las filas (1192) mientras
    // `SELECT FROM audit_log` devolvía 3. Las policies del padre NO aplican
    // cuando se consulta la partición directamente.
    const { viaPadre, viaHija } = await withRlsContext(
      { sub: userA, company_id: tenantA },
      async (tx) => {
        const padre = await tx.execute(
          sql`SELECT count(*)::int AS n FROM audit_log`
        );
        const hija = await tx.execute(
          sql`SELECT count(*)::int AS n FROM audit_log_2026`
        );
        return {
          viaPadre: Number((padre as unknown as Array<{ n: number }>)[0]?.n ?? -1),
          viaHija: Number((hija as unknown as Array<{ n: number }>)[0]?.n ?? -1),
        };
      }
    );

    // Lo que importa no es el número exacto (depende de los datos que haya),
    // sino que ambos caminos devuelvan LO MISMO: la partición no puede ser
    // una puerta lateral.
    expect(viaHija).toBe(viaPadre);
  });

  // ---------------------------------------------------------------
  // Bloque 2 — capa HTTP (PostgREST con anon key) = el vector real
  // ---------------------------------------------------------------

  it('PostgREST con la anon key no expone ninguna tabla tenant-aware', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Si el entorno no tiene Supabase HTTP levantado, fallamos explícito en vez
    // de pasar en verde por omisión — este bloque es el que prueba el exploit real.
    expect(url, 'NEXT_PUBLIC_SUPABASE_URL requerida para T-MT-08').toBeTruthy();
    expect(anon, 'NEXT_PUBLIC_SUPABASE_ANON_KEY requerida para T-MT-08').toBeTruthy();

    const tablas = [
      'cash_sessions',
      'cash_movements',
      'sale_payments',
      'mp_payments',
      'stock_movements',
      'metrics_counter',
      'jobs_queue',
      'processed_webhook_events',
      'audit_log',
      'sales',
      'products',
    ];

    const filtradas: string[] = [];
    for (const tabla of tablas) {
      const res = await fetch(`${url}/rest/v1/${tabla}?select=*&limit=5`, {
        headers: { apikey: anon as string, Authorization: `Bearer ${anon}` },
      });

      // 200 con [] es correcto (RLS filtró). 404 también sirve (no expuesta).
      if (res.status === 404) {
        filtradas.push(tabla);
        continue;
      }

      expect(res.status, `${tabla} respondió ${res.status}`).toBe(200);
      const filas = (await res.json()) as unknown[];
      expect(
        filas,
        `FUGA: /rest/v1/${tabla} devolvió ${filas.length} filas a un cliente anónimo`
      ).toHaveLength(0);
      filtradas.push(tabla);
    }

    expect(filtradas).toHaveLength(tablas.length);
  });
});
