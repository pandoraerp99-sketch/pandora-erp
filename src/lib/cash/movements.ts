/**
 * Cash movements service — movimientos MANUALES de caja dentro de una session.
 * Sprint 4 ROADMAP Cash context (C-OPS-01).
 *
 * **Append-only:** stock_movements pattern (trigger SQL + service guards).
 * Cancelación = INSERT inverso (withdraw → deposit, viceversa).
 *
 * **NO emite audit_log propio:** los movimientos son granulares (5-20/día/session).
 * El audit ocurre vía `cash_session.closed*` con resumen agregado. Esto evita
 * spam del audit_log para movimientos triviales (cada retiro de $500). RUNBOOK
 * cash-discrepancy paso 2 consulta `cash_movements` directamente por SQL para
 * reconstruir el flujo.
 *
 * **F1+ trigger reevaluación:** si Pandora team operación reporta que
 * "necesitamos audit por movimiento" para investigaciones de fraude, agregar
 * `cash_movement.registered` al catálogo + emit.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  cash_movements,
  type CashMovement,
  type NewCashMovement,
} from '../db/schema/cash_movements.js';
import { cash_sessions } from '../db/schema/cash_sessions.js';
import {
  CASH_MOVEMENT_TYPES,
  type CashMovementType,
} from '../db/schema/_common.js';
import { requireTracingContext } from '../tracing/context.js';
import type { TracingContext } from '../tracing/context.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';
import { isValidUuid } from '../tracing/ids.js';
import { normalizeCashAmount, CashValidationError } from './sessions.js';

// ──── Errores adicionales tipados ──────────────────────────────

export class MovementValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_session_id'
      | 'invalid_type'
      | 'invalid_amount'
      | 'missing_reason'
      | 'session_already_closed',
    message: string
  ) {
    super(message);
    this.name = 'MovementValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MovementSessionNotFoundError extends Error {
  constructor(public readonly session_id: string) {
    super(
      `MovementSessionNotFoundError: cash_session ${session_id} no existe o pertenece a otro tenant. NO se pueden registrar movimientos sin session activa.`
    );
    this.name = 'MovementSessionNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ──── Inputs ────────────────────────────────────────────────────

export interface RegisterMovementInput {
  cash_session_id: string;
  type: CashMovementType;
  amount: string | number;
  /** Motivo obligatorio (TODOS los movimientos lo requieren — defensa contra mutable audit). */
  reason: string;
}

// ──── Pure helpers (testeables sin DB) ─────────────────────────

/**
 * Valida + normaliza input para INSERT a cash_movements. Pure helper.
 *
 * @throws MovementValidationError si input inválido
 * @throws CashValidationError (re-thrown) si amount inválido
 */
export function prepareRegisterMovementValues(
  input: RegisterMovementInput,
  ctx: TracingContext
): NewCashMovement {
  if (!isValidUuid(input.cash_session_id)) {
    throw new MovementValidationError(
      'invalid_session_id',
      `cash_session_id no es UUID válido ("${input.cash_session_id}")`
    );
  }
  if (!CASH_MOVEMENT_TYPES.includes(input.type)) {
    throw new MovementValidationError(
      'invalid_type',
      `type "${input.type}" no válido. Valores: ${CASH_MOVEMENT_TYPES.join(', ')}`
    );
  }

  // Reusa normalizeCashAmount del sessions service (Number + regex strict).
  let amount: string;
  try {
    amount = normalizeCashAmount(input.amount, 'counted_amount');
  } catch (e) {
    if (e instanceof CashValidationError) {
      throw new MovementValidationError('invalid_amount', e.message);
    }
    throw e;
  }
  if (parseFloat(amount) <= 0) {
    throw new MovementValidationError(
      'invalid_amount',
      `amount debe ser > 0 (recibido ${amount}). Signo deriva del type (withdraw resta, deposit suma).`
    );
  }

  const reason = (input.reason ?? '').trim();
  if (reason.length === 0) {
    throw new MovementValidationError(
      'missing_reason',
      'reason es OBLIGATORIO para TODOS los cash_movements (defensa anti mutable audit, RUNBOOKS/cash-discrepancy).'
    );
  }

  const created_by = ctx.actor_user_id;
  if (!created_by) {
    throw new CrossTenantAccessError(
      'unknown',
      ctx.tenant_id,
      'cash.movement.register: actor_user_id ausente en context (created_by requerido)'
    );
  }

  return {
    cash_session_id: input.cash_session_id,
    type: input.type,
    amount,
    reason,
    created_by,
    correlation_id: ctx.correlation_id ?? null,
  };
}

// ──── Service wrappers (con DB) ────────────────────────────────

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Registra un movimiento manual de caja en una session ACTIVA.
 *
 * **Validaciones:**
 * 1. Input válido (pure helper)
 * 2. cash_session existe + pertenece a tenant actual
 * 3. cash_session NO está cerrada (no se pueden registrar movimientos post-cierre)
 *
 * **NO emite audit_log por movimiento** (ver doc del módulo).
 *
 * @throws MovementValidationError input inválido
 * @throws MovementSessionNotFoundError session no existe / no es del tenant
 * @throws MovementValidationError(session_already_closed) session cerrada
 * @throws CrossTenantAccessError tenant_id ausente
 */
export async function registerCashMovement(
  input: RegisterMovementInput,
  txOrDb: DbOrTransaction = db
): Promise<CashMovement> {
  const ctx = requireTracingContext();
  const tenant_id = ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'cash.movement.register: tenant_id ausente en context'
    );
  }
  const values = prepareRegisterMovementValues(input, ctx);

  const runInTx = async (tx: DbOrTransaction): Promise<CashMovement> => {
    // Validar que la session existe + está en el tenant del context + NO está cerrada.
    // Usamos SELECT (no FOR UPDATE — la session no se mueve, solo verificamos estado).
    const sessionRows = await tx
      .select({
        id: cash_sessions.id,
        tenant_id: cash_sessions.tenant_id,
        closed_at: cash_sessions.closed_at,
      })
      .from(cash_sessions)
      .where(eq(cash_sessions.id, values.cash_session_id))
      .limit(1);

    const session = sessionRows[0];
    if (!session || session.tenant_id !== tenant_id) {
      throw new MovementSessionNotFoundError(values.cash_session_id);
    }
    if (session.closed_at !== null) {
      throw new MovementValidationError(
        'session_already_closed',
        `cash_session ${session.id} ya fue cerrada el ${session.closed_at.toISOString()}. NO se permiten movimientos post-cierre (append-only — abrir nueva session si necesario).`
      );
    }

    const inserted = await tx.insert(cash_movements).values(values).returning();
    if (inserted.length === 0) {
      throw new Error('registerCashMovement: INSERT no devolvió row (esperado .returning())');
    }
    return inserted[0]!;
  };

  if (txOrDb === db) {
    return await db.transaction(runInTx);
  }
  return await runInTx(txOrDb);
}
