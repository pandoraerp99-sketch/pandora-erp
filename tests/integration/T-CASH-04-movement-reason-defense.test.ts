/**
 * T-CASH-04 — Defense layered (service + DB) para cash_movements.reason.
 * Sprint 4 ROADMAP Cash context (C-OPS-01) — RUNBOOKS/cash-discrepancy.md
 * paso 2: reconstruir flujo desde cash_movements requiere reason por row.
 *
 * **Por qué importa:**
 * Un movimiento sin reason es un agujero en la traza de descuadre.
 * Pandora aplica defense layered con 2 capas independientes:
 *
 *   1. **Service layer (TS):** `prepareRegisterMovementValues` valida
 *      reason.trim().length > 0 ANTES del INSERT → throw MovementValidationError
 *      code='missing_reason' (input-time defense).
 *
 *   2. **DB layer (SQL):** CHECK constraint `cash_movements_reason_not_empty`
 *      enforce length(reason) > 0 incluso si alguien hace INSERT directo
 *      bypass-service (raw SQL, migration runtime, bug futuro que olvide
 *      llamar al pure helper).
 *
 * Sin ambas capas, un bug en TS dejaría rows con reason='' que romperían el
 * runbook. Sin la capa TS, el error sería "23514 check_violation" críptico
 * en runtime — peor UX.
 *
 * **Lo que validamos:**
 *   - Path service: registerCashMovement con reason='   ' (whitespace) →
 *     MovementValidationError code='missing_reason'. Verificamos que NO se
 *     insertó row (validation antes de INSERT).
 *   - Path DB bypass: INSERT raw con reason='' contra cash_movements →
 *     PostgresError con code 23514 (check_violation).
 *   - Happy path: registerCashMovement con reason válida → row insertada
 *     con todos los campos esperados. Anchor para confirmar que el path
 *     positivo SÍ funciona (no estamos rechazando por otro motivo).
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
import {
  registerCashMovement,
  MovementValidationError,
} from '@/lib/cash/movements';

/**
 * Drizzle envuelve PostgresError en wrapper con `.cause`. El code SQL vive
 * en `.cause.code` (ej: '23514' = check_violation). Mismo helper que T-INV-06.
 */
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

describe('T-CASH-04 — Defense layered reason requirement', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let openSessionId: string | undefined;

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-CASH-04 Test Co',
      legal_name: 'T-CASH-04 Test Co SRL',
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
      email: `t-cash-04-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier T-CASH-04',
      is_support: false,
    });

    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });

    // Abro una session que vamos a usar como host de los movements de prueba.
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
      // cash_movements primero (FK a cash_sessions).
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

  const withCtx = async <T,>(fn: () => Promise<T>): Promise<T> =>
    withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      fn
    );

  it('service-level: registerCashMovement con reason vacía/whitespace → MovementValidationError code=missing_reason; NO row insertada', async () => {
    expect(openSessionId).toBeDefined();

    // ── 1. reason = '' ──
    let caught1: unknown;
    try {
      await withCtx(() =>
        registerCashMovement({
          cash_session_id: openSessionId!,
          type: 'withdraw',
          amount: '100.0000',
          reason: '',
        })
      );
    } catch (e) {
      caught1 = e;
    }
    expect(caught1).toBeInstanceOf(MovementValidationError);
    if (caught1 instanceof MovementValidationError) {
      expect(caught1.code).toBe('missing_reason');
      expect(caught1.message).toMatch(/reason es OBLIGATORIO/);
    }

    // ── 2. reason = '   ' (whitespace puro — el service hace .trim()) ──
    let caught2: unknown;
    try {
      await withCtx(() =>
        registerCashMovement({
          cash_session_id: openSessionId!,
          type: 'deposit',
          amount: '50.0000',
          reason: '   ',
        })
      );
    } catch (e) {
      caught2 = e;
    }
    expect(caught2).toBeInstanceOf(MovementValidationError);
    if (caught2 instanceof MovementValidationError) {
      expect(caught2.code).toBe('missing_reason');
    }

    // ── Verificar NO row insertada (validation antes de INSERT) ──
    const rowsAfter = await db
      .select({ id: cash_movements.id })
      .from(cash_movements)
      .where(eq(cash_movements.cash_session_id, openSessionId!));
    expect(rowsAfter).toHaveLength(0);
  });

  it('DB-level bypass-service: INSERT raw con reason="" → PostgresError check_violation (cash_movements_reason_not_empty)', async () => {
    expect(openSessionId).toBeDefined();

    // INSERT raw bypaseando todo el service. Esto simula:
    //   - alguien escribiendo SQL directo
    //   - una migration runtime con valores constantes
    //   - un bug futuro que olvide llamar a prepareRegisterMovementValues
    //
    // Esperamos PostgresError code='23514' (check_violation) con constraint
    // name = cash_movements_reason_not_empty (verificado en \d cash_movements).
    let caught: unknown;
    try {
      await db.execute(sql`
        INSERT INTO cash_movements (cash_session_id, type, amount, reason, created_by)
        VALUES (${openSessionId!}, 'withdraw', 100.0000, '', ${userId})
      `);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    // Drizzle envuelve el PostgresError en wrapper — usamos unwrapPgError
    // para acceder al code SQL real (mismo helper que T-INV-06).
    const err = unwrapPgError(caught);
    expect(err.code).toBe('23514'); // check_violation
    // El nombre del CHECK puede venir en `constraint` (constraint_name) o en
    // el message. Verifico ambos.
    const allText = `${err.message} ${err.constraint ?? ''}`;
    expect(allText).toMatch(/cash_movements_reason_not_empty/);
  });

  it('happy path: registerCashMovement con reason válida → row insertada con campos correctos (anchor sanity)', async () => {
    expect(openSessionId).toBeDefined();

    const created = await withCtx(() =>
      registerCashMovement({
        cash_session_id: openSessionId!,
        type: 'withdraw',
        amount: '250.0000',
        reason: 'cambio para vuelto inicial',
      })
    );

    expect(created.cash_session_id).toBe(openSessionId!);
    expect(created.type).toBe('withdraw');
    expect(created.amount).toBe('250.0000');
    expect(created.reason).toBe('cambio para vuelto inicial');
    expect(created.created_by).toBe(userId);
    expect(created.correlation_id).toBeDefined();

    // Verifico que efectivamente quedó en DB (no solo en memoria).
    const rows = await db
      .select()
      .from(cash_movements)
      .where(eq(cash_movements.id, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe('cambio para vuelto inicial');
  });
});
