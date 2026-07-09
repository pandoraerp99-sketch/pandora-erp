/**
 * withIdempotency — dedup reserve-first de mutaciones críticas (ADR-0010).
 *
 * El cliente genera una `key` (UUID) por operación. Si reintenta con la MISMA
 * key (timeout de red, doble click, retry), la operación NO se re-ejecuta:
 * se devuelve el resultado cacheado.
 *
 * ── PATRÓN reserve-first (NO do-then-insert) ──
 *   1. CLAMAR la key: INSERT status='pending' (auto-commit). Esto reserva la
 *      key de forma atómica vía el UNIQUE (tenant_id, idempotency_key) y la
 *      hace VISIBLE inmediatamente a cualquier duplicado concurrente.
 *   2. Ejecutar fn (la operación, con sus propios side effects / tx).
 *   3. COMPLETAR: UPDATE result + status='completed'.
 *
 *   Un duplicado concurrente que pierde el INSERT ve la key ya clamada:
 *   - 'completed' → devuelve el result cacheado (replayed: true).
 *   - 'pending'   → otra request está procesando → IdempotencyInProgressError.
 *   Así el side effect NO-rollbackeable (ej: emisión CAE, Sprint 6) se
 *   ejecuta a lo sumo UNA vez. Contraste con do-then-insert, donde ambos
 *   duplicados ejecutarían el side effect antes de que el UNIQUE decida.
 *
 * ── Corre con el `db` privileged (bypassa RLS) ──
 *   Como el resto del service layer (CLAUDE.md §7.2). Filtra por tenant_id
 *   explícito. Las policies RLS de idempotency_log son defensa en profundidad
 *   para el path authenticated.
 *
 * ── Scope angosto ──
 *   Dedupea REQUESTS DUPLICADOS. NO hace recovery de crash-mid-operación: si
 *   fn lanza o el proceso muere después de clamar, el row queda 'pending'
 *   (huérfano). Eso es ACEPTABLE F0 — el cliente reintenta con key NUEVA; un
 *   crash en path fiscal lo resuelve la Reconciliation Engine (Sprint 7).
 *
 * ── `releaseOnError` — clave para operaciones TRANSACCIONALES ──
 *   Default `false` (comportamiento CAE): si fn lanza, NO liberamos la key —
 *   para un side effect NO-transaccional ya ejecutado parcialmente, liberar
 *   reintroduciría el doble-side-effect. El row 'pending' huérfano es el precio.
 *
 *   `true` (ej: sale.finalize): si fn lanza, BORRAMOS el row 'pending'. Solo es
 *   seguro cuando fn es 100% transaccional — un throw = rollback limpio = cero
 *   efecto persistido — así liberar NO reintroduce doble-cobro. Y es NECESARIO:
 *   sin esto un retry tras error transitorio (oversell, blip de red) chocaría
 *   contra el 'pending' huérfano → IdempotencyInProgressError para siempre (key
 *   envenenada), rompiendo justo la promesa de "retry seguro" en el POS.
 *
 * @returns `{ replayed, result }` — `replayed=true` ⇒ vino del cache (fn NO
 *   se ejecutó). `result` debe ser JSON-serializable (round-trip jsonb).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { idempotency_log } from '../db/schema/idempotency_log.js';
import {
  IdempotencyInProgressError,
  IdempotencyKeyReuseError,
} from '../multi_tenant/errors.js';

export interface IdempotencyParams {
  /** Comercio dueño de la operación (UUID). */
  tenantId: string;
  /** idempotency-key generada por el cliente (UUID). */
  key: string;
  /** Nombre lógico de la operación (ej: 'sale.finalize'). Solo forenses. */
  operation: string;
  /** Hash de los params canónicos del request (detecta reuse de key). */
  requestHash: string;
  /**
   * Si `true` y `fn` lanza, se borra el row 'pending' (permite retry con la
   * misma key). SOLO seguro para `fn` 100% transaccional (throw = rollback
   * limpio). Default `false` = comportamiento CAE (no liberar). Ver header.
   */
  releaseOnError?: boolean;
}

export interface IdempotencyResult<T> {
  /** true ⇒ resultado cacheado (fn NO se ejecutó). */
  replayed: boolean;
  result: T;
}

export async function withIdempotency<T>(
  params: IdempotencyParams,
  fn: () => Promise<T>
): Promise<IdempotencyResult<T>> {
  const { tenantId, key, operation, requestHash, releaseOnError = false } = params;

  // ── Fase 1: reservar la key (INSERT pending, auto-commit) ──
  const claimed = await db
    .insert(idempotency_log)
    .values({
      tenant_id: tenantId,
      idempotency_key: key,
      operation,
      request_hash: requestHash,
      status: 'pending',
    })
    .onConflictDoNothing({
      target: [idempotency_log.tenant_id, idempotency_log.idempotency_key],
    })
    .returning({ id: idempotency_log.id });

  if (claimed.length === 0) {
    // Conflicto: la key ya fue clamada. Path dedup.
    const [existing] = await db
      .select()
      .from(idempotency_log)
      .where(
        and(
          eq(idempotency_log.tenant_id, tenantId),
          eq(idempotency_log.idempotency_key, key)
        )
      );

    if (!existing) {
      // Race raro: conflicto pero el row desapareció (cleanup concurrente).
      // Tratar como in-progress — el cliente reintenta.
      throw new IdempotencyInProgressError(operation, key);
    }
    if (existing.request_hash !== requestHash) {
      throw new IdempotencyKeyReuseError(operation, key);
    }
    if (existing.status === 'completed') {
      return { replayed: true, result: existing.result as T };
    }
    // 'pending' → otra request está procesando.
    throw new IdempotencyInProgressError(operation, key);
  }

  // ── Fase 2: somos el winner. Ejecutar la operación. ──
  let result: T;
  try {
    result = await fn();
  } catch (err) {
    // releaseOnError=true (fn transaccional, ej: sale.finalize): borramos
    // NUESTRO row 'pending' → el retry con la misma key puede re-clamar y
    // completar. Seguro porque el throw hizo rollback (cero efecto).
    // releaseOnError=false (default, ej: CAE no-transaccional): el row queda
    // 'pending' huérfano (ver header) — liberar reintroduciría doble-side-effect.
    if (releaseOnError) {
      await db
        .delete(idempotency_log)
        .where(
          and(
            eq(idempotency_log.tenant_id, tenantId),
            eq(idempotency_log.idempotency_key, key),
            eq(idempotency_log.status, 'pending')
          )
        );
    }
    throw err;
  }

  // ── Fase 3: completar (llenar result). ──
  await db
    .update(idempotency_log)
    .set({
      status: 'completed',
      result: (result === undefined ? null : result) as unknown,
      completed_at: new Date(),
    })
    .where(
      and(
        eq(idempotency_log.tenant_id, tenantId),
        eq(idempotency_log.idempotency_key, key)
      )
    );

  return { replayed: false, result };
}
