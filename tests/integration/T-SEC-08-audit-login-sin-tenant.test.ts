/**
 * T-SEC-08 — auditar un login SIN tenant escribe de verdad en la base.
 *
 * **Por qué existe este test.** `tests/unit/login-rate-limit.test.ts` mockea
 * `withServerActionTracing` y `writeAuditLog`, así que prueba que la Server
 * Action los *llama* — no que el INSERT funcione. El login corre antes de
 * que exista sesión: `tenant_id` es null y el writer tiene que caer a
 * `SYSTEM_TENANT_ID`. Eso se había leído en el código, no ejecutado.
 *
 * El modo de falla que cubre es silencioso a propósito: `auditSafely()` en
 * `src/app/login/actions.ts` atrapa cualquier error del audit para que un
 * problema de logueo no tumbe el login. Si este camino estuviera roto, cada
 * intento de login escribiría un `logger.error` y **ninguna fila** — con
 * los unitarios igual en verde. Exactamente el patrón de "módulo escrito y
 * sin cablear" que ya apareció dos veces en este proyecto.
 *
 * CLAUDE.md §10.2 · §11.2 · EVENT-TAXONOMY §5.
 */
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { writeAuditLog } from '@/lib/audit/audit-writer';
import { withTracingContext } from '@/lib/tracing/context';
import { env } from '@/lib/env';

const SYSTEM_TENANT = env.SYSTEM_TENANT_ID;

/**
 * **Este test NO limpia lo que escribe, a propósito.**
 *
 * La primera versión tenía un `afterEach` con DELETE y el trigger de
 * inmutabilidad lo rechazó: *"audit_log es INSERT-only. UPDATE/DELETE
 * prohibidos"*. Es la garantía que sostiene la defensa ante una inspección
 * de ARCA (CLAUDE.md §10.2, T-AUDIT-01) y no se toca ni para un test —
 * apagar el trigger para limpiar sería debilitar justo lo que protege.
 *
 * Cada caso usa un `correlation_id` único, así que las filas no interfieren
 * con nada. El purgado real de `audit_log` es por DROP PARTITION a los 10
 * años, no por DELETE.
 */

/** Contexto tal cual lo monta withServerActionTracing con requireAuth:false. */
function contextoDeLoginSinSesion(correlationId: string) {
  return {
    correlation_id: correlationId,
    request_id: crypto.randomUUID(),
    // Lo esencial del caso: en el login todavía NO hay tenant ni usuario.
    tenant_id: null,
    actor_user_id: null,
    actor_type: 'system' as const,
  };
}

describe('T-SEC-08 — audit de login sin tenant', () => {
  it('auth.login.failed escribe una fila real con SYSTEM_TENANT_ID', async () => {
    const correlationId = crypto.randomUUID();

    await withTracingContext(contextoDeLoginSinSesion(correlationId), () =>
      writeAuditLog({
        event_name: 'auth.login.failed',
        payload: { email: 'nadie@test.com' },
        pii_level: 'pii_low',
        severity: 'warning',
      })
    );

    const filas = await db.execute<{
      event_name: string;
      tenant_id: string;
      actor_type: string;
      actor_user_id: string | null;
    }>(
      sql`SELECT event_name, tenant_id::text, actor_type, actor_user_id::text
          FROM audit_log WHERE correlation_id = ${correlationId}::uuid`
    );

    // Lo que prueba el test: la fila EXISTE. Si el fallback no funcionara,
    // acá habría 0 y el login seguiría andando igual, sin dejar rastro.
    expect(filas.length).toBe(1);
    expect(filas[0]?.event_name).toBe('auth.login.failed');
    expect(filas[0]?.tenant_id).toBe(SYSTEM_TENANT);
    // actor 'system' porque no hay usuario: loguear 'user' con user_id null
    // dejaría eventos huérfanos imposibles de atribuir.
    expect(filas[0]?.actor_type).toBe('system');
    expect(filas[0]?.actor_user_id).toBeNull();
  });

  it('auth.login.success también escribe (happy path del login)', async () => {
    const correlationId = crypto.randomUUID();

    await withTracingContext(contextoDeLoginSinSesion(correlationId), () =>
      writeAuditLog({
        event_name: 'auth.login.success',
        payload: { email: 'alguien@test.com' },
        pii_level: 'pii_low',
        severity: 'info',
      })
    );

    const filas = await db.execute<{ event_name: string; tenant_id: string }>(
      sql`SELECT event_name, tenant_id::text
          FROM audit_log WHERE correlation_id = ${correlationId}::uuid`
    );

    expect(filas.length).toBe(1);
    expect(filas[0]?.event_name).toBe('auth.login.success');
    expect(filas[0]?.tenant_id).toBe(SYSTEM_TENANT);
  });

  it('la fila cae en la partición del año, no sólo en el padre', async () => {
    // audit_log está particionada por año. Si la partición del año en curso
    // faltara, el INSERT fallaría y auditSafely se lo tragaría.
    const correlationId = crypto.randomUUID();

    await withTracingContext(contextoDeLoginSinSesion(correlationId), () =>
      writeAuditLog({
        event_name: 'auth.login.failed',
        payload: { email: 'particion@test.com' },
        pii_level: 'pii_low',
        severity: 'warning',
      })
    );

    const filas = await db.execute<{ particion: string }>(
      sql`SELECT tableoid::regclass::text AS particion
          FROM audit_log WHERE correlation_id = ${correlationId}::uuid`
    );

    expect(filas.length).toBe(1);
    expect(filas[0]?.particion).toMatch(/^audit_log_\d{4}$/);
  });

  it('la contraseña NUNCA llega al payload persistido', async () => {
    const correlationId = crypto.randomUUID();

    await withTracingContext(contextoDeLoginSinSesion(correlationId), () =>
      writeAuditLog({
        event_name: 'auth.login.failed',
        // El caller nunca manda password; esto verifica que aunque se colara
        // por error, el scrub lo saca antes de persistir.
        payload: { email: 'x@test.com', password: 'no-debe-persistir' },
        pii_level: 'pii_low',
        severity: 'warning',
      })
    );

    const filas = await db.execute<{ payload: unknown }>(
      sql`SELECT payload FROM audit_log WHERE correlation_id = ${correlationId}::uuid`
    );

    expect(JSON.stringify(filas[0]?.payload)).not.toContain('no-debe-persistir');
  });
});
