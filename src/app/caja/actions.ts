'use server';

/**
 * Server Actions de la Caja (port slice 3): abrir sesión, registrar movimiento
 * manual (alivio) y cerrar con descuadre. Wireadas al dominio de caja YA existente
 * y testeado (src/lib/cash: openCashSession / registerCashMovement / closeCashSession).
 *
 * Mismo patrón que src/app/pos/actions.ts: cada action corre dentro de
 * `withServerActionTracing({ requireAuth: true })` (monta tenant_id + actor) y
 * envuelve el resultado en `{ ok, data } | { ok, error }`.
 *
 * Los errores del dominio caja (src/lib/cash) extienden `Error` (no DomainError),
 * así que los mapeamos por `name` al envelope legible en vez de dejar que propaguen.
 */
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { requireSessionWithCompany } from '@/lib/auth/session';
import { DomainError, ValidationError } from '@/lib/multi_tenant/errors';
import { openCashSession, closeCashSession } from '@/lib/cash/sessions';
import { registerCashMovement } from '@/lib/cash/movements';
import { markReliefsPickedUp, registerRelief } from '@/lib/cash/reliefs';
import { reclassifySalePaymentMethod } from '@/lib/cash/reclassify';
import {
  createWithdrawalReason,
  updateWithdrawalReason,
  deactivateWithdrawalReason,
} from '@/lib/cash/reasons';
import {
  createTercero,
  updateTercero,
  deactivateTercero,
} from '@/lib/cash/terceros';
import type {
  BeneficiarioTipo,
  CashMovementType,
  SalePaymentMethod,
  TerceroType,
} from '@/lib/db/schema/_common';

// F0: un único punto de venta (Caja 1), igual que page.tsx / el POS.
const SALE_POINT = 1;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

const CASH_ERROR_NAMES = new Set([
  'CashValidationError',
  'ActiveSessionAlreadyOpenError',
  'SessionNotFoundError',
  'SessionAlreadyClosedError',
  'MovementValidationError',
  'MovementSessionNotFoundError',
  'ReclassifyValidationError',
  'ReasonValidationError',
  'ReasonAuthorizationError',
  'TerceroValidationError',
  'TerceroAuthorizationError',
]);

async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await withServerActionTracing(fn, { requireAuth: true });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ValidationError || e instanceof DomainError) {
      return { ok: false, error: e.messageEs, code: e.code };
    }
    if (e instanceof Error && CASH_ERROR_NAMES.has(e.name)) {
      const code = (e as { code?: string }).code ?? e.name;
      return { ok: false, error: e.message, code };
    }
    throw e;
  }
}

/** Abre la caja del punto de venta con el fondo inicial. */
export async function openSessionAction(input: {
  initialAmount: string;
}): Promise<ActionResult<Awaited<ReturnType<typeof openCashSession>>>> {
  return runAction(() =>
    openCashSession({ sale_point: SALE_POINT, initial_amount: input.initialAmount })
  );
}

/** Registra un movimiento manual de caja (ingreso / alivio / retiro-gasto). */
export async function registerMovementAction(input: {
  sessionId: string;
  type: CashMovementType;
  amount: string;
  reason: string;
  // Egreso estructurado (retiro/gasto): concepto + beneficiario + notas.
  conceptId?: string | null;
  payeeId?: string | null;
  payeeType?: string | null;
  payeeName?: string | null;
  notes?: string | null;
}): Promise<ActionResult<Awaited<ReturnType<typeof registerCashMovement>>>> {
  return runAction(() =>
    registerCashMovement({
      cash_session_id: input.sessionId,
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      concept_id: input.conceptId ?? null,
      payee_id: input.payeeId ?? null,
      payee_type: input.payeeType ?? null,
      payee_name: input.payeeName ?? null,
      notes: input.notes ?? null,
    })
  );
}

/**
 * Cierra la caja. El esperado lo auto-computa el service (fondo + ventas efectivo
 * + movimientos); el descuadre = contado − esperado. `discrepancyReason` es
 * obligatorio si hay descuadre.
 */
export async function closeSessionAction(input: {
  sessionId: string;
  countedAmount: string;
  discrepancyReason?: string;
}): Promise<ActionResult<Awaited<ReturnType<typeof closeCashSession>>>> {
  return runAction(() =>
    closeCashSession({
      session_id: input.sessionId,
      counted_amount: input.countedAmount,
      discrepancy_reason: input.discrepancyReason,
    })
  );
}

