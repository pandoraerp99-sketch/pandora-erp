/**
 * T-CASH-05 + T-CASH-06 (combinados) — Triggers immutability cash_sessions + cash_movements.
 * Sprint 4 ROADMAP Cash context (C-OPS-01) + ADR append-only + RUNBOOKS/cash-discrepancy.md.
 *
 * **Filosofía defense-in-depth:** El service NUNCA hace UPDATE de session
 * cerrada ni UPDATE/DELETE de cash_movement. Pero si alguien bypassa el
 * service (raw SQL, migration runtime, bug futuro), los triggers SQL son
 * la red de seguridad final.
 *
 * **T-CASH-05 — Trigger `cash_sessions_immutable_after_close` (conditional):**
 *
 * El trigger usa `WHEN (OLD.closed_at IS NOT NULL)` — solo bloquea cuando
 * la row PREVIA estaba cerrada. Esto es crucial: permite la transición
 * `open → close` (closed_at: NULL → NOT NULL), pero rechaza cualquier
 * mutación POSTERIOR.
 *
 * Validamos:
 *   T5.1 UPDATE de session ABIERTA → OK (trigger WHEN no se dispara)
 *   T5.2 Cierre por service → OK (transición close válida)
 *   T5.3 UPDATE de session CERRADA bypass-service → throw check_violation
 *   T5.4 DELETE de session CERRADA bypass-service → throw check_violation
 *
 * **T-CASH-06 — Trigger `cash_movements_immutable` (unconditional):**
 *
 * Mismo patrón que stock_movements (T-INV-05). cash_movements es append-only:
 * UPDATE/DELETE/TRUNCATE TODOS prohibidos. Cancelación = INSERT inverso
 * (withdraw → deposit).
 *
 * Validamos:
 *   T6.1 UPDATE → throw check_violation
 *   T6.2 DELETE → throw check_violation
 *   T6.3 TRUNCATE → throw check_violation (statement-level trigger)
 *   T6.4 INSERT inverso (deposit ↔ withdraw) → OK (path negativo legítimo)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { openCashSession, closeCashSession } from '@/lib/cash/sessions';
import { registerCashMovement } from '@/lib/cash/movements';

/** Mismo helper que T-INV-06 / T-CASH-04 — desenvuelve PgError de Drizzle. */
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

