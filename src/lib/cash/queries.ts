/**
 * Cash queries — read-only para POS UI + dashboards + reports.
 * Sprint 4 ROADMAP Cash context (C-OPS-01) + BOUNDED-CONTEXTS Cash.
 *
 * **Multi-tenant guard:** todos los wrappers leen `tenant_id` del context.
 * NO emit audit_log (lecturas no se auditan F0 — CLAUDE.md §16.9).
 *
 * **getSessionSummary:** consolida session + movimientos manuales + agregados
 * (sum withdraws, sum deposits, sum provider_payments). NO incluye ventas
 * (eso es Sprint 5 Sales context — `expected_amount` lo computa el caller con
 * los datos disponibles).
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  cash_sessions,
  type CashSession,
} from '../db/schema/cash_sessions.js';
import {
  cash_movements,
  type CashMovement,
} from '../db/schema/cash_movements.js';
import { requireTracingContext } from '../tracing/context.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';
import { isValidUuid } from '../tracing/ids.js';
import { CashValidationError } from './sessions.js';

// ──── Tipos del summary ────────────────────────────────────────

export interface CashSessionSummary {
  session: CashSession;
  movements: CashMovement[];
  totals: {
    /** Suma de `amount` con type='deposit'. */
    total_deposits: string;
    /** Suma de `amount` con type='withdraw'. */
    total_withdraws: string;
    /** Suma de `amount` con type='provider_payment'. */
    total_provider_payments: string;
    /**
     * Saldo esperado en caja basado en initial_amount + movements
     * (NO incluye ventas — Sprint 5).
     * Fórmula: `initial_amount + total_deposits - total_withdraws - total_provider_payments`.
     */
    expected_from_movements: string;
  };
}

// ──── Service wrappers (con DB) ────────────────────────────────

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function requireTenantId(): string {
  const ctx = requireTracingContext();
  const tenant_id = ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'cash.query: tenant_id ausente en context'
    );
  }
  return tenant_id;
}

/**
 * Devuelve session + todos sus movimientos manuales + agregados por type.
 *
 * Usado por:
 * - POS UI (mostrar resumen "tu caja hoy" antes del cierre)
 * - RUNBOOKS/cash-discrepancy.md paso 2 (revisar movimientos manuales)
 * - Reports contador (Sprint 5+ via Reporting context)
 *
 * @throws CashValidationError session_id no UUID
 * @throws CrossTenantAccessError tenant ausente
 */
export async function getCashSessionSummary(
  session_id: string,
  txOrDb: DbOrTransaction = db
): Promise<CashSessionSummary | null> {
  if (!isValidUuid(session_id)) {
    throw new CashValidationError(
      'invalid_session_id',
      `getCashSessionSummary: session_id no es UUID válido ("${session_id}")`
    );
  }
  const tenant_id = requireTenantId();

  // 1. Session (con multi-tenant filter)
  const sessionRows = await txOrDb
    .select()
    .from(cash_sessions)
    .where(and(eq(cash_sessions.id, session_id), eq(cash_sessions.tenant_id, tenant_id)))
    .limit(1);

  const session = sessionRows[0];
  if (!session) return null;

  // 2. Movimientos manuales ordenados cronológicamente
  const movements = await txOrDb
    .select()
    .from(cash_movements)
    .where(eq(cash_movements.cash_session_id, session_id))
    .orderBy(asc(cash_movements.created_at));

  // 3. Agregados por type. Computados en TS para flexibilidad y testeabilidad.
  // Para sessions con miles de movimientos (improbable F0), migrar a query
  // SQL con SUM + GROUP BY.
  const totals = computeMovementTotals(session.initial_amount, movements);

  return { session, movements, totals };
}

/**
 * Pure helper — computa agregados de movimientos manuales.
 * Exportado para testing directo sin DB.
 *
 * **Escala entera 10000 (mismo patrón computeDescuadre + computeNextStockCurrent):**
 * evita float drift acumulado al sumar muchos decimales.
 */
export function computeMovementTotals(
  initial_amount: string,
  movements: ReadonlyArray<Pick<CashMovement, 'type' | 'amount'>>
): CashSessionSummary['totals'] {
  const SCALE = 10000;
  let depositsInt = 0;
  let withdrawsInt = 0;
  let providerPaymentsInt = 0;

  for (const m of movements) {
    const amountInt = Math.round(parseFloat(m.amount) * SCALE);
    if (!Number.isFinite(amountInt)) continue; // skip rows corruptas (defense, no debería pasar — CHECK constraint)
    if (m.type === 'deposit') depositsInt += amountInt;
    else if (m.type === 'withdraw') withdrawsInt += amountInt;
    else if (m.type === 'provider_payment') providerPaymentsInt += amountInt;
    // Default: type desconocido → ignorar (defense — CHECK constraint debería prevenirlo)
  }

  const initialInt = Math.round(parseFloat(initial_amount) * SCALE);
  const expectedInt =
    initialInt + depositsInt - withdrawsInt - providerPaymentsInt;

  return {
    total_deposits: (depositsInt / SCALE).toFixed(4),
    total_withdraws: (withdrawsInt / SCALE).toFixed(4),
    total_provider_payments: (providerPaymentsInt / SCALE).toFixed(4),
    expected_from_movements: (expectedInt / SCALE).toFixed(4),
  };
}

/**
 * Lista sessions del tenant (paginada). Default ordenado por opened_at DESC
 * (más reciente primero, típico para dashboard comerciante).
 */
export interface ListSessionsOptions {
  limit?: number;
  offset?: number;
  /** Si true, solo sessions abiertas. Si false (default), todas. */
  active_only?: boolean;
}

export async function listCashSessions(
  options: ListSessionsOptions = {},
  txOrDb: DbOrTransaction = db
): Promise<CashSession[]> {
  // Validar args ANTES de requireTenantId — input validation no debería
  // depender de context inicializado (advisor 2026-06-04 #3: orden importa
  // para tests determinísticos + para callers que validan args sin context).
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new CashValidationError(
      'invalid_session_id',
      `listCashSessions: limit debe ser entero 1-500 (recibido ${limit})`
    );
  }
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new CashValidationError(
      'invalid_session_id',
      `listCashSessions: offset debe ser entero >= 0 (recibido ${offset})`
    );
  }
  const tenant_id = requireTenantId();

  const whereConditions = options.active_only
    ? and(eq(cash_sessions.tenant_id, tenant_id), sql`${cash_sessions.closed_at} IS NULL`)
    : eq(cash_sessions.tenant_id, tenant_id);

  const rows = await txOrDb
    .select()
    .from(cash_sessions)
    .where(whereConditions)
    .orderBy(sql`${cash_sessions.opened_at} DESC`)
    .limit(limit)
    .offset(offset);
  return rows;
}
