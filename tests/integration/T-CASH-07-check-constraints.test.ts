/**
 * T-CASH-07 — CHECK constraints SQL bypass-service (cash_sessions + cash_movements).
 * Sprint 4 ROADMAP Cash context (C-OPS-01) + CLAUDE.md §16.6 defense-in-depth.
 *
 * **Filosofía defense-in-depth:** El service `openCashSession`/`closeCashSession`/
 * `registerCashMovement` valida ANTES del INSERT. Pero si alguien bypassa
 * (raw SQL, migration runtime, bug futuro), los CHECK constraints DB son la
 * red de seguridad final. Verificamos cada CHECK uno por uno con raw SQL.
 *
 * **cash_sessions CHECKs (6 total — del `\d cash_sessions`):**
 *   C1 `cash_sessions_sale_point_positive`         sale_point > 0
 *   C2 `cash_sessions_initial_amount_non_negative` initial_amount >= 0
 *   C3 `cash_sessions_final_amount_non_negative`   final_amount IS NULL OR >= 0
 *   C4 `cash_sessions_expected_amount_non_negative` expected_amount IS NULL OR >= 0
 *   C5 `cash_sessions_closed_consistency`          closed_* all-NULL XOR all-NOT-NULL
 *   C6 `cash_sessions_discrepancy_reason_required` descuadre != 0 ⇒ reason non-empty
 *
 * **cash_movements CHECKs (3 total — reason ya cubierto T-CASH-04):**
 *   M1 `cash_movements_type_check`         type ∈ {withdraw, deposit, provider_payment}
 *   M2 `cash_movements_amount_positive`    amount > 0
 *   M3 `cash_movements_reason_not_empty`   length(reason) > 0  ← T-CASH-04
 *
 * Cubrimos C1, C2, C5, C6, M1, M2 aquí (C3+C4 son variantes triviales de C2;
 * M3 ya cubierto en T-CASH-04).
 *
 * Cada CHECK debería retornar SQLSTATE '23514' con `constraint_name` matching.
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
import { openCashSession } from '@/lib/cash/sessions';

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

/** Helper: asserta que el error es CHECK constraint con el constraint name esperado. */
function expectCheckViolation(caught: unknown, constraintNameRegex: RegExp): void {
  expect(caught).toBeDefined();
  const err = unwrapPgError(caught);
  expect(err.code).toBe('23514'); // check_violation
  const allText = `${err.message} ${err.constraint ?? ''}`;
  expect(allText).toMatch(constraintNameRegex);
}

