/**
 * Catálogo de terceros (beneficiarios de egresos de caja: empleados / proveedores).
 *
 * El cajero elige un tercero al registrar un retiro/gasto cuyo concepto lo pide;
 * el DUEÑO administra la lista (mismo gate que cash_withdrawal_reasons). "Otro"
 * (nombre libre) NO crea filas acá — se guarda como snapshot en el movimiento.
 *
 * F0 minimal (NON-GOAL): un tercero es solo nombre (+ CUIT opcional). NO payroll,
 * NO cuenta corriente. Baja lógica (is_active=false), historia por snapshot.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { terceros, type Tercero } from '../db/schema/terceros.js';
import { TERCERO_TYPES, type TerceroType, type UserRole } from '../db/schema/_common.js';
import { requireTracingContext } from '../tracing/context.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';
import { isValidUuid } from '../tracing/ids.js';

const NAME_MAX_LEN = 80;
const DOC_MAX_LEN = 20;

export type TerceroErrorCode =
  | 'invalid_type'
  | 'invalid_name'
  | 'name_too_long'
  | 'invalid_doc'
  | 'invalid_id'
  | 'tercero_not_found';

export class TerceroValidationError extends Error {
  constructor(
    public readonly code: TerceroErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TerceroValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TerceroAuthorizationError extends Error {
  constructor(message = 'Solo el dueño puede administrar los beneficiarios.') {
    super(message);
    this.name = 'TerceroAuthorizationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Gate: solo el dueño administra el catálogo. Testeable en aislamiento. */
export function assertOwnerTercero(role: UserRole | null | undefined): void {
  if (role !== 'owner') {
    throw new TerceroAuthorizationError();
  }
}

function normalizeName(raw: string): string {
  const name = (raw ?? '').trim();
  if (name.length === 0) {
    throw new TerceroValidationError('invalid_name', 'El nombre no puede estar vacío.');
  }
  if (name.length > NAME_MAX_LEN) {
    throw new TerceroValidationError('name_too_long', `El nombre no puede superar ${NAME_MAX_LEN} caracteres.`);
  }
  return name;
}

function normalizeDoc(raw: string | null | undefined): string | null {
  const doc = (raw ?? '').trim();
  if (doc.length === 0) return null;
  if (doc.length > DOC_MAX_LEN) {
    throw new TerceroValidationError('invalid_doc', `El documento no puede superar ${DOC_MAX_LEN} caracteres.`);
  }
  return doc;
}

function requireTenant(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError('unknown', null, 'cash.terceros: tenant_id ausente en context');
  }
  return ctx.tenant_id;
}

/** Terceros ACTIVOS del tenant de un tipo, ordenados. Cualquier usuario autenticado. */
export async function listTerceros(type: TerceroType): Promise<Tercero[]> {
  const tenant_id = requireTenant();
  return db
    .select()
    .from(terceros)
    .where(
      and(
        eq(terceros.tenant_id, tenant_id),
        eq(terceros.type, type),
        eq(terceros.is_active, true)
      )
    )
    .orderBy(asc(terceros.sort_order), asc(terceros.name));
}

/** Crea un tercero (owner). */
export async function createTercero(
  input: { type: TerceroType; name: string; doc?: string | null },
  actorRole: UserRole | null | undefined
): Promise<Tercero> {
  assertOwnerTercero(actorRole);
  const tenant_id = requireTenant();
  if (!TERCERO_TYPES.includes(input.type)) {
    throw new TerceroValidationError('invalid_type', `type "${input.type}" inválido. Valores: ${TERCERO_TYPES.join(', ')}`);
  }
  const name = normalizeName(input.name);
  const doc = normalizeDoc(input.doc);

  const existing = await db
    .select({ sort_order: terceros.sort_order })
    .from(terceros)
    .where(and(eq(terceros.tenant_id, tenant_id), eq(terceros.type, input.type)));
  const nextOrder = existing.reduce((max, r) => Math.max(max, r.sort_order), 0) + 1;

  const inserted = await db
    .insert(terceros)
    .values({ tenant_id, type: input.type, name, doc, sort_order: nextOrder })
    .returning();
  return inserted[0]!;
}

/** Renombra / edita el doc de un tercero (owner). */
export async function updateTercero(
  input: { id: string; name: string; doc?: string | null },
  actorRole: UserRole | null | undefined
): Promise<Tercero> {
  assertOwnerTercero(actorRole);
  const tenant_id = requireTenant();
  if (!isValidUuid(input.id)) {
    throw new TerceroValidationError('invalid_id', `id no es UUID válido ("${input.id}")`);
  }
  const name = normalizeName(input.name);
  const doc = normalizeDoc(input.doc);

  const updated = await db
    .update(terceros)
    .set({ name, doc, updated_at: new Date() })
    .where(and(eq(terceros.id, input.id), eq(terceros.tenant_id, tenant_id)))
    .returning();
  if (updated.length === 0) {
    throw new TerceroValidationError('tercero_not_found', 'Beneficiario no encontrado.');
  }
  return updated[0]!;
}

/** Baja lógica de un tercero (owner). Historia intacta. */
export async function deactivateTercero(
  input: { id: string },
  actorRole: UserRole | null | undefined
): Promise<Tercero> {
  assertOwnerTercero(actorRole);
  const tenant_id = requireTenant();
  if (!isValidUuid(input.id)) {
    throw new TerceroValidationError('invalid_id', `id no es UUID válido ("${input.id}")`);
  }

  const updated = await db
    .update(terceros)
    .set({ is_active: false, updated_at: new Date() })
    .where(and(eq(terceros.id, input.id), eq(terceros.tenant_id, tenant_id)))
    .returning();
  if (updated.length === 0) {
    throw new TerceroValidationError('tercero_not_found', 'Beneficiario no encontrado.');
  }
  return updated[0]!;
}
