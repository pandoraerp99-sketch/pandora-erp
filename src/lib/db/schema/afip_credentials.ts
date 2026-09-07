/**
 * Certificado X.509 + clave privada de AFIP, por (tenant, environment).
 * Migration 0025.
 *
 * El contenido va CIFRADO con el vault (`src/lib/security/vault.ts`): en la
 * base nunca hay un PEM en claro, y un CHECK lo hace cumplir.
 *
 * Aislado por `environment` a proposito (ADR-0019 S13): el cert de
 * homologacion y el de produccion son filas distintas, para que uno no pueda
 * llegar al endpoint del otro.
 */
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies.js';

export const afip_credentials = pgTable(
  'afip_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    /** 'homologacion' | 'produccion' */
    environment: text('environment').notNull(),

    /** 11 digitos, sin guiones: asi viaja en el TRA. */
    cuit: text('cuit').notNull(),

    /** Wire format del vault (`v1:iv:tag:ciphertext`). NUNCA un PEM. */
    cert_encrypted: text('cert_encrypted').notNull(),
    private_key_encrypted: text('private_key_encrypted').notNull(),

    /** Vencimiento del X.509, para avisar ANTES de que corte la emision. */
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }),

    alias: text('alias'),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantEnvUq: unique('afip_credentials_tenant_env_uq').on(
      table.tenant_id,
      table.environment
    ),
  })
);

export type AfipCredentialRow = typeof afip_credentials.$inferSelect;
