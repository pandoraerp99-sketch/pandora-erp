/**
 * cash_withdrawal_reasons — catálogo de MOTIVOS de retiro/gasto de caja por tenant.
 *
 * Cuando el cajero registra un retiro/gasto de caja (`cash_movements.type =
 * 'provider_payment'`, el egreso con motivo — a diferencia del `withdraw`/alivio),
 * elige un motivo de esta lista (ej: Pago de proveedor, Pago de sueldo, Pago de
 * mercadería) o "Otros" con aclaración libre obligatoria.
 *
 * **Solo el DUEÑO (role='owner') administra la lista** (crear / renombrar /
 * desactivar). El gate se enforcea server-side en las server actions + en el
 * dominio (ver src/lib/cash/reasons.ts). El cajero solo la consume.
 *
 * **Tabla mutable de config (NO append-only):** a diferencia de cash_movements /
 * sale_payments, esta es configuración editable — se renombra y se da de baja.
 * `is_active=false` es baja lógica (soft-delete): el motivo desaparece del picker
 * pero los movimientos históricos conservan su `reason` (texto snapshot, NO FK),
 * así renombrar/borrar un motivo NO reescribe la historia.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { createdAt, id, tenantId, updatedAt, BENEFICIARIO_TIPOS } from './_common.js';

export const cash_withdrawal_reasons = pgTable(
  'cash_withdrawal_reasons',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    // Etiqueta visible en el picker (ej: "Pago de proveedor"). Editable por owner.
    label: text('label').notNull(),

    // Qué beneficiario pide este concepto: 'ninguno' | 'empleado' | 'proveedor'.
    // Al registrar el retiro, si != 'ninguno' se muestra el picker de terceros.
    beneficiario_tipo: text('beneficiario_tipo').notNull().default('ninguno'),

    // Orden de aparición en el picker (menor primero).
    sort_order: integer('sort_order').notNull().default(0),

    // Baja lógica: false = oculto del picker, histórico intacto.
    is_active: boolean('is_active').notNull().default(true),

    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => ({
    // Query principal: motivos activos de un tenant ordenados.
    tenantActiveIdx: index('cash_withdrawal_reasons_tenant_active_idx').on(
      table.tenant_id,
      table.is_active,
      table.sort_order
    ),

    labelNotEmptyCheck: check(
      'cash_withdrawal_reasons_label_not_empty',
      sql`length(trim(${table.label})) > 0`
    ),
    beneficiarioTipoCheck: check(
      'cash_withdrawal_reasons_beneficiario_tipo_check',
      sql`${table.beneficiario_tipo} IN (${sql.raw(BENEFICIARIO_TIPOS.map((t) => `'${t}'`).join(','))})`
    ),
  })
);

export type CashWithdrawalReason = typeof cash_withdrawal_reasons.$inferSelect;
export type NewCashWithdrawalReason = typeof cash_withdrawal_reasons.$inferInsert;
