/**
 * Webhook dedup + replay protection helpers.
 * ADR-0019 S3 + S3-bis + CLAUDE.md §11.3 + §17.7.
 *
 * Patron de uso en handler /api/webhooks/<provider>:
 *   1. validateHmac(req)           ← HMAC primero, antes de hash o DB.
 *   2. validateWebhookFreshness()  ← timestamp window check.
 *   3. tryRegisterWebhookEvent()   ← dedup atomico INSERT ON CONFLICT.
 *      Si !isNew → return early con 200 OK (idempotente).
 *   4. Process event + asociar sale_id si aplica (update directo permitido).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, type Db } from '../db/client.js';
import {
  processed_webhook_events,
  WEBHOOK_PROVIDERS,
  type ProcessedWebhookEvent,
  type WebhookProvider,
} from '../db/schema/processed_webhook_events.js';
import { requireTracingContext } from '../tracing/context.js';
import { env } from '../env.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';

type DbOrTransaction = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Ventana de aceptacion de header timestamp para replay protection.
 * +/- 5 min absorbe clock skew entre Pandora y provider sin permitir
 * replays de hace horas/dias.
 */
export const WEBHOOK_FRESHNESS_TOLERANCE_SECONDS = 300;

/**
 * Hash SHA-256 hex del raw body. Usado para detectar payload tampering
 * entre HMAC verify y llegada a service (defensa en profundidad).
 */
