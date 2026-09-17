/**
 * Libro de cuenta corriente de PROVEEDORES (migration 0039).
 *
 * Espejo de `customer_account.ts` del otro lado del mostrador: allá el cliente
 * nos debe, acá le debemos al proveedor. Misma forma porque es el mismo
 * problema, y porque una segunda forma de resolver lo mismo es una segunda
 * forma de equivocarse.
 *
 * APPEND-ONLY con triggers en la base. NO hay `terceros.saldo`: el saldo se
 * CALCULA sumando el libro (CLAUDE.md §20.26).
 *
 * ── LO QUE ESTE LIBRO TIENE Y EL DE CLIENTES NO ───────────────────────────
 * Una columna `fecha`. El ítem 5 (deudores) se entregó con un caveat: su corte
 * usa la fecha de REGISTRACIÓN, así que un fiado del 30/07 cargado el 02/08
 * cae en el ejercicio equivocado. Acá la fecha del hecho se guarda desde el
 * principio, y el corte al cierre no depende de cuándo alguien se acordó de
 * cargarlo.
 */
import {
  bigint,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies.js';
import { expenses } from './expenses.js';
import { terceros } from './terceros.js';
import { users } from './users.js';

/** charge = compra a crédito · payment = le pagamos · adjustment = corrección */
export const SUPPLIER_MOVEMENT_TYPES = ['charge', 'payment', 'adjustment'] as const;
export type SupplierMovementType = (typeof SUPPLIER_MOVEMENT_TYPES)[number];

/** Con qué se le puede pagar a un proveedor. Sólo `efectivo` toca la caja. */
export const SUPPLIER_PAYMENT_METHODS = [
  'efectivo',
  'transferencia',
  'debito',
  'credito',
] as const;
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number];

export const supplier_account_movements = pgTable(
  'supplier_account_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    tercero_id: uuid('tercero_id')
      .notNull()
      .references(() => terceros.id, { onDelete: 'restrict' }),

    type: text('type').notNull(),

    /** SIEMPRE positivo. El signo lo da el `type`, no el número. */
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),

    /** Fecha DEL HECHO. Ver el encabezado: es lo que le faltó al ítem 5. */
    fecha: date('fecha').notNull(),

    expense_id: uuid('expense_id').references(() => expenses.id, {
      onDelete: 'restrict',
    }),

    /**
     * Con qué le pagamos. Sólo en 'payment'. El efectivo ADEMÁS genera un
     * `cash_movements` con type='provider_payment' — que ya existe desde la
     * 0024 y que el cierre de caja ya resta del efectivo esperado.
     */
    payment_method: text('payment_method'),
    // mode 'bigint': cash_movements.id es bigserial.
    cash_movement_id: bigint('cash_movement_id', { mode: 'bigint' }),

    /** Obligatorio en 'adjustment'. */
    reason: text('reason'),

    created_by: uuid('created_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantTerceroIdx: index('sam_tenant_tercero_idx').on(
      table.tenant_id,
      table.tercero_id,
      table.fecha
    ),
    tenantFechaIdx: index('sam_tenant_fecha_idx').on(table.tenant_id, table.fecha),
  })
);

export type SupplierAccountMovement = typeof supplier_account_movements.$inferSelect;

/**
 * El saldo, como fragmento único.
 *
 * Positivo = le DEBEMOS al proveedor. Cero o negativo = está al día o le
 * pagamos de más (una seña, un anticipo).
 *
 * Se exporta desde acá por lo mismo que `GASTO_VIGENTE`: la regla escrita en
 * varios lugares es la regla que se desincroniza. `adjustment` entra con su
 * signo natural — un ajuste que AUMENTA lo que debemos es positivo.
 */
export const SALDO_PROVEEDOR_SQL = sql`
  SUM(CASE
        WHEN type = 'charge' THEN amount
        WHEN type = 'payment' THEN -amount
        ELSE amount
      END)
`;

/**
 * Qué movimiento CUENTA para el saldo.
 *
 * Un cargo nace de un comprobante. Si ese comprobante se anuló, la deuda no
 * existe — y el libro es append-only, así que la deuda no se puede "borrar"
 * ni restar: `adjustment` SUMA y `payment` sería mentir (no se pagó nada).
 *
 * Por eso el cargo deja de contar cuando su gasto deja de estar vigente, que
 * es exactamente la regla que ya gobierna la tabla `expenses` (`GASTO_VIGENTE`).
 * Una sola definición de "qué cuenta", no dos que se desincronizan.
 *
 * Pagos y ajustes no cuelgan de ningún gasto, así que siempre cuentan: si se
 * pagó de más, eso queda como saldo a favor y es correcto que se vea.
 */
export const CARGO_VIGENTE_SQL = sql`
  (
    supplier_account_movements.type <> 'charge'
    OR EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = supplier_account_movements.expense_id
        AND e.total > 0
        AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.corrects_id = e.id)
    )
  )
`;
