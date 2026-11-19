/**
 * Alivios de caja (migration 0044) — tarjeta "Alivios de caja" de
 * pos-preview/caja-editorial.html.
 *
 * Un alivio es sacar efectivo del cajón para guardarlo mientras la caja sigue
 * abierta. Para el arqueo es un RETIRO (cash_movements type='withdraw') y
 * resta del esperado como cualquier retiro: esta capa no toca esa cuenta.
 * Agrega dos hechos que el retiro solo no guardaba: que fue un alivio, y
 * quién lo retiró después ("retirado por …").
 *
 * Reglas:
 * - Registrar un alivio: cualquiera que opere el comercio, con caja abierta.
 *   El retiro y la marca van en UNA transacción, con idempotencia (un doble
 *   click no saca dos veces la misma plata).
 * - Marcar retirado: SÓLO la dueña (owner). Confirmado por el owner el
 *   2026-11-18: "solo la dueña puede retirar el alivio o marcar como
 *   retirado". Ni el encargado (admin) ni el cajero.
 * - Retirado es una sola vez (PK en la tabla). Marcar de nuevo es un no-op.
 */
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../db/client.js';
import { cash_reliefs, cash_relief_pickups } from '../db/schema/cash_reliefs.js';
import { cash_movements } from '../db/schema/cash_movements.js';
import { users } from '../db/schema/users.js';
import { requireTracingContext } from '../tracing/context.js';
import { CrossTenantAccessError, DomainError } from '../multi_tenant/errors.js';
import { exigirQueOpereElComercio, leerRolEnElComercio } from '../auth/autorizacion.js';
import { withIdempotency } from '../idempotency/idempotency.js';
import { isValidUuid } from '../tracing/ids.js';
import { logger } from '../observability/logger.js';
import { registerCashMovement } from './movements.js';

export class ReliefError extends DomainError {
  constructor(code: string, messageEs: string, status = 422) {
    super(code, messageEs, status);
  }
}

/** Quién puede dar por retirado un alivio: sólo la dueña (owner, 2026-11-18). */
export const ROLES_QUE_RETIRAN: readonly string[] = ['owner'];

function ctx() {
  const c = requireTracingContext();
  if (!c.tenant_id) {
    throw new CrossTenantAccessError('desconocido', null, 'cash.reliefs (sin tenant)');
  }
  return { tenantId: c.tenant_id, userId: c.actor_user_id ?? null, rol: c.actor_role };
}

export interface RegisterReliefInput {
  cash_session_id: string;
  amount: string;
  /** Texto libre del cajero. Por defecto "Alivio de caja". */
  note?: string | null;
}

/** Registra el retiro y lo marca como alivio, en una transacción. */
export async function registerRelief(
  input: RegisterReliefInput,
  idempotencyKey: string
): Promise<{ relief_id: string; movement_id: string }> {
  await exigirQueOpereElComercio();
  const { tenantId, userId } = ctx();
  if (!isValidUuid(idempotencyKey)) {
    throw new ReliefError('invalid_idempotency_key', 'Falta la clave de la operación');
  }
  if (!userId) throw new ReliefError('no_actor', 'Un alivio necesita un usuario identificado');
  const reason = (input.note ?? '').trim() || 'Alivio de caja';

  const { result } = await withIdempotency<{ relief_id: string; movement_id: string }>(
    {
      tenantId,
      key: idempotencyKey,
      operation: 'cash.relief',
      requestHash: createHash('sha256')
        .update(JSON.stringify({ s: input.cash_session_id, a: input.amount, r: reason }))
        .digest('hex'),
      releaseOnError: true,
    },
    () =>
      db.transaction(async (tx) => {
        // registerCashMovement valida caja abierta y del comercio, y el importe.
        const mov = await registerCashMovement(
          { cash_session_id: input.cash_session_id, type: 'withdraw', amount: input.amount, reason },
          tx
        );
        const [fila] = await tx
          .insert(cash_reliefs)
          .values({
            tenant_id: tenantId,
            cash_session_id: input.cash_session_id,
            cash_movement_id: mov.id,
            created_by: userId,
          })
          .returning({ id: cash_reliefs.id });
        if (!fila) throw new Error('insert de cash_reliefs no devolvió fila');
        logger.info({ relief_id: fila.id, cash_movement_id: String(mov.id) }, 'cash.relief.registered');
        return { relief_id: fila.id, movement_id: String(mov.id) };
      })
  );
  return result;
}

