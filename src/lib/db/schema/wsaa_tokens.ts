/**
 * wsaa_tokens = cache de tokens WSAA AFIP por (tenant, environment).
 * CLAUDE.md §17.2 — Token cache memoria + DB. TTL oficial 12h.
 *
 * WSAA (Web Service Autenticación y Autorización) es el primer hop de
 * cualquier operación ARCA: emite una "credential" (token + sign) que
 * después acompaña cada llamada al WS de negocio (WSFEv1, Padrón A5, etc.).
 *
 * Strategy F0 (CLAUDE.md §17.2):
 * - Cache 12h (TTL oficial AFIP).
 * - Refresh proactivo a las 11h (worker dedicado afip.refresh_wsaa_token).
 * - NUNCA loguear token ni sign (lista de secrets §10.5).
 * - Memory cache primero; DB cache fallback si proceso reinicia.
 * - Environment isolation HARD (ADR-0019 S13): homo y prod NUNCA comparten
 *   tokens. UNIQUE incluye environment.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { AFIP_ENVIRONMENTS, createdAt, id, tenantId } from './_common.js';
import { companies } from './companies.js';

export const wsaa_tokens = pgTable(
  'wsaa_tokens',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    /**
     * 'homologacion' | 'produccion'. CHECK constraint + UNIQUE asegura
     * aislamiento absoluto homo/prod (ADR-0019 S13).
     */
    environment: text('environment').notNull(),

    /**
     * Token base64 emitido por WSAA. Puede ser largo (XML signature wrapped).
     * Postgres text no tiene límite efectivo.
     *
     * **CRÍTICO**: este campo es secret. NUNCA loguear, NUNCA serializar a
     * response HTTP, NUNCA incluir en audit_log payload.
     */
    token: text('token').notNull(),

    /**
     * Sign (cookie) emitido por WSAA. Se envía junto al token en cada call
     * al WS de negocio. Mismo tratamiento de secret que token.
     */
    sign: text('sign').notNull(),

    /**
     * Timestamp de generación reportado por WSAA (campo `generationTime` del XML).
     * Es authoritative — NO confundir con created_at (que es cuando Pandora
     * lo persistió, puede haber leve drift por latencia).
     */
    generated_at: timestamp('generated_at', { withTimezone: true, mode: 'date' }).notNull(),

    /**
     * Timestamp de expiración reportado por WSAA (campo `expirationTime` del XML).
     * Default AFIP 12h pero NO asumir — usar el valor que WSAA devuelve.
     * Refresh proactivo cuando now() > expires_at - 1h (margen de seguridad).
     */
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

    created_at: createdAt(),
  },
  (table) => ({
    /**
     * UNIQUE (tenant_id, environment) — un token activo por combinación.
     * Refresh = UPSERT sobre la misma row (no duplicar).
     */
    tenantEnvironmentUnique: unique('wsaa_tokens_tenant_env_unique').on(
      table.tenant_id,
      table.environment
    ),

    /**
     * Index por (tenant_id, expires_at) — worker de refresh busca tokens
     * próximos a vencer sin scan full.
     */
    expiryIdx: index('wsaa_tokens_expiry_idx').on(table.tenant_id, table.expires_at),

    /**
     * CHECK environment in AFIP_ENVIRONMENTS — defense in depth (el enum TS
     * ya restringe pero un INSERT raw rompería sin esto).
     */
    environmentCheck: check(
      'wsaa_tokens_environment_check',
      sql`${table.environment} IN (${sql.raw(AFIP_ENVIRONMENTS.map((e) => `'${e}'`).join(','))})`
    ),

    /**
     * CHECK expires_at > generated_at — defense contra rows corruptas
     * (token sin TTL real o invertido).
     */
    expiryAfterGenerationCheck: check(
      'wsaa_tokens_expiry_after_generation',
      sql`${table.expires_at} > ${table.generated_at}`
    ),
  })
);

export type WsaaToken = typeof wsaa_tokens.$inferSelect;
export type NewWsaaToken = typeof wsaa_tokens.$inferInsert;