describe('T-CASH-05 + T-CASH-06 — Triggers immutability', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let openSessionId: string | undefined;
  let closedSessionId: string | undefined;
  let movementId: bigint | undefined;

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-CASH-05 Test Co',
      legal_name: 'T-CASH-05 Test Co SRL',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });

    await db.insert(users).values({
      id: userId,
      email: `t-cash-05-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier T-CASH-05',
      is_support: false,
    });

    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });

    // Setup: una session que vamos a dejar abierta + una session que vamos
    // a cerrar via service para tener target de los triggers.
    const open = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () => openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );
    openSessionId = open.id;

    // Cash movement sobre la session abierta (target del trigger movements).
    const movement = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        registerCashMovement({
          cash_session_id: openSessionId!,
          type: 'deposit',
          amount: '100.0000',
          reason: 'reposicion para vuelto',
        })
    );
    movementId = movement.id;
  });

  afterAll(async () => {
    // Cleanup con session_replication_role='replica' bypassa ambos triggers
    // (cash_sessions immutable post-close + cash_movements unconditional).
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx
        .delete(cash_movements)
        .where(
          sql`${cash_movements.cash_session_id} IN (
            SELECT id FROM cash_sessions WHERE tenant_id = ${tenantId}
          )`
        );
      await tx
        .delete(cash_sessions)
        .where(eq(cash_sessions.tenant_id, tenantId));
      await tx
        .delete(company_users)
        .where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  describe('T-CASH-05 — cash_sessions_immutable_after_close (conditional)', () => {
    it('T5.1: UPDATE de session ABIERTA por SQL directo → OK (trigger WHEN OLD.closed_at IS NOT NULL no se dispara)', async () => {
      expect(openSessionId).toBeDefined();

      // Esta UPDATE NO debería fallar — el trigger es condicional y la session
      // está abierta (OLD.closed_at IS NULL). Cualquier campo modificable
      // sobre una session abierta debería pasar.
      //
      // Como no hay un endpoint legítimo para tocar columnas de session abierta
      // post-creación, usamos updated_at = now() (campo manejado por la DB).
      // Es un no-op funcional pero válido para probar que el trigger no bloquea.
      await db.execute(sql`
        UPDATE cash_sessions
        SET updated_at = now()
        WHERE id = ${openSessionId!}
      `);

      // Verifico que la session sigue abierta + updated_at se movió.
      const rows = await db
        .select()
        .from(cash_sessions)
        .where(eq(cash_sessions.id, openSessionId!))
        .limit(1);
      expect(rows[0]?.closed_at).toBeNull();
    });

    it('T5.2: cierre por service (transición close válida) → OK; closed_at queda NOT NULL', async () => {
      expect(openSessionId).toBeDefined();

      // El service hace UPDATE legítimo close — OLD.closed_at era NULL, trigger
      // condicional no se dispara, UPDATE pasa.
      const closeResult = await withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        () =>
          closeCashSession({
            session_id: openSessionId!,
            counted_amount: '1100.0000', // incluye el deposit de $100
            expected_amount: '1100.0000',
          })
      );
      expect(closeResult.session.closed_at).not.toBeNull();
      closedSessionId = closeResult.session.id;
    });

    it('T5.3: UPDATE de session CERRADA bypass-service → throw check_violation con mensaje INMUTABLE', async () => {
      expect(closedSessionId).toBeDefined();

      let caught: unknown;
      try {
        await db.execute(sql`
          UPDATE cash_sessions
          SET descuadre = '999.0000', discrepancy_reason = 'tampering attempt'
          WHERE id = ${closedSessionId!}
        `);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      const err = unwrapPgError(caught);
      expect(err.code).toBe('23514'); // USING ERRCODE = 'check_violation'
      expect(err.message).toMatch(/INMUTABLE/);
      expect(err.message).toMatch(/cash_sessions ya cerrada/);

      // Verifico que la row NO cambió (descuadre sigue siendo el original).
      const rows = await db
        .select()
        .from(cash_sessions)
        .where(eq(cash_sessions.id, closedSessionId!))
        .limit(1);
      expect(rows[0]?.descuadre).toBe('0.0000');
      expect(rows[0]?.discrepancy_reason).toBeNull();
    });

    it('T5.4: DELETE de session CERRADA bypass-service → throw check_violation', async () => {
      expect(closedSessionId).toBeDefined();

      let caught: unknown;
      try {
        await db.execute(sql`
          DELETE FROM cash_sessions WHERE id = ${closedSessionId!}
        `);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      const err = unwrapPgError(caught);
      expect(err.code).toBe('23514');
      expect(err.message).toMatch(/INMUTABLE/);

      // Verifico que la row sigue existiendo.
      const rows = await db
        .select({ id: cash_sessions.id })
        .from(cash_sessions)
        .where(eq(cash_sessions.id, closedSessionId!));
      expect(rows).toHaveLength(1);
    });
  });

  describe('T-CASH-06 — cash_movements_immutable (unconditional)', () => {
    it('T6.1: UPDATE de cash_movement → throw check_violation (INSERT-only)', async () => {
      expect(movementId).toBeDefined();

      let caught: unknown;
      try {
        await db.execute(sql`
          UPDATE cash_movements SET amount = '999.9999' WHERE id = ${movementId!}
        `);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      const err = unwrapPgError(caught);
      expect(err.code).toBe('23514');
      expect(err.message).toMatch(/INSERT-only/);
      expect(err.message).toMatch(/cash_movements/);
    });

    it('T6.2: DELETE de cash_movement → throw check_violation', async () => {
      expect(movementId).toBeDefined();

      let caught: unknown;
      try {
        await db.execute(sql`
          DELETE FROM cash_movements WHERE id = ${movementId!}
        `);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      const err = unwrapPgError(caught);
      expect(err.code).toBe('23514');
      expect(err.message).toMatch(/INSERT-only/);

      // Verifico que la row sigue existiendo.
      const rows = await db
        .select({ id: cash_movements.id })
        .from(cash_movements)
        .where(eq(cash_movements.id, movementId!));
      expect(rows).toHaveLength(1);
    });

    it('T6.3: TRUNCATE de cash_movements → throw check_violation (statement-level trigger)', async () => {
      let caught: unknown;
      try {
        await db.execute(sql`TRUNCATE TABLE cash_movements`);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      const err = unwrapPgError(caught);
      expect(err.code).toBe('23514');
      expect(err.message).toMatch(/INSERT-only/);
    });

    it('T6.4: INSERT inverso (deposit → withdraw) via service → OK (cancelación legítima)', async () => {
      expect(closedSessionId).toBeDefined();

      // OJO: la session ya está cerrada (T5.2). Necesito una session ABIERTA
      // para registrar un movement nuevo. Abro una nueva session sale_point=2
      // (sp=1 sigue cerrada hasta cleanup).
      const newSession = await withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        () => openCashSession({ sale_point: 2, initial_amount: '500.0000' })
      );

      // Registro un deposit + su withdraw inverso (cancelación append-only).
      const deposit = await withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        () =>
          registerCashMovement({
            cash_session_id: newSession.id,
            type: 'deposit',
            amount: '50.0000',
            reason: 'reposicion inicial sp=2',
          })
      );
      const withdrawCancel = await withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        () =>
          registerCashMovement({
            cash_session_id: newSession.id,
            type: 'withdraw',
            amount: '50.0000',
            reason: 'cancelacion del deposit anterior (movimiento inverso)',
          })
      );

      expect(deposit.id).not.toBe(withdrawCancel.id);
      expect(deposit.type).toBe('deposit');
      expect(withdrawCancel.type).toBe('withdraw');
      expect(deposit.amount).toBe(withdrawCancel.amount);

      // Ambos rows existen en DB (no fueron retirados por el trigger).
      const movementsInNewSession = await db
        .select({ id: cash_movements.id, type: cash_movements.type })
        .from(cash_movements)
        .where(eq(cash_movements.cash_session_id, newSession.id));
      expect(movementsInNewSession).toHaveLength(2);
      const types = movementsInNewSession.map((m) => m.type).sort();
      expect(types).toEqual(['deposit', 'withdraw']);
    });
  });
});
