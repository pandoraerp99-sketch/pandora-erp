/**
 * processed_webhook_events = registro de webhooks entrantes procesados.
 * ADR-0019 S3 + S3-bis + CLAUDE.md §11.3 + §17.7.
 *
 * Proposito triple:
 * 1. **Dedup** — UNIQUE (provider, event_id) previene doble procesamiento
 *    de webhooks duplicados que MercadoPago/AFIP envian por su retry interno.
 *    Sin esto: doble cobro registrado, doble update de venta, doble email, etc.
 * 2. **Audit trail** — quedaregistrado QUE webhook llego + cuando + con que payload hash.
 * 3. **Replay protection** — combinado con validateWebhookFreshness (header
 *    timestamp ±5min) bloquea replay attacks con event_id viejo.
 *
 * NO es append-only inmutable — el row se updatea con sale_id cuando el
 * webhook se asocia a una venta procesada. Pero (provider, event_id) NUNCA
 * cambia (UNIQUE constraint).
 *
 * Cleanup: cron diario elimina rows > 7 dias (CLAUDE.md §16.4 retention).
 * El UNIQUE garantia es solo dentro de la ventana 7 dias — MercadoPago/AFIP
 * NO reenvian webhooks despues de 7 dias, asi que es safe.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from 'drizzle-orm/pg-core';
import { id, tenantId } from './_common.js';
import { sales } from './sales.js';

/**
 * Catalogo cerrado de webhook providers F0.
 * Agregar provider = PR + handler dedicado + actualizar este catalogo.
 */
export const WEBHOOK_PROVIDERS = ['mercadopago', 'afip'] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

export const processed_webhook_events = pgTable(
  'processed_webhook_events',
  {
    id: id(),

    /** Provider del webhook. CHECK constraint enforce catalogo. */
    provider: text('provider').notNull(),

    /**
     * event_id provisto por el provider en el header (X-Event-Id u
     * equivalente). Para MercadoPago: `id` del notification payload.
     * Para AFIP: por ahora no hay (AFIP no manda webhooks F0), pero
     * la columna existe para cuando habilitemos AFIP push.
     */
    event_id: text('event_id').notNull(),

    /**
     * tenant_id del comercio target. Para webhooks que llegan ANTES de
     * identificar tenant (ej: MP en URL publica sin tenant en path),
     * se usa env.SYSTEM_TENANT_ID y se updatea cuando se resuelve.
     * NO requiere FK porque crones/sistema pueden registrar webhooks.
     */
    tenant_id: tenantId(),

    /**
     * sale_id si el webhook se asocio a una venta. NULL hasta que el handler
     * matchea el webhook con una venta especifica. UPDATE permitido aqui.
     */
    sale_id: uuid('sale_id').references(() => sales.id, {
      onDelete: 'set null',
    }),

    /**
     * Validacion HMAC paso (true) o se ejecuto handler con HMAC invalido
     * (false — solo F0 con flag dev/test). Audit critico para forenses.
     */
    signature_validated: boolean('signature_validated').notNull().default(false),

    /**
     * Header timestamp recibido del provider — usado para replay protection.
     * Si esta fuera de ventana ±5min al insertar, el handler debe rechazar
     * ANTES de llegar a este registro (defensa en profundidad).
     * Se persiste igual para audit posterior.
     */
    header_timestamp: timestamp('header_timestamp', {
      withTimezone: true,
      mode: 'date',
    }),

    /**
     * SHA-256 del raw body del webhook. Sanity check para detectar
     * payload tampering entre verificacion HMAC y llegada a service.
     */
    payload_hash: text('payload_hash').notNull(),

    /**
     * correlation_id que el handler genero al recibir el webhook.
     * Permite traceear todo el flujo: webhook in → handler → job enqueued
     * → worker → DB writes.
     */
    correlation_id: uuid('correlation_id').notNull(),

    processed_at: timestamp('processed_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /**
     * Dedup garantia core. Sin este UNIQUE = TODO el modulo es papel mojado.
     * INSERT con ON CONFLICT DO NOTHING devuelve 0 filas → handler sabe
     * que es duplicado y aborta sin re-procesar.
     */
    providerEventUnique: uniqueIndex('processed_webhook_events_provider_event_unique').on(
      table.provider,
      table.event_id
    ),
    /** Cleanup por edad + filtro tenant para reportes. */
    tenantProcessedAtIdx: index('processed_webhook_events_tenant_processed_idx').on(
      table.tenant_id,
      table.processed_at
    ),
    /** Lookup por sale_id (¿que webhooks afectaron esta venta?). */
    saleIdx: index('processed_webhook_events_sale_idx').on(table.sale_id),
    /** Trazabilidad correlation_id. */
    correlationIdx: index('processed_webhook_events_correlation_idx').on(
      table.correlation_id
    ),
    /** Catalogo cerrado de providers. */
    providerCheck: check(
      'processed_webhook_events_provider_check',
      sql`${table.provider} IN (${sql.raw(WEBHOOK_PROVIDERS.map((p) => `'${p}'`).join(','))})`
    ),
  })
);

export type ProcessedWebhookEvent = typeof processed_webhook_events.$inferSelect;
export type NewProcessedWebhookEvent = typeof processed_webhook_events.$inferInsert;