/**
 * Corrige el medio de pago de una venta mal clasificada (ADR-0026, append-only).
 * Scope F0: venta de un solo pago, en la sesión de caja abierta. El cierre re-deriva
 * el efectivo excluyendo la fila corregida → cierra el descuadre igual-y-opuesto.
 */
export async function reclassifyPaymentAction(input: {
  saleId: string;
  newMethod: SalePaymentMethod;
  reason: string;
}): Promise<ActionResult<Awaited<ReturnType<typeof reclassifySalePaymentMethod>>>> {
  return runAction(() =>
    reclassifySalePaymentMethod({
      sale_id: input.saleId,
      new_method: input.newMethod,
      reason: input.reason,
    })
  );
}

// ── Catálogo de motivos de retiro (administra SOLO el dueño) ──────────────
// El gate owner-only se enforcea en el dominio (assertOwner con el rol de la
// sesión). El cajero NO puede crear/renombrar/desactivar motivos.

/** Crea un motivo de retiro (solo dueño). */
export async function createReasonAction(input: {
  label: string;
  beneficiarioTipo?: BeneficiarioTipo;
}): Promise<ActionResult<Awaited<ReturnType<typeof createWithdrawalReason>>>> {
  return runAction(async () => {
    const session = await requireSessionWithCompany();
    return createWithdrawalReason(
      { label: input.label, beneficiario_tipo: input.beneficiarioTipo },
      session.app_role
    );
  });
}

/** Renombra un motivo / cambia su tipo de beneficiario (solo dueño). */
export async function updateReasonAction(input: {
  id: string;
  label: string;
  beneficiarioTipo?: BeneficiarioTipo;
}): Promise<ActionResult<Awaited<ReturnType<typeof updateWithdrawalReason>>>> {
  return runAction(async () => {
    const session = await requireSessionWithCompany();
    return updateWithdrawalReason(
      { id: input.id, label: input.label, beneficiario_tipo: input.beneficiarioTipo },
      session.app_role
    );
  });
}

/** Da de baja (lógica) un motivo de retiro (solo dueño). */
export async function deactivateReasonAction(input: {
  id: string;
}): Promise<ActionResult<Awaited<ReturnType<typeof deactivateWithdrawalReason>>>> {
  return runAction(async () => {
    const session = await requireSessionWithCompany();
    return deactivateWithdrawalReason({ id: input.id }, session.app_role);
  });
}

// ── Catálogo de terceros / beneficiarios (administra SOLO el dueño) ────────

/** Crea un beneficiario (empleado / proveedor) — solo dueño. */
export async function createTerceroAction(input: {
  type: TerceroType;
  name: string;
  doc?: string | null;
}): Promise<ActionResult<Awaited<ReturnType<typeof createTercero>>>> {
  return runAction(async () => {
    const session = await requireSessionWithCompany();
    return createTercero({ type: input.type, name: input.name, doc: input.doc }, session.app_role);
  });
}

/** Renombra / edita doc de un beneficiario — solo dueño. */
export async function updateTerceroAction(input: {
  id: string;
  name: string;
  doc?: string | null;
}): Promise<ActionResult<Awaited<ReturnType<typeof updateTercero>>>> {
  return runAction(async () => {
    const session = await requireSessionWithCompany();
    return updateTercero({ id: input.id, name: input.name, doc: input.doc }, session.app_role);
  });
}

/** Da de baja (lógica) un beneficiario — solo dueño. */
export async function deactivateTerceroAction(input: {
  id: string;
}): Promise<ActionResult<Awaited<ReturnType<typeof deactivateTercero>>>> {
  return runAction(async () => {
    const session = await requireSessionWithCompany();
    return deactivateTercero({ id: input.id }, session.app_role);
  });
}

/**
 * Alivio de caja (migration 0044): el retiro y su marca de alivio en una
 * transacción. La clave de idempotencia la genera el modal al abrirse: un
 * doble click no saca dos veces la plata.
 */
export async function registrarAlivioAction(input: {
  sessionId: string;
  amount: string;
  note: string | null;
  idempotencyKey: string;
}): Promise<ActionResult<{ relief_id: string }>> {
  return runAction(async () => {
    const r = await registerRelief(
      { cash_session_id: input.sessionId, amount: input.amount, note: input.note },
      input.idempotencyKey
    );
    return { relief_id: r.relief_id };
  });
}

/** "Marcar retirados": sólo la dueña (lo decide el service). */
export async function marcarRetiradosAction(ids: string[]): Promise<ActionResult<{ marcados: number }>> {
  return runAction(() => markReliefsPickedUp(Array.isArray(ids) ? ids.map(String) : []));
}
