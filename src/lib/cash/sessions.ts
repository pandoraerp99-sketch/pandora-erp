/**
 * Cash sessions service — apertura + cierre de turnos de caja.
 * Sprint 4 ROADMAP Cash context (C-OPS-01) + RUNBOOKS/cash-discrepancy.md.
 *
 * **Patrón Sprint 3 (products + stock):** pure helpers + wrappers DB + tx atómica.
 *
 * **UNIQUE partial index garantiza:** solo 1 session abierta por
 * (tenant_id, sale_point). Concurrencia (T-CONC-02) validada por DB nativo —
 * si dos requests intentan abrir simultáneamente, uno gana, el otro recibe
 * duplicate_key_violation → service convierte a `ActiveSessionAlreadyOpenError`.
 *
 * **Cierre con descuadre (F0 simplification):**
 * - Caller pasa BOTH `counted_amount` (cajero contó físicamente) +
 *   `expected_amount` (cuánto debería haber).
 * - Service computa `descuadre = counted - expected`.
 * - F0: comerciante hace cuenta del expected_amount (sin auto-cómputo desde
 *   sales/movements).
 * - F1+ trigger: cuando Sprint 5 Sales context exista, agregar feature flag
 *   `compute_expected_automatically` para auto-calcular desde `cash_movements`
 *   + `sale_payments` cash.
 *
 * **Severidad alerting (Pandora team, no comerciante):**
 * - |descuadre| > DESCUADRE_HIGH_THRESHOLD_ARS = $5000 → S2
 * - |descuadre| ≤ $5000 → S3
 * Reflejado en métrica + audit event (no bloquea cierre).
 *
 * **Eventos audit (catálogo cerrado EVENT-TAXONOMY):**
 * - `cash_session.opened` (info) — siempre al abrir
 * - `cash_session.closed` (info) — al cerrar sin descuadre
 * - `cash_session.closed_with_difference` (warning) — al cerrar con descuadre
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  cash_sessions,
  type CashSession,
  type NewCashSession,
} from '../db/schema/cash_sessions.js';
import { cash_movements } from '../db/schema/cash_movements.js';
import { sale_payments } from '../db/schema/sale_payments.js';
import { DESCUADRE_HIGH_THRESHOLD_ARS } from '../db/schema/_common.js';
import { requireTracingContext } from '../tracing/context.js';
import type { TracingContext } from '../tracing/context.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';
import { isValidUuid } from '../tracing/ids.js';
import { writeAuditLog } from '../audit/audit-writer.js';
import { incrementCounter } from '../observability/metrics.js';

// ──── Errors tipados ────────────────────────────────────────────

export class CashValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_sale_point'
      | 'invalid_initial_amount'
      | 'invalid_counted_amount'
      | 'invalid_expected_amount'
      | 'missing_discrepancy_reason'
      | 'invalid_session_id',
    message: string
  ) {
    super(message);
    this.name = 'CashValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Lanzado cuando se intenta abrir una segunda session para el mismo
 * (tenant_id, sale_point) — UNIQUE partial constraint enforce.
 */