/**
 * Da por retirados los alivios elegidos. Devuelve cuántos quedaron marcados
 * AHORA (los que ya estaban retirados no cuentan: doble click = no-op).
 */
export async function markReliefsPickedUp(ids: string[]): Promise<{ marcados: number }> {
  await exigirQueOpereElComercio();
  const { tenantId, userId, rol: rolCtx } = ctx();
  if (!userId) throw new ReliefError('no_actor', 'Hace falta un usuario identificado');
  const rol = rolCtx !== undefined ? rolCtx : await leerRolEnElComercio(tenantId, userId);
  if (!rol || !ROLES_QUE_RETIRAN.includes(rol)) {
    throw new ReliefError(
      'solo_duenia',
      'Sólo la dueña puede marcar un alivio como retirado.',
      403
    );
  }
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) throw new ReliefError('sin_alivios', 'Elegí al menos un alivio');
  if (unicos.length > 200 || !unicos.every(isValidUuid)) {
    throw new ReliefError('invalid_relief', 'Alguno de los alivios no es válido');
  }

  return db.transaction(async (tx) => {
    const encontrados = await tx
      .select({ id: cash_reliefs.id })
      .from(cash_reliefs)
      .where(and(eq(cash_reliefs.tenant_id, tenantId), inArray(cash_reliefs.id, unicos)));
    if (encontrados.length !== unicos.length) {
      throw new ReliefError('relief_not_found', 'Alguno de los alivios no existe', 404);
    }
    const nuevos = await tx
      .insert(cash_relief_pickups)
      .values(unicos.map((id) => ({ relief_id: id, tenant_id: tenantId, picked_by: userId })))
      .onConflictDoNothing({ target: cash_relief_pickups.relief_id })
      .returning({ id: cash_relief_pickups.relief_id });
    logger.info({ marcados: nuevos.length, pedidos: unicos.length }, 'cash.relief.picked_up');
    return { marcados: nuevos.length };
  });
}

export interface AlivioFila {
  id: string;
  amount: string;
  created_at: Date;
  por: string | null;
  cash_session_id: string;
  picked_at: Date | null;
  picked_por: string | null;
}

/**
 * Lo que muestra la tarjeta: TODOS los pendientes (de esta caja o de una
 * anterior: la plata sigue en el sobre hasta que alguien la retira) y los
 * retirados de esta caja. Pendientes primero, cada grupo por hora.
 */
export async function listReliefsForSession(sessionId: string): Promise<AlivioFila[]> {
  const { tenantId } = ctx();
  if (!isValidUuid(sessionId)) return [];
  const creador = sql<string | null>`(SELECT COALESCE(u.full_name, u.email) FROM users u WHERE u.id = ${cash_reliefs.created_by})`;
  const filas = await db
    .select({
      id: cash_reliefs.id,
      amount: cash_movements.amount,
      created_at: cash_reliefs.created_at,
      por: creador,
      cash_session_id: cash_reliefs.cash_session_id,
      picked_at: cash_relief_pickups.picked_at,
      picked_por: sql<string | null>`COALESCE(${users.full_name}, ${users.email})`,
    })
    .from(cash_reliefs)
    .innerJoin(cash_movements, eq(cash_movements.id, cash_reliefs.cash_movement_id))
    .leftJoin(
      cash_relief_pickups,
      and(
        eq(cash_relief_pickups.relief_id, cash_reliefs.id),
        eq(cash_relief_pickups.tenant_id, cash_reliefs.tenant_id)
      )
    )
    .leftJoin(users, eq(users.id, cash_relief_pickups.picked_by))
    .where(
      and(
        eq(cash_reliefs.tenant_id, tenantId),
        or(isNull(cash_relief_pickups.relief_id), eq(cash_reliefs.cash_session_id, sessionId))
      )
    )
    .orderBy(asc(cash_reliefs.created_at));
  return [...filas.filter((f) => f.picked_at === null), ...filas.filter((f) => f.picked_at !== null)];
}
