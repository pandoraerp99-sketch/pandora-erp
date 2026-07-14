/**
 * terceros — beneficiarios de egresos de caja (empleados / proveedores).
 *
 * Cuando el cajero registra un retiro/gasto con un concepto que pide beneficiario
 * (ej: "Pago de sueldo" → empleado, "Pago de proveedor" → proveedor), elige el
 * tercero de esta lista, o "Otro" y escribe el nombre (que NO crea una fila acá —
 * queda como texto snapshot en el movimiento).
 *
 * **Solo el DUEÑO administra la lista** (mismo gate que cash_withdrawal_reasons).
 *
 * **F0 minimal (NON-GOAL boundary):** un tercero es SOLO un nombre (+ CUIT opcional
 * para proveedor). NO es nómina (sueldos/cargas/liquidación = payroll, NON-GOAL) ni
 * cuenta corriente (módulo compras = F1+). Tabla genérica a propósito: el futuro
 * módulo compras reutiliza `terceros` type='proveedor' sin migrar.
 *
 * **Tabla mutable (soft-delete):** is_active=false oculta del picker; los movimientos
 * históricos conservan `payee_name` (snapshot) → renombrar/dar de baja no reescribe
 * la historia.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { createdAt, id, tenantId, updatedAt, TERCERO_TYPES } from './_common.js';

export const terceros = pgTable(
  'terceros',
  {
    id: id(),
    tenant_id: tenantId().references(() => companies.id, { onDelete: 'restrict' }),

    // 'empleado' | 'proveedor'.
    type: text('type').notNull(),

    name: text('name').notNull(),

    // CUIT/CUIL opcional (proveedor sobre todo). Sin validación fiscal F0 — es
    // dato de referencia, no viaja a AFIP.
    doc: text('doc'),

    sort_order: integer('sort_order').notNull().default(0),
    is_active: boolean('is_active').notNull().default(true),

    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => ({
    // Query principal: terceros activos de un tenant por tipo, ordenados.
    tenantTypeActiveIdx: index('terceros_tenant_type_active_idx').on(
      table.tenant_id,
      table.type,
      table.is_active,
      table.sort_order
    ),

    typeCheck: check(
      'terceros_type_check',
      sql`${table.type} IN (${sql.raw(TERCERO_TYPES.map((t) => `'${t}'`).join(','))})`
    ),
    nameNotEmptyCheck: check('terceros_name_not_empty', sql`length(trim(${table.name})) > 0`),
  })
);

export type Tercero = typeof terceros.$inferSelect;
export type NewTercero = typeof terceros.$inferInsert;