describe('T-CASH-07 — CHECK constraints SQL bypass-service', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let openSessionId: string | undefined;

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-CASH-07 Test Co',
      legal_name: 'T-CASH-07 Test Co SRL',
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
      email: `t-cash-07-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier T-CASH-07',
      is_support: false,
    });

    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });

    // Una session abierta hace de container para los CHECKs de cash_movements.
    const session = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () => openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );
    openSessionId = session.id;
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      if (openSessionId) {
        await tx
          .delete(cash_movements)
          .where(eq(cash_movements.cash_session_id, openSessionId));
      }
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

  describe('cash_sessions CHECKs', () => {
    it('C1 sale_point_positive: sale_point=0 → check_violation', async () => {
      let caught: unknown;
      try {
        await db.execute(sql`
          INSERT INTO cash_sessions (tenant_id, sale_point, opened_by, initial_amount)
          VALUES (${tenantId}, 0, ${userId}, 1000.0000)
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_sessions_sale_point_positive/);
    });

    it('C1 sale_point_positive: sale_point=-5 → check_violation', async () => {
      let caught: unknown;
      try {
        await db.execute(sql`
          INSERT INTO cash_sessions (tenant_id, sale_point, opened_by, initial_amount)
          VALUES (${tenantId}, -5, ${userId}, 1000.0000)
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_sessions_sale_point_positive/);
    });

    it('C2 initial_amount_non_negative: initial_amount=-1 → check_violation', async () => {
      let caught: unknown;
      try {
        await db.execute(sql`
          INSERT INTO cash_sessions (tenant_id, sale_point, opened_by, initial_amount)
          VALUES (${tenantId}, 99, ${userId}, -1.0000)
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_sessions_initial_amount_non_negative/);
    });

    it('C5 closed_consistency: INSERT session abierta con final_amount NOT NULL → check_violation (debería estar coherentemente NULL)', async () => {
      let caught: unknown;
      try {
        // Intento dejar closed_at NULL pero pasar final_amount — viola la
        // disyunción "all-NULL XOR all-NOT-NULL".
        await db.execute(sql`
          INSERT INTO cash_sessions (
            tenant_id, sale_point, opened_by, initial_amount, final_amount
          )
          VALUES (${tenantId}, 98, ${userId}, 1000.0000, 1100.0000)
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_sessions_closed_consistency/);
    });

    it('C5 closed_consistency: INSERT session cerrada con expected_amount NULL → check_violation', async () => {
      let caught: unknown;
      try {
        // closed_at NOT NULL + final_amount NOT NULL pero expected_amount NULL
        // viola consistency.
        await db.execute(sql`
          INSERT INTO cash_sessions (
            tenant_id, sale_point, opened_by, initial_amount,
            closed_by, closed_at, final_amount, descuadre
          )
          VALUES (
            ${tenantId}, 97, ${userId}, 1000.0000,
            ${userId}, now(), 1000.0000, 0.0000
          )
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_sessions_closed_consistency/);
    });

    it('C6 discrepancy_reason_required: cierre con descuadre=-100 sin reason → check_violation', async () => {
      let caught: unknown;
      try {
        // INSERT directo simulando "cierre con descuadre" pero reason NULL.
        // Esto pasa la consistency check (closed_* todos NOT NULL) pero falla
        // discrepancy_reason_required.
        await db.execute(sql`
          INSERT INTO cash_sessions (
            tenant_id, sale_point, opened_by, initial_amount,
            closed_by, closed_at, final_amount, expected_amount,
            descuadre, discrepancy_reason
          )
          VALUES (
            ${tenantId}, 96, ${userId}, 1000.0000,
            ${userId}, now(), 900.0000, 1000.0000,
            -100.0000, NULL
          )
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_sessions_discrepancy_reason_required/);
    });

    it('C6 discrepancy_reason_required: descuadre=50 con reason="" (vacío) → check_violation', async () => {
      let caught: unknown;
      try {
        await db.execute(sql`
          INSERT INTO cash_sessions (
            tenant_id, sale_point, opened_by, initial_amount,
            closed_by, closed_at, final_amount, expected_amount,
            descuadre, discrepancy_reason
          )
          VALUES (
            ${tenantId}, 95, ${userId}, 1000.0000,
            ${userId}, now(), 1050.0000, 1000.0000,
            50.0000, ''
          )
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_sessions_discrepancy_reason_required/);
    });
  });

  describe('cash_movements CHECKs', () => {
    it('M1 type_check: type="invalid_type" → check_violation', async () => {
      expect(openSessionId).toBeDefined();
      let caught: unknown;
      try {
        await db.execute(sql`
          INSERT INTO cash_movements (cash_session_id, type, amount, reason, created_by)
          VALUES (${openSessionId!}, 'invalid_type', 100.0000, 'test', ${userId})
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_movements_type_check/);
    });

    it('M1 type_check: type="sale" (valor stock_movements pero NO cash_movements) → check_violation', async () => {
      // Guard contra confusion entre catalogs (STOCK_MOVEMENT_TYPES vs CASH_MOVEMENT_TYPES).
      expect(openSessionId).toBeDefined();
      let caught: unknown;
      try {
        await db.execute(sql`
          INSERT INTO cash_movements (cash_session_id, type, amount, reason, created_by)
          VALUES (${openSessionId!}, 'sale', 100.0000, 'test', ${userId})
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_movements_type_check/);
    });

    it('M2 amount_positive: amount=0 → check_violation (no se permite "movement nulo")', async () => {
      expect(openSessionId).toBeDefined();
      let caught: unknown;
      try {
        await db.execute(sql`
          INSERT INTO cash_movements (cash_session_id, type, amount, reason, created_by)
          VALUES (${openSessionId!}, 'deposit', 0.0000, 'amount nulo', ${userId})
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_movements_amount_positive/);
    });

    it('M2 amount_positive: amount=-100 → check_violation (signo deriva del type, NUNCA negativo)', async () => {
      expect(openSessionId).toBeDefined();
      let caught: unknown;
      try {
        await db.execute(sql`
          INSERT INTO cash_movements (cash_session_id, type, amount, reason, created_by)
          VALUES (${openSessionId!}, 'withdraw', -100.0000, 'amount negativo', ${userId})
        `);
      } catch (e) {
        caught = e;
      }
      expectCheckViolation(caught, /cash_movements_amount_positive/);
    });
  });
});