export function hashWebhookPayload(rawBody: string): string {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

/**
 * Compara dos signatures usando timingSafeEqual (anti-timing-attack).
 * Helper export aqui porque va a ser usado por el HMAC validator del
 * Sprint 1 #4 cuando lo construyamos.
 */
export function safeSignatureCompare(a: string, b: string): boolean {
  // Ambas signatures deben tener misma longitud para timingSafeEqual
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Valida que el header timestamp este dentro de la ventana de freshness.
 *
 * @param headerTimestamp — segundos UNIX (numero) o ISO string del header.
 * @param nowMs — opcional, para tests determinísticos.
 * @returns true si esta dentro de ventana.
 */
export function validateWebhookFreshness(
  headerTimestamp: number | string,
  nowMs: number = Date.now()
): boolean {
  let headerMs: number;
  if (typeof headerTimestamp === 'number') {
    // segundos UNIX → ms
    headerMs = headerTimestamp * 1000;
  } else {
    const parsed = Date.parse(headerTimestamp);
    if (Number.isNaN(parsed)) return false;
    headerMs = parsed;
  }
  const driftMs = Math.abs(nowMs - headerMs);
  return driftMs <= WEBHOOK_FRESHNESS_TOLERANCE_SECONDS * 1000;
}

export interface TryRegisterInput {
  provider: WebhookProvider;
  event_id: string;
  payload_hash: string;
  signature_validated: boolean;
  header_timestamp?: Date;
  /**
   * tenant_id: si el webhook llega ya identificado (path con tenant_slug,
   * o lookup via account_id de MP). Si no, usar env.SYSTEM_TENANT_ID y
   * updatear despues.
   */
  tenant_id?: string;
}

export type TryRegisterResult =
  | { isNew: true; row: ProcessedWebhookEvent }
  | {
      isNew: false;
      existing_processed_at: Date;
      existing_correlation_id: string;
      /**
       * payload_hash registrado en la primera llegada del webhook. El handler
       * compara contra el hash del payload actual: si difieren, alguien esta
       * reenviando un webhook con event_id valido pero payload modificado
       * (tampering post-HMAC, o bug del provider). Loguear como warning
       * + audit `security.webhook_payload_mismatch` para investigacion.
       */
      existing_payload_hash: string;
    };

/**
 * Inserta el registro de webhook procesado, atomicamente.
 * Si (provider, event_id) ya existe → devuelve isNew=false + metadata
 * existente (para que el handler responda 200 OK idempotente).
 *
 * ATENCION: usa ON CONFLICT DO NOTHING + SELECT fallback. La race
 * entre INSERT y SELECT es benigna — si dos workers reciben el mismo
 * webhook simultaneamente, exactamente uno gana el INSERT (UNIQUE) y
 * el otro hace SELECT y obtiene el row del primero.
 */
export async function tryRegisterWebhookEvent(
  input: TryRegisterInput,
  txOrDb: DbOrTransaction = db
): Promise<TryRegisterResult> {
  if (!WEBHOOK_PROVIDERS.includes(input.provider)) {
    throw new Error(
      `Webhook provider fuera de catalogo: ${input.provider}. Catalogo cerrado, agregar a WEBHOOK_PROVIDERS + handler dedicado.`
    );
  }
  if (input.event_id.length === 0) {
    throw new Error('event_id vacio — no se puede dedupear sin event_id');
  }
  if (input.payload_hash.length !== 64) {
    // SHA-256 hex = 64 chars. Defensa contra hash invalido.
    throw new Error(
      `payload_hash invalido: esperado SHA-256 hex 64 chars, recibido ${input.payload_hash.length}`
    );
  }

  const ctx = requireTracingContext();

  // Multi-tenant guard (CLAUDE.md §7.2 — defense in depth, mismo patron que
  // jobs_queue.override_tenant_id + audit-writer.override_tenant_id).
  // input.tenant_id solo se acepta si:
  //   (a) coincide con ctx.tenant_id (no es realmente override), o
  //   (b) actor_type es 'system' o 'cron' (webhook handler antes de
  //       identificar tenant via account_id de MP).
  // Cualquier otra combinacion es bug de programacion o intento de cross-tenant.
  if (
    input.tenant_id !== undefined &&
    input.tenant_id !== ctx.tenant_id &&
    ctx.actor_type !== 'system' &&
    ctx.actor_type !== 'cron'
  ) {
    throw new CrossTenantAccessError(
      input.tenant_id,
      ctx.tenant_id,
      'processed_webhook_events.tenant_id'
    );
  }
  const tenantId = input.tenant_id ?? ctx.tenant_id ?? env.SYSTEM_TENANT_ID;

  // INSERT ON CONFLICT DO NOTHING RETURNING
  const inserted = await txOrDb
    .insert(processed_webhook_events)
    .values({
      provider: input.provider,
      event_id: input.event_id,
      tenant_id: tenantId,
      signature_validated: input.signature_validated,
      header_timestamp: input.header_timestamp,
      payload_hash: input.payload_hash,
      correlation_id: ctx.correlation_id,
    })
    .onConflictDoNothing({
      target: [
        processed_webhook_events.provider,
        processed_webhook_events.event_id,
      ],
    })
    .returning();

  if (inserted.length > 0) {
    return { isNew: true, row: inserted[0]! };
  }

  // Conflict — existe row previo. Fetch processed_at + correlation_id +
  // payload_hash para que el handler:
  //   - Loguee cuando se proceso por primera vez (audit).
  //   - Correlacione logs entre primera llegada y este reintento.
  //   - **Detecte tampering**: compara payload_hash actual vs existente.
  //     Si difieren = mismo event_id con payload distinto = warning + audit
  //     `security.webhook_payload_mismatch`.
  const existing = await txOrDb
    .select({
      processed_at: processed_webhook_events.processed_at,
      correlation_id: processed_webhook_events.correlation_id,
      payload_hash: processed_webhook_events.payload_hash,
    })
    .from(processed_webhook_events)
    .where(
      and(
        eq(processed_webhook_events.provider, input.provider),
        eq(processed_webhook_events.event_id, input.event_id)
      )
    )
    .limit(1);

  const row = existing[0];
  if (!row) {
    // Edge case extremadamente raro: el row se borro entre INSERT conflict
    // y SELECT (probablemente cleanup cron concurrente). Tratar como nuevo
    // y permitir re-insert siguiente.
    throw new Error(
      'tryRegisterWebhookEvent: row deleted between INSERT conflict and SELECT — reintentar handler'
    );
  }
  return {
    isNew: false,
    existing_processed_at: row.processed_at,
    existing_correlation_id: row.correlation_id,
    existing_payload_hash: row.payload_hash,
  };
}

/**
 * Asocia un webhook ya registrado con un sale_id. Permitido despues del
 * INSERT inicial cuando el handler matchea el webhook a una venta concreta.
 *
 * NO permite cambiar provider/event_id/payload_hash (esos son inmutables
 * por la naturaleza del registro).
 *
 * Multi-tenant guard: la sale_id debe pertenecer al tenant del context
 * (o actor debe ser system/cron). Validamos leyendo primero el row del
 * webhook + la sale_id propuesta y verificando tenant_id matchea ctx.
 */
export async function associateWebhookEventWithSale(
  provider: WebhookProvider,
  event_id: string,
  sale_id: string,
  txOrDb: DbOrTransaction = db
): Promise<void> {
  const ctx = requireTracingContext();

  // Leer el row del webhook para verificar tenant_id antes del UPDATE.
  // Sin esta lectura, un actor con ctx.tenant_id=A podria asociar el webhook
  // del tenant B con una sale (visible solo si el caller conoce los IDs,
  // pero la defensa constitucional CLAUDE.md §7.2 lo bloquea independiente).
  const existing = await txOrDb
    .select({ tenant_id: processed_webhook_events.tenant_id })
    .from(processed_webhook_events)
    .where(
      and(
        eq(processed_webhook_events.provider, provider),
        eq(processed_webhook_events.event_id, event_id)
      )
    )
    .limit(1);

  const row = existing[0];
  if (!row) {
    // Webhook no registrado todavia — caller bug, throw para visibilidad.
    throw new Error(
      `associateWebhookEventWithSale: webhook (${provider}, ${event_id}) no registrado.`
    );
  }

  if (
    row.tenant_id !== ctx.tenant_id &&
    ctx.actor_type !== 'system' &&
    ctx.actor_type !== 'cron'
  ) {
    throw new CrossTenantAccessError(
      row.tenant_id,
      ctx.tenant_id,
      'processed_webhook_events.associate_sale'
    );
  }

  await txOrDb
    .update(processed_webhook_events)
    .set({ sale_id })
    .where(
      and(
        eq(processed_webhook_events.provider, provider),
        eq(processed_webhook_events.event_id, event_id)
      )
    );
}

/**
 * Cleanup helper — usado por cron.cleanup_old_jobs (o cron especifico).
 * Elimina rows con processed_at < olderThan.
 * Default retention: 7 dias (CLAUDE.md §16.4).
 */
export async function cleanupOldWebhookEvents(
  olderThan: Date,
  txOrDb: DbOrTransaction = db
): Promise<number> {
  const result = await txOrDb
    .delete(processed_webhook_events)
    .where(sql`${processed_webhook_events.processed_at} < ${olderThan}`)
    .returning({ id: processed_webhook_events.id });
  return result.length;
}
