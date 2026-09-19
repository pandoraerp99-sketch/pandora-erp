/**
 * Adjuntos: el comprobante que respalda el gasto (migration 0040 + 0041).
 *
 * El ítem 12 del pedido de la contadora pide los comprobantes — alquiler CON
 * CONTRATO, seguros, servicios, tasas, honorarios. Hasta la 0040 Pandora
 * entregaba la planilla que los DESCRIBE; el archivo seguía en el cajón.
 *
 * ── DOS NATURALEZAS, NO UNA ───────────────────────────────────────────────
 *   comprobante → cuelga del GASTO    (factura de luz, póliza, tasa)
 *   contrato    → cuelga del TERCERO  (locación), con vigencia
 *
 * Un contrato no es un comprobante de pago: es uno solo que respalda doce
 * pagos. Colgado del gasto quedaría grapado a un mes arbitrario.
 *
 * ── LA BAJA ES LÓGICA ─────────────────────────────────────────────────────
 * Mientras A-31 no se responda ("¿la foto reemplaza al papel?") se asume la
 * rama conservadora: la copia digital ES el respaldo. Bajo esa rama un DELETE
 * físico destruye el respaldo y deja el gasto apuntando a nada. Los triggers
 * de la 0040 bloquean el DELETE y la resurrección.
 *
 * NO se exporta desde `index.ts` a propósito: igual que `expenses`,
 * `terceros` y los dos libros de cuenta corriente, esta tabla nace de una
 * migración escrita a mano y no de `drizzle-kit generate`. Ponerla en el index
 * haría que el generador quiera emitir su propia versión.
 */
import { bigint, date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies.js';
import { expenses } from './expenses.js';
import { terceros } from './terceros.js';
import { users } from './users.js';

export const ATTACHMENT_TIPOS = ['comprobante', 'contrato'] as const;
export type AttachmentTipo = (typeof ATTACHMENT_TIPOS)[number];

/**
 * Qué se puede subir. **Tiene que coincidir exacto con `allowed_mime_types`
 * del bucket en la migration 0040**, y no coincide por buena voluntad:
 * `scripts/aplicar-adjuntos.sh` compara esta lista contra la que tiene la base
 * y falla si difieren.
 *
 * Por qué importa que sean dos listas y no una: el bucket rechaza del lado del
 * storage y esto rechaza del lado del service. Si sólo estuviera acá, un
 * upload por otra vía entraría; si sólo estuviera en el bucket, el usuario se
 * comería un error crudo de Supabase en vez de una frase en castellano.
 *
 * `heic`/`heif` están porque son lo que saca un iPhone por defecto, y la foto
 * del ticket la va a sacar un teléfono.
 */
export const TIPOS_DE_ARCHIVO_PERMITIDOS = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** Idem: el bucket tiene `file_size_limit = 15728640`. */
export const MAX_BYTES_ADJUNTO = 15 * 1024 * 1024;

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    tipo: text('tipo').notNull(),

    /**
     * Las FK reales son COMPUESTAS `(expense_id, tenant_id)` (migration 0041)
     * para que el adjunto de un comercio no pueda colgar del gasto de otro.
     * Drizzle no modela la compuesta acá; la verdad vive en la base y la
     * prueba en T-ADJ-01.
     */
    expense_id: uuid('expense_id').references(() => expenses.id, {
      onDelete: 'restrict',
    }),
    tercero_id: uuid('tercero_id').references(() => terceros.id, {
      onDelete: 'restrict',
    }),

    /** Lo que el usuario ve. El nombre REAL en el bucket es el id. */
    nombre_original: text('nombre_original').notNull(),
    content_type: text('content_type').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),

    /** Para poder decir "este archivo es el que se subió" años después. */
    sha256: text('sha256').notNull(),

    /** `{tenant_id}/{id}`. Explícito: si cambia el esquema, los viejos siguen. */
    storage_path: text('storage_path').notNull(),

    vigencia_desde: date('vigencia_desde'),
    vigencia_hasta: date('vigencia_hasta'),

    uploaded_by: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    removed_at: timestamp('removed_at', { withTimezone: true }),
    removed_by: uuid('removed_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    removed_reason: text('removed_reason'),
  },
  (table) => ({
    tenantExpenseIdx: index('attachments_tenant_expense_idx').on(
      table.tenant_id,
      table.expense_id
    ),
    tenantTerceroIdx: index('attachments_tenant_tercero_idx').on(
      table.tenant_id,
      table.tercero_id
    ),
  })
);

export type Attachment = typeof attachments.$inferSelect;

/**
 * Qué adjunto sigue estando.
 *
 * Se comparte por lo mismo que `GASTO_VIGENTE` y `CARGO_VIGENTE_SQL`: la regla
 * escrita en varios lugares es la regla que se desincroniza (CLAUDE.md §20.26).
 * Ya pasó en este proyecto — anular un gasto lo hacía desaparecer de siete
 * lecturas porque cada una decidía "vigente" por su cuenta.
 */
export const ADJUNTO_VIGENTE = sql`attachments.removed_at IS NULL`;
