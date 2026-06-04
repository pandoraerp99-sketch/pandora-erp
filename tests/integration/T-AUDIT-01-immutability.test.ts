/**
 * T-AUDIT-01 — Trigger immutable bloquea UPDATE/DELETE/TRUNCATE en audit_log.
 * Sprint 2 ROADMAP Platform + EVENT-TAXONOMY §5 + CLAUDE.md §10.2.
 *
 * **Por qué CRÍTICO:** audit_log es inmutable por 10 años (Ley 11.683 + Decreto
 * 1397/79). Si el trigger fallara, alguien podría borrar/modificar entries y
 * romper auditabilidad fiscal post-hoc (anti-pattern §20.5).
 *
 * **Particionamiento:** audit_log usa PARTITION BY RANGE (created_at). El
 * trigger immutable se aplica vía partitions hijas (audit_log_2026,
 * audit_log_2027). Verificamos contra la tabla padre + la partition activa.
 *
 * **Lo que validamos:**
 * - INSERT via writeAuditLog (path normal) → OK
 * - UPDATE directo sobre row insertado → throw check_violation + 'INSERT-only'
 * - DELETE directo → throw idem
 * - TRUNCATE sobre tabla padre → throw idem
 * - INSERT continúa funcionando post-throws (append-only NO read-only)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { audit_log } from '@/lib/db/schema/audit';
import { writeAuditLog } from '@/lib/audit/audit-writer';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';

function unwrapPgError(e: unknown): {
  code?: string;
  message: string;
  constraint?: string;
} {
  if (e && typeof e === 'object') {
    const err = e as { message?: string; code?: string; cause?: unknown };
    const cause = err.cause as
      | { code?: string; message?: string; constraint_name?: string }
      | undefined;
    return {
      code: cause?.code ?? err.code,
      message: cause?.message ?? err.message ?? String(e),
      constraint: cause?.constraint_name,
    };
  }
  return { message: String(e) };
}

describe('T-AUDIT-01 — audit_log immutability + INSERT continúa OK', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let insertedAuditId: bigint;

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-AUDIT-01 Test Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userId,
      email: `t-audit-01-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Test',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });

    // INSERT inicial via writeAuditLog (path normal — pasa por scrub + validator)
    await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        writeAuditLog({
          event_name: 'sale.completed',
          payload: { test: 'T-AUDIT-01 setup', sale_id: crypto.randomUUID() },
          pii_level: 'internal',
          severity: 'info',
        })
    );

    // Recuperar el id del audit recién insertado para los tests de tamper
    const rows = await db
      .select()
      .from(audit_log)
      .where(eq(audit_log.tenant_id, tenantId))
      .limit(1);
    insertedAuditId = rows[0]!.id;
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('UPDATE en audit_log → throw check_violation + mensaje "INSERT-only"', async () => {
    let caught: Error | null = null;
    try {
      await db
        .update(audit_log)
        .set({ payload: { tampered: true } })
        .where(eq(audit_log.id, insertedAuditId));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    const pgErr = unwrapPgError(caught);
    expect(pgErr.code).toBe('23514'); // check_violation
    expect(pgErr.message).toMatch(/INSERT-only/);
  });

  it('DELETE en audit_log → throw check_violation', async () => {
    let caught: Error | null = null;
    try {
      await db.delete(audit_log).where(eq(audit_log.id, insertedAuditId));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    const pgErr = unwrapPgError(caught);
    expect(pgErr.code).toBe('23514');
    expect(pgErr.message).toMatch(/INSERT-only/);
  });

  it('TRUNCATE en audit_log → throw check_violation', async () => {
    let caught: Error | null = null;
    try {
      await db.execute(sql`TRUNCATE TABLE audit_log`);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    const pgErr = unwrapPgError(caught);
    expect(pgErr.code).toBe('23514');
    expect(pgErr.message).toMatch(/INSERT-only/);
  });

  it('INSERT subsiguiente (append-only NO bloquea inserts) → OK', async () => {
    // Validación positiva: el trigger NO bloquea INSERTs. Append-only = solo
    // INSERT; cancelación de evento auditable = INSERT de evento que niega
    // el anterior (no UPDATE/DELETE del original).
    await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        writeAuditLog({
          event_name: 'sale.cancelled',
          payload: { test: 'T-AUDIT-01 post-tamper', reason: 'cancelación operativa' },
          pii_level: 'internal',
          severity: 'notice',
        })
    );

    // Verifica que ahora hay 2 entries (el de setup + el de este test)
    const rows = await db
      .select()
      .from(audit_log)
      .where(eq(audit_log.tenant_id, tenantId));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('Tamper directo sobre partition hija audit_log_2026 → también bloqueado', async () => {
    // El trigger immutable está definido sobre la tabla padre; PostgreSQL
    // propaga el trigger a las partitions hijas automáticamente.
    // Confirmamos que UPDATE directo sobre `audit_log_2026` también falla.
    let caught: Error | null = null;
    try {
      await db.execute(
        sql`UPDATE audit_log_2026 SET payload = ${'{}'}::jsonb WHERE id = ${insertedAuditId}`
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    const pgErr = unwrapPgError(caught);
    expect(pgErr.code).toBe('23514');
  });
});
