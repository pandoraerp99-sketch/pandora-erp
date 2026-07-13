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
import { DomainError, ValidationError } from '@/lib/multi_tenant/errors';
import { openCashSession, closeCashSession } from '@/lib/cash/sessions';
import { registerCashMovement } from '@/lib/cash/movements';
import { reclassifySalePaymentMethod } from '@/lib/cash/reclassify';
import type { CashMovementType, SalePaymentMethod } from '@/lib/db/schema/_common';

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

/** Registra un movimiento manual de caja (ingreso / retiro / pago a proveedor). */
export async function registerMovementAction(input: {
  sessionId: string;
  type: CashMovementType;
  amount: string;
  reason: string;
}): Promise<ActionResult<Awaited<ReturnType<typeof registerCashMovement>>>> {
  return runAction(() =>
    registerCashMovement({
      cash_session_id: input.sessionId,
      type: input.type,
      amount: input.amount,
      reason: input.reason,
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
