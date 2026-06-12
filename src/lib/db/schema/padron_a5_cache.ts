/**
 * padron_a5_cache = cache 24h de respuestas Padrón A5 ARCA por CUIT consultado.
 * CLAUDE.md §17.2 + §3.5 (A-4 política caché pendiente contador).
 *
 * Strategy F0:
 * - TTL default 24h (CLAUDE.md §17.2). Política exacta pendiente A-4 contador
 *   (estricto vs permisivo + tolerancia timeout). Hasta cierre A-4, default
 *   conservador: stale > 24h → re-fetch obligatorio antes de emitir.
 * - Tenant-scoped: el caché es por (tenant_id, cuit_consultado). NO compartido
 *   entre tenants (privacidad + aislamiento ADR-0002).
 * - Soft TTL: la columna fetched_at habilita "stale-while-revalidate" si el
 *   service decide aceptar caché stale en path NO crítico (ej: catalog
 *   lookup). En path fiscal hot, fail-closed strict si stale.
 * - Cleanup: cron diario elimina rows con fetched_at < now() - 7 days
 *   (cualquier consulta más vieja se re-fetchea limpio).
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId } from './_common.js';
import { companies } from './companies.js';

export const padron_a5_cache = pgTable(
  'padron_a5_cache',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    /**
     * CUIT consultado (11 dígitos). Puede ser:
     * - CUIT del cliente final (lookup pre-emisión factura A)
     * - CUIT del propio tenant comerciante (verificación periódica del estado fiscal)
     *
     * Guardado como text (no número) para preservar leading zeros si los hubiese
     * y para simplificar comparación con respuestas WSDL (que vienen string).
     */
    cuit: text('cuit').notNull(),

    /**
     * Payload Padrón A5 normalizado. Estructura típica AFIP:
     *   { tipoPersona, estadoClave, razonSocial, tipoClave, idPersona,
     *     domicilioFiscal: {...}, impuestos: [...], actividades: [...] }
     *
     * jsonb permite flexibilidad si AFIP cambia campos (común en sus WS).
     * El service que persiste hace shape validation con Zod antes de INSERT.
     */
    data: jsonb('data').notNull(),

    /**
     * Timestamp del fetch exitoso (no del INSERT — pueden diferir si hay retry).
     * Usado para TTL: stale si now() - fetched_at > policy_ttl.
     */
    fetched_at: timestamp('fetched_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),

    created_at: createdAt(),
  },
  (table) => ({
    /**
     * UNIQUE (tenant_id, cuit) — cada combinación es 1 entry. Re-fetch
     * actualiza row existente (UPSERT) sin duplicar.
     */
    tenantCuitUnique: unique('padron_a5_cache_tenant_cuit_unique').on(
      table.tenant_id,
      table.cuit
    ),

    /**
     * Index por (tenant_id, fetched_at) — usado por cron cleanup (TTL) +
     * service que necesita evaluar staleness sin scan full.
     */
    tenantFetchedIdx: index('padron_a5_cache_tenant_fetched_idx').on(
      table.tenant_id,
      table.fetched_at
    ),
  })
);

export type PadronA5CacheEntry = typeof padron_a5_cache.$inferSelect;
export type NewPadronA5CacheEntry = typeof padron_a5_cache.$inferInsert;
