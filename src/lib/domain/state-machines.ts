/**
 * State machines puras — sin DB, sin side effects.
 * CLAUDE.md §12.
 *
 * Cada transicion permitida esta declarada explicita.
 * Transicion no permitida = StateTransitionError.
 *
 * Esta capa NO escribe; los services llaman estas funciones para validar
 * y despues hacen UPDATE + audit_log dentro de transaccion.
 */
import {
  COMMERCIAL_STATUSES,
  FISCAL_STATUSES,
  type CommercialStatus,
  type FiscalStatus,
} from '../db/schema/_common.js';
import { StateTransitionError } from '../multi_tenant/errors.js';

const COMMERCIAL_TRANSITIONS: Record<CommercialStatus, ReadonlyArray<CommercialStatus>> = {
  draft: ['in_progress', 'cancelada'],
  in_progress: ['cobrando', 'cancelada'],
  cobrando: ['cobrada', 'cancelada'],
  cobrada: ['terminada', 'cancelada'],
  terminada: [],
  cancelada: [],
};

const FISCAL_TRANSITIONS: Record<FiscalStatus, ReadonlyArray<FiscalStatus>> = {
  not_required: [],

  pending: ['requesting'],
  requesting: ['issued', 'requires_reconciliation', 'failed', 'contingency'],

  requires_reconciliation: [
    'requires_reconciliation',
    'reconciled_issued',
    'number_burned',
    'manual_resolution_required',
  ],

  contingency: ['issued', 'manual_resolution_required'],

  failed: ['manual_resolution_required'],
  number_burned: ['manual_resolution_required'],

  issued: [],
  reconciled_issued: [],
  manual_resolution_required: [],
};

const TERMINAL_FISCAL: ReadonlySet<FiscalStatus> = new Set([
  'not_required',
  'issued',
  'reconciled_issued',
  'manual_resolution_required',
]);

const TERMINAL_COMMERCIAL: ReadonlySet<CommercialStatus> = new Set([
  'terminada',
  'cancelada',
]);

export function canTransitionCommercial(
  from: CommercialStatus,
  to: CommercialStatus
): boolean {
  const allowed = COMMERCIAL_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

export function canTransitionFiscal(from: FiscalStatus, to: FiscalStatus): boolean {
  const allowed = FISCAL_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

export function isCommercialTerminal(status: CommercialStatus): boolean {
  return TERMINAL_COMMERCIAL.has(status);
}

export function isFiscalTerminal(status: FiscalStatus): boolean {
  return TERMINAL_FISCAL.has(status);
}

export function assertCommercialTransition(
  from: CommercialStatus,
  to: CommercialStatus
): void {
  if (!canTransitionCommercial(from, to)) {
    throw new StateTransitionError('sale.commercial_status', from, to);
  }
}

export function assertFiscalTransition(from: FiscalStatus, to: FiscalStatus): void {
  if (!canTransitionFiscal(from, to)) {
    throw new StateTransitionError('sale.fiscal_status', from, to);
  }
}

export function listAllowedCommercialTransitions(
  from: CommercialStatus
): ReadonlyArray<CommercialStatus> {
  return COMMERCIAL_TRANSITIONS[from] ?? [];
}

export function listAllowedFiscalTransitions(
  from: FiscalStatus
): ReadonlyArray<FiscalStatus> {
  return FISCAL_TRANSITIONS[from] ?? [];
}

export {
  COMMERCIAL_STATUSES,
  FISCAL_STATUSES,
  type CommercialStatus,
  type FiscalStatus,
};
