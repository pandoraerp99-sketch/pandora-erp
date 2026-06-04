/**
 * Cash bounded context — Public API barrel.
 * Sprint 4 ROADMAP Cash context cierre.
 *
 * **Consumers** (Sales context Sprint 5, POS UI Sprint 8+, Server Actions):
 * importan SOLO desde `@/lib/cash`, NUNCA directo a submódulos.
 *
 * **Reglas BOUNDED-CONTEXTS.md:**
 * - Cross-context imports usan SOLO esta superficie pública.
 * - Internos del módulo (extractPgErrorCode helper, etc.) NO se exponen.
 * - Cambios a esta superficie requieren actualizar callers + tests.
 */

// ──── Sessions ─────────────────────────────────────────────────
export {
  openCashSession,
  closeCashSession,
  getActiveCashSession,
  getCashSessionById,
  prepareOpenSessionValues,
  prepareCloseSessionUpdate,
  normalizeCashAmount,
  validateSalePoint,
  computeDescuadre,
  classifyDescuadreSign,
  classifyDescuadreSeverity,
  CashValidationError,
  ActiveSessionAlreadyOpenError,
  SessionNotFoundError,
  SessionAlreadyClosedError,
} from './sessions.js';
export type {
  OpenSessionInput,
  CloseSessionInput,
  CloseSessionResult,
  DescuadreSign,
  DescuadreSeverityLabel,
} from './sessions.js';

// ──── Movements ────────────────────────────────────────────────
export {
  registerCashMovement,
  prepareRegisterMovementValues,
  MovementValidationError,
  MovementSessionNotFoundError,
} from './movements.js';
export type { RegisterMovementInput } from './movements.js';

// ──── Queries ──────────────────────────────────────────────────
export {
  getCashSessionSummary,
  listCashSessions,
  computeMovementTotals,
} from './queries.js';
export type {
  CashSessionSummary,
  ListSessionsOptions,
} from './queries.js';

// ──── Re-export tipos schema usados en superficie pública ─────
export type { CashSession } from '../db/schema/cash_sessions.js';
export type { CashMovement } from '../db/schema/cash_movements.js';
export {
  CASH_MOVEMENT_TYPES,
  DESCUADRE_HIGH_THRESHOLD_ARS,
} from '../db/schema/_common.js';
export type { CashMovementType } from '../db/schema/_common.js';