export class ActiveSessionAlreadyOpenError extends Error {
  constructor(public readonly tenant_id: string, public readonly sale_point: number) {
    super(
      `ActiveSessionAlreadyOpenError: ya existe una session de caja abierta para tenant=${tenant_id} sale_point=${sale_point}. Cerrar la anterior antes de abrir una nueva.`
    );
    this.name = 'ActiveSessionAlreadyOpenError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SessionNotFoundError extends Error {
  constructor(public readonly session_id: string) {
    super(`SessionNotFoundError: cash_session ${session_id} no encontrada en tenant actual.`);
    this.name = 'SessionNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SessionAlreadyClosedError extends Error {
  constructor(public readonly session_id: string, public readonly closed_at: Date) {
    super(
      `SessionAlreadyClosedError: cash_session ${session_id} ya fue cerrada el ${closed_at.toISOString()}. NO se re-cierra (append-only — abrir nueva session si necesario).`
    );
    this.name = 'SessionAlreadyClosedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ──── Inputs ────────────────────────────────────────────────────

export interface OpenSessionInput {
  sale_point: number;
  initial_amount: string | number;
  /** Override tenant_id (solo system|support — mismo patrón products/stock). */
  override_tenant_id?: string;
}

export interface CloseSessionInput {
  session_id: string;
  /** Cuánto contó físicamente el cajero al cerrar. */
  counted_amount: string | number;
  /**
   * Cuánto debería haber según la cuenta.
   *
   * **Sprint 5 Bloque 3 (2026-06-09): opcional**. Si no se pasa, el service
   * computa automáticamente desde:
   *
   *   initial_amount
   *   + Σ sale_payments.amount WHERE cash_session_id=X AND method='efectivo'
   *   + Σ cash_movements.amount WHERE type='deposit'
   *   - Σ cash_movements.amount WHERE type='withdraw'
   *   - Σ cash_movements.amount WHERE type='provider_payment'
   *
   * El caller puede pasar override para forzar un valor manual (ej: cuando
   * el cajero reconoce diferencias contables que el sistema no ve, o para
   * casos legacy donde el flow Sales no se está usando).
   */
  expected_amount?: string | number;
  /** Motivo del descuadre. OBLIGATORIO si counted != expected. */
  discrepancy_reason?: string;
}

// ──── Pure helpers (testeables sin DB) ──────────────────────────

/**
 * Valida + normaliza un monto monetario a string scale 4.
 *
 * @throws CashValidationError si negativo, no parseable, o NaN/Infinity
 */
export function normalizeCashAmount(
  raw: string | number,
  field:
    | 'initial_amount'
    | 'counted_amount'
    | 'expected_amount'
): string {
  let num: number;
  if (typeof raw === 'number') {
    num = raw;
  } else {
    const trimmed = raw.trim();
    // Strict regex: dígitos opcional + punto decimal. Reusa el patrón
    // products/stock (no parseFloat lenient).
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new CashValidationError(
        `invalid_${field}` as CashValidationError['code'],
        `${field}: formato numérico inválido "${raw}"`
      );
    }
    num = Number(trimmed);
  }
  if (!Number.isFinite(num)) {
    throw new CashValidationError(
      `invalid_${field}` as CashValidationError['code'],
      `${field}: valor no finito ${num}`
    );
  }
  if (num < 0) {
    throw new CashValidationError(
      `invalid_${field}` as CashValidationError['code'],
      `${field}: no puede ser negativo (recibido ${num})`
    );
  }
  return num.toFixed(4);
}

/**
 * Valida sale_point como entero positivo.
 */
export function validateSalePoint(sp: number): number {
  if (!Number.isInteger(sp) || sp <= 0) {
    throw new CashValidationError(
      'invalid_sale_point',
      `sale_point debe ser entero positivo (recibido ${sp})`
    );
  }
  if (sp > 99999) {
    // Manual COMPG v4.2: PtoVta hasta 5 dígitos. Defensa.
    throw new CashValidationError(
      'invalid_sale_point',
      `sale_point excede límite WSFEv1 (5 dígitos máximo, recibido ${sp})`
    );
  }
  return sp;
}

/**
 * Computa descuadre = counted - expected, en string scale 4.
 * Pure math con escala entera 10000 (evita float drift, mismo patrón
 * stock computeNextStockCurrent).
 *
 * Signo:
 * - descuadre > 0 → "sobrante" (cajero contó MÁS de lo esperado)
 * - descuadre < 0 → "faltante" (cajero contó MENOS de lo esperado)
 * - descuadre = 0 → perfecto
 */
export function computeDescuadre(
  countedAmount: string,
  expectedAmount: string
): string {
  const SCALE = 10000;
  const countedInt = Math.round(parseFloat(countedAmount) * SCALE);
  const expectedInt = Math.round(parseFloat(expectedAmount) * SCALE);
  if (!Number.isFinite(countedInt) || !Number.isFinite(expectedInt)) {
    throw new CashValidationError(
      'invalid_counted_amount',
      `computeDescuadre: inputs no parseables counted="${countedAmount}" expected="${expectedAmount}"`
    );
  }
  const descuadreInt = countedInt - expectedInt;
  return (descuadreInt / SCALE).toFixed(4);
}

export type DescuadreSign = 'positive' | 'negative' | 'zero';

/**
 * Clasifica signo del descuadre — usado como tag de métrica
 * `cash_session.diff.amount` (whitelist scope tenant, allowedValues bounded).
 */
export function classifyDescuadreSign(descuadre: string): DescuadreSign {
  const num = parseFloat(descuadre);
  if (num > 0) return 'positive';
  if (num < 0) return 'negative';
  return 'zero';
}

export type DescuadreSeverityLabel = 'high' | 'low' | 'none';

/**
 * Severidad para alerting Pandora team (NO bloquea cierre, NO afecta UX).
 *
 * - |descuadre| > DESCUADRE_HIGH_THRESHOLD_ARS ($5000) → 'high' (S2)
 * - 0 < |descuadre| ≤ threshold → 'low' (S3)
 * - descuadre = 0 → 'none' (cierre limpio)
 *
 * El audit event y la métrica capturan info para que Pandora team decida
 * investigación post-hoc según OPERATIONAL-SEVERITY.
 */
export function classifyDescuadreSeverity(descuadre: string): DescuadreSeverityLabel {
  const abs = Math.abs(parseFloat(descuadre));
  if (abs === 0) return 'none';
  return abs > parseFloat(DESCUADRE_HIGH_THRESHOLD_ARS) ? 'high' : 'low';
}

/**
 * Prepara los valores del INSERT a cash_sessions (apertura).
 *
 * @throws CashValidationError input inválido
 * @throws CrossTenantAccessError multi-tenant guard fail
 */
export function prepareOpenSessionValues(
  input: OpenSessionInput,
  ctx: TracingContext
): NewCashSession {
  const sale_point = validateSalePoint(input.sale_point);
  const initial_amount = normalizeCashAmount(input.initial_amount, 'initial_amount');

  // Multi-tenant guard (mismo patrón products / stock / audit-writer)
  if (input.override_tenant_id !== undefined) {
    if (!isValidUuid(input.override_tenant_id)) {
      throw new CrossTenantAccessError(
        input.override_tenant_id,
        ctx.tenant_id,
        'cash.session.open.override_tenant_id (UUID format inválido)'
      );
    }
    if (ctx.actor_type !== 'system' && ctx.actor_type !== 'support') {
      throw new CrossTenantAccessError(
        input.override_tenant_id,
        ctx.tenant_id,
        'cash.session.open.override_tenant_id'
      );
    }
  }

  const tenant_id = input.override_tenant_id ?? ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'cash.session.open: tenant_id ausente en context y sin override'
    );
  }

  const opened_by = ctx.actor_user_id;
  if (!opened_by) {
    throw new CashValidationError(
      'invalid_session_id',
      'cash.session.open: actor_user_id ausente en context (opened_by requerido)'
    );
  }

  return {
    tenant_id,
    sale_point,
    opened_by,
    initial_amount,
  };
}

/**
 * Prepara los valores del UPDATE para cerrar una session.
 * Pure helper — recibe la session ya cargada de DB, computa descuadre, valida
 * reason si aplica.
 *
 * @throws CashValidationError si descuadre != 0 sin reason
 * @throws SessionAlreadyClosedError si ya está cerrada
 */
export function prepareCloseSessionUpdate(
  session: CashSession,
  input: CloseSessionInput,
  ctx: TracingContext
): {
  update: {
    closed_by: string;
    closed_at: Date;
    final_amount: string;
    expected_amount: string;
    descuadre: string;
    discrepancy_reason: string | null;
  };
  descuadre_sign: DescuadreSign;
  severity_label: DescuadreSeverityLabel;
} {
  if (session.closed_at !== null) {
    throw new SessionAlreadyClosedError(session.id, session.closed_at);
  }

  const final_amount = normalizeCashAmount(input.counted_amount, 'counted_amount');
  // Sprint 5 Bloque 3 (2026-06-09): expected_amount es opcional en
  // CloseSessionInput. El wrapper `closeCashSession` lo resuelve antes de
  // llamar a este pure helper (auto-compute desde sale_payments +
  // cash_movements si el caller no lo pasa). Si llega undefined acá es
  // bug del caller — guard explícito.
  if (input.expected_amount === undefined) {
    throw new CashValidationError(
      'invalid_expected_amount',
      'prepareCloseSessionUpdate: expected_amount debe estar resuelto antes de invocar este helper (responsabilidad del wrapper closeCashSession).'
    );
  }
  const expected_amount = normalizeCashAmount(input.expected_amount, 'expected_amount');
  const descuadre = computeDescuadre(final_amount, expected_amount);
  const descuadre_sign = classifyDescuadreSign(descuadre);
  const severity_label = classifyDescuadreSeverity(descuadre);

  // Descuadre != 0 → discrepancy_reason obligatorio (RUNBOOKS/cash-discrepancy).
  let discrepancy_reason: string | null = null;
  if (descuadre_sign !== 'zero') {
    const trimmed = (input.discrepancy_reason ?? '').trim();
    if (trimmed.length === 0) {
      throw new CashValidationError(
        'missing_discrepancy_reason',
        `cash.session.close: descuadre=${descuadre} requiere discrepancy_reason no vacío (RUNBOOKS/cash-discrepancy.md). Severidad esperada: ${severity_label}.`
      );
    }
    discrepancy_reason = trimmed;
  } else if (input.discrepancy_reason !== undefined) {
    // Cierre limpio (descuadre=0) pero caller pasó reason — ignorar
    // (no es error). Reason solo aplica si hay descuadre.
    discrepancy_reason = null;
  }

  const closed_by = ctx.actor_user_id;
  if (!closed_by) {
    throw new CashValidationError(
      'invalid_session_id',
      'cash.session.close: actor_user_id ausente en context (closed_by requerido)'
    );
  }

  return {
    update: {
      closed_by,
      closed_at: new Date(),
      final_amount,
      expected_amount,
      descuadre,
      discrepancy_reason,
    },
    descuadre_sign,
    severity_label,
  };
}

// ──── Service wrappers (con DB) ────────────────────────────────

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Abre una nueva session de caja para (tenant, sale_point).
 *
 * **Atomicidad:** INSERT + audit_log emit en MISMA tx.
 * **Concurrencia:** UNIQUE partial index garantiza que solo 1 session abierta
 * por (tenant, sale_point). Si dos requests concurrentes → uno gana, el otro
 * recibe duplicate_key_violation que el service convierte a
 * `ActiveSessionAlreadyOpenError`.
 *
 * @throws CashValidationError input inválido
 * @throws CrossTenantAccessError multi-tenant guard fail
 * @throws ActiveSessionAlreadyOpenError ya hay session abierta para (tenant, sale_point)
 */
export async function openCashSession(
  input: OpenSessionInput,
  txOrDb: DbOrTransaction = db
): Promise<CashSession> {
  const ctx = requireTracingContext();
  const values = prepareOpenSessionValues(input, ctx);

  const runInTx = async (tx: DbOrTransaction): Promise<CashSession> => {
    let inserted: CashSession;
    try {
      const rows = await tx.insert(cash_sessions).values(values).returning();
      if (rows.length === 0) {
        throw new Error('openCashSession: INSERT no devolvió row (esperado .returning())');
      }
      inserted = rows[0]!;
    } catch (e) {
      // Postgres ERRCODE 23505 = unique_violation.
      // Drizzle envuelve PgError en wrapper con .cause.
      const pgCode = extractPgErrorCode(e);
      if (pgCode === '23505') {
        throw new ActiveSessionAlreadyOpenError(values.tenant_id, values.sale_point);
      }
      throw e;
    }

    // Audit emit (mismo tx — rollback atómico si audit falla)
    await writeAuditLog(
      {
        event_name: 'cash_session.opened',
        payload: {
          session_id: inserted.id,
          sale_point: inserted.sale_point,
          initial_amount: inserted.initial_amount,
        },
        pii_level: 'internal',
        severity: 'info',
        ...(input.override_tenant_id !== undefined && {
          override_tenant_id: input.override_tenant_id,
        }),
      },
      tx
    );

    return inserted;
  };

  if (txOrDb === db) {
    return await db.transaction(runInTx);
  }
  return await runInTx(txOrDb);
}

export interface CloseSessionResult {
  session: CashSession;
  descuadre: string;
  descuadre_sign: DescuadreSign;
  severity_label: DescuadreSeverityLabel;
}

/**
 * Cierra una session de caja con conciliación (counted vs expected).
 *
 * **Atomicidad:** SELECT FOR UPDATE + UPDATE + audit + métrica en MISMA tx.
 * **Multi-tenant:** session debe pertenecer al tenant del context (filtra WHERE).
 * **NO bloquea cierre con descuadre** (RUNBOOKS/cash-discrepancy.md): si hay
 * descuadre + reason válido → cierra OK + emite warning event + incrementa
 * métrica con sign correspondiente.
 *
 * @throws CashValidationError input inválido (incl descuadre != 0 sin reason)
 * @throws SessionNotFoundError session no existe en tenant actual
 * @throws SessionAlreadyClosedError session ya cerrada
 * @throws CrossTenantAccessError multi-tenant guard fail
 */
export async function closeCashSession(
  input: CloseSessionInput,
  txOrDb: DbOrTransaction = db
): Promise<CloseSessionResult> {
  if (!isValidUuid(input.session_id)) {
    throw new CashValidationError(
      'invalid_session_id',
      `closeCashSession: session_id no es UUID válido ("${input.session_id}")`
    );
  }
  const ctx = requireTracingContext();
  const tenant_id = ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'cash.session.close: tenant_id ausente en context'
    );
  }

  const runInTx = async (tx: DbOrTransaction): Promise<CloseSessionResult> => {
    // SELECT FOR UPDATE — lock pesimista para evitar double-close concurrente.
    const lockedRows = await tx
      .select()
      .from(cash_sessions)
      .where(
        and(eq(cash_sessions.id, input.session_id), eq(cash_sessions.tenant_id, tenant_id))
      )
      .for('update')
      .limit(1);

    const session = lockedRows[0];
    if (!session) {
      throw new SessionNotFoundError(input.session_id);
    }

    // Sprint 5 Bloque 3 (2026-06-09): si caller no pasa expected_amount,
    // auto-compute desde sale_payments (efectivo) + cash_movements del session.
    // Esto integra el flow Sales↔Cash: el cajero solo cuenta físicamente
    // (counted_amount), el sistema computa lo esperado.
    const resolvedExpectedAmount =
      input.expected_amount !== undefined
        ? input.expected_amount
        : await computeExpectedAmountFromActivity(
            tx,
            session.id,
            session.tenant_id,
            session.initial_amount
          );

    const { update, descuadre_sign, severity_label } = prepareCloseSessionUpdate(
      session,
      { ...input, expected_amount: resolvedExpectedAmount },
      ctx
    );

    const updatedRows = await tx
      .update(cash_sessions)
      .set({ ...update, updated_at: sql`now()` })
      .where(
        and(eq(cash_sessions.id, input.session_id), eq(cash_sessions.tenant_id, tenant_id))
      )
      .returning();

    if (updatedRows.length === 0) {
      throw new Error('closeCashSession: UPDATE no devolvió row (race condition?)');
    }
    const closed_session = updatedRows[0]!;

    // Audit emit con event_name según descuadre.
    const event_name =
      descuadre_sign === 'zero'
        ? 'cash_session.closed'
        : 'cash_session.closed_with_difference';
    const severity = descuadre_sign === 'zero' ? 'info' : 'warning';

    await writeAuditLog(
      {
        event_name,
        payload: {
          session_id: closed_session.id,
          sale_point: closed_session.sale_point,
          opened_at: session.opened_at.toISOString(),
          initial_amount: closed_session.initial_amount,
          final_amount: closed_session.final_amount,
          expected_amount: closed_session.expected_amount,
          descuadre: closed_session.descuadre,
          descuadre_sign,
          severity_label,
          discrepancy_reason: closed_session.discrepancy_reason,
        },
        pii_level: 'internal',
        severity,
      },
      tx
    );

    // Métrica: incrementa contador con tag sign. NO bloquea cierre si falla
    // (incrementCounter es fail-open per Sprint 2 #5).
    await incrementCounter(
      'cash_session.diff.amount',
      { tag: { key: 'sign', value: descuadre_sign } },
      tx
    );

    return {
      session: closed_session,
      descuadre: closed_session.descuadre!,
      descuadre_sign,
      severity_label,
    };
  };

  if (txOrDb === db) {
    return await db.transaction(runInTx);
  }
  return await runInTx(txOrDb);
}

