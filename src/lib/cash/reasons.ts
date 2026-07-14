/**
 * Catálogo de motivos de retiro/gasto de caja (cash_withdrawal_reasons).
 *
 * El cajero elige un motivo al registrar un retiro/gasto; el DUEÑO administra la
 * lista. El gate owner-only se enforcea acá (dominio) además de en la action:
 * las funciones mutadoras reciben el `actorRole` (de la sesión) y rechazan a
 * cualquiera que no sea 'owner' — así el boundary es testeable directamente.
 * "únicamente el dueño" excluye admin (decisión explícita del owner 2026-07-13).
 *
 * Baja lógica (is_active=false): el motivo se oculta del picker pero NUNCA se
 * borra; los movimientos históricos guardan el motivo como texto (reason snapshot).
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  cash_withdrawal_reasons,
  type CashWithdrawalReason,
} from '../db/schema/cash_withdrawal_reasons.js';
import { BENEFICIARIO_TIPOS, type BeneficiarioTipo, type UserRole } from '../db/schema/_common.js';
import { requireTracingContext } from '../tracing/context.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';
import { isValidUuid } from '../tracing/ids.js';

const LABEL_MAX_LEN = 60;

export type ReasonErrorCode =
  | 'invalid_label'
  | 'label_too_long'
  | 'invalid_id'
  | 'invalid_beneficiario_tipo'
  | 'reason_not_found';

export class ReasonValidationError extends Error {
  constructor(
    public readonly code: ReasonErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ReasonValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ReasonAuthorizationError extends Error {
  constructor(message = 'Solo el dueño puede administrar los motivos de retiro.') {
    super(message);
    this.name = 'ReasonAuthorizationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Gate: solo el dueño administra el catálogo. Testeable en aislamiento. */
export function assertOwner(role: UserRole | null | undefined): void {
  if (role !== 'owner') {
    throw new ReasonAuthorizationError();
  }
}

function normalizeLabel(raw: string): string {
  const label = (raw ?? '').trim();
  if (label.length === 0) {
    throw new ReasonValidationError('invalid_label', 'El motivo no puede estar vacío.');
  }
  if (label.length > LABEL_MAX_LEN) {
    throw new ReasonValidationError(
      'label_too_long',
      `El motivo no puede superar ${LABEL_MAX_LEN} caracteres.`
    );
  }
  return label;
}

function normalizeBeneficiarioTipo(raw: BeneficiarioTipo | undefined): BeneficiarioTipo {
  const t = raw ?? 'ninguno';
  if (!BENEFICIARIO_TIPOS.includes(t)) {
    throw new ReasonValidationError(
      'invalid_beneficiario_tipo',
      `beneficiario_tipo "${t}" inválido. Valores: ${BENEFICIARIO_TIPOS.join(', ')}`
    );
  }
  return t;
}

function requireTenant(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError('unknown', null, 'cash.reasons: tenant_id ausente en context');
  }
  return ctx.tenant_id;
}

/** Motivos ACTIVOS del tenant, ordenados. Cualquier usuario autenticado. */
export async function listWithdrawalReasons(): Promise<CashWithdrawalReason[]> {
  const tenant_id = requireTenant();
  return db
    .select()
    .from(cash_withdrawal_reasons)
    .where(
      and(
        eq(cash_withdrawal_reasons.tenant_id, tenant_id),
        eq(cash_withdrawal_reasons.is_active, true)
      )
    )
    .orderBy(asc(cash_withdrawal_reasons.sort_order), asc(cash_withdrawal_reasons.created_at));
}

/** Crea un motivo (owner). sort_order = al final. */
export async function createWithdrawalReason(
  input: { label: string; beneficiario_tipo?: BeneficiarioTipo },
  actorRole: UserRole | null | undefined
): Promise<CashWithdrawalReason> {
  assertOwner(actorRole);
  const tenant_id = requireTenant();
  const label = normalizeLabel(input.label);
  const beneficiario_tipo = normalizeBeneficiarioTipo(input.beneficiario_tipo);

  const existing = await db
    .select({ sort_order: cash_withdrawal_reasons.sort_order })
    .from(cash_withdrawal_reasons)
    .where(eq(cash_withdrawal_reasons.tenant_id, tenant_id))
    .orderBy(asc(cash_withdrawal_reasons.sort_order));
  const nextOrder = existing.reduce((max, r) => Math.max(max, r.sort_order), 0) + 1;

  const inserted = await db
    .insert(cash_withdrawal_reasons)
    .values({ tenant_id, label, beneficiario_tipo, sort_order: nextOrder })
    .returning();
  return inserted[0]!;
}

/** Renombra un motivo y/o cambia su tipo de beneficiario (owner). */
export async function updateWithdrawalReason(
  input: { id: string; label: string; beneficiario_tipo?: BeneficiarioTipo },
  actorRole: UserRole | null | undefined
): Promise<CashWithdrawalReason> {
  assertOwner(actorRole);
  const tenant_id = requireTenant();
  if (!isValidUuid(input.id)) {
    throw new ReasonValidationError('invalid_id', `id no es UUID válido ("${input.id}")`);
  }
  const label = normalizeLabel(input.label);
  const beneficiario_tipo = normalizeBeneficiarioTipo(input.beneficiario_tipo);

  const updated = await db
    .update(cash_withdrawal_reasons)
    .set({ label, beneficiario_tipo, updated_at: new Date() })
    .where(
      and(
        eq(cash_withdrawal_reasons.id, input.id),
        eq(cash_withdrawal_reasons.tenant_id, tenant_id)
      )
    )
    .returning();
  if (updated.length === 0) {
    throw new ReasonValidationError('reason_not_found', 'Motivo no encontrado.');
  }
  return updated[0]!;
}

/** Baja lógica de un motivo (owner). Histórico intacto. */
export async function deactivateWithdrawalReason(
  input: { id: string },
  actorRole: UserRole | null | undefined
): Promise<CashWithdrawalReason> {
  assertOwner(actorRole);
  const tenant_id = requireTenant();
  if (!isValidUuid(input.id)) {
    throw new ReasonValidationError('invalid_id', `id no es UUID válido ("${input.id}")`);
  }

  const updated = await db
    .update(cash_withdrawal_reasons)
    .set({ is_active: false, updated_at: new Date() })
    .where(
      and(
        eq(cash_withdrawal_reasons.id, input.id),
        eq(cash_withdrawal_reasons.tenant_id, tenant_id)
      )
    )
    .returning();
  if (updated.length === 0) {
    throw new ReasonValidationError('reason_not_found', 'Motivo no encontrado.');
  }
  return updated[0]!;
}