/**
 * Devuelve la session activa (no cerrada) para (tenant del context, sale_point).
 * Retorna null si no hay session abierta.
 */
export async function getActiveCashSession(
  sale_point: number,
  txOrDb: DbOrTransaction = db
): Promise<CashSession | null> {
  validateSalePoint(sale_point);
  const ctx = requireTracingContext();
  const tenant_id = ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'cash.session.getActive: tenant_id ausente en context'
    );
  }

  const rows = await txOrDb
    .select()
    .from(cash_sessions)
    .where(
      and(
        eq(cash_sessions.tenant_id, tenant_id),
        eq(cash_sessions.sale_point, sale_point),
        isNull(cash_sessions.closed_at)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Busca una cash_session por id verificando que pertenezca al tenant del context.
 * Retorna null si no existe en el tenant actual (no distingue "no existe" de
 * "existe en otro tenant" — patrón Sprint 3 findProductById).
 */
export async function getCashSessionById(
  session_id: string,
  txOrDb: DbOrTransaction = db
): Promise<CashSession | null> {
  if (!isValidUuid(session_id)) {
    throw new CashValidationError(
      'invalid_session_id',
      `getCashSessionById: session_id no es UUID válido ("${session_id}")`
    );
  }
  const ctx = requireTracingContext();
  const tenant_id = ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'cash.session.getById: tenant_id ausente en context'
    );
  }

  const rows = await txOrDb
    .select()
    .from(cash_sessions)
    .where(and(eq(cash_sessions.id, session_id), eq(cash_sessions.tenant_id, tenant_id)))
    .limit(1);
  return rows[0] ?? null;
}

// ──── Helper interno ───────────────────────────────────────────

/**
 * Sprint 5 Bloque 3 — auto-compute de `expected_amount` desde la actividad
 * de la session (sale_payments efectivo + cash_movements).
 *
 * Fórmula:
 *   expected = initial
 *            + Σ sale_payments.amount WHERE cash_session_id=X AND method='efectivo'
 *            + Σ cash_movements.amount WHERE cash_session_id=X AND type='deposit'
 *            - Σ cash_movements.amount WHERE cash_session_id=X AND type='withdraw'
 *            - Σ cash_movements.amount WHERE cash_session_id=X AND type='provider_payment'
 *
 * Escala entera 10000 (mismo patrón computeDescuadre + computeMovementTotals)
 * para evitar float drift acumulado.
 *
 * **F0:** queries simples SUM por scope (session). Performance OK para retail
 * (decenas-centenas de payments/movements por session). F1+ trigger: rollup
 * incremental si una session acumula > 1000 rows.
 */
async function computeExpectedAmountFromActivity(
  tx: DbOrTransaction,
  session_id: string,
  tenant_id: string,
  initial_amount: string
): Promise<string> {
  const SCALE = 10000;
  const initialInt = Math.round(parseFloat(initial_amount) * SCALE);
  if (!Number.isFinite(initialInt)) {
    throw new CashValidationError(
      'invalid_expected_amount',
      `computeExpectedAmountFromActivity: initial_amount no parseable "${initial_amount}"`
    );
  }

  // SUM sale_payments con method=efectivo (otros methods no afectan caja).
  // tenant_id filter es defense-in-depth (cash_session_id ya es por scope).
  const cashSaleRows = await tx
    .select({
      total: sql<string>`COALESCE(SUM(${sale_payments.amount}), 0)`,
    })
    .from(sale_payments)
    .where(
      and(
        eq(sale_payments.tenant_id, tenant_id),
        eq(sale_payments.cash_session_id, session_id),
        eq(sale_payments.method, 'efectivo')
      )
    );
  const cashSalesInt = Math.round(parseFloat(cashSaleRows[0]?.total ?? '0') * SCALE);

  // SUM cash_movements agrupado por type. 1 query con GROUP BY (3 rows max).
  const movementRows = await tx
    .select({
      type: cash_movements.type,
      total: sql<string>`COALESCE(SUM(${cash_movements.amount}), 0)`,
    })
    .from(cash_movements)
    .where(eq(cash_movements.cash_session_id, session_id))
    .groupBy(cash_movements.type);

  let depositsInt = 0;
  let withdrawsInt = 0;
  let providerPaymentsInt = 0;
  for (const row of movementRows) {
    const amountInt = Math.round(parseFloat(row.total) * SCALE);
    if (!Number.isFinite(amountInt)) continue;
    if (row.type === 'deposit') depositsInt = amountInt;
    else if (row.type === 'withdraw') withdrawsInt = amountInt;
    else if (row.type === 'provider_payment') providerPaymentsInt = amountInt;
    // type fuera del enum: ignorado (CHECK constraint debería prevenirlo).
  }

  const expectedInt =
    initialInt + cashSalesInt + depositsInt - withdrawsInt - providerPaymentsInt;
  return (expectedInt / SCALE).toFixed(4);
}

/**
 * Extrae el código Postgres del error envuelto por Drizzle.
 * Drizzle envuelve PgError en wrapper con `.cause`. El código vive en
 * `cause.code` (ej: '23505' = unique_violation).
 */
function extractPgErrorCode(e: unknown): string | undefined {
  if (e && typeof e === 'object') {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
  return undefined;
}
