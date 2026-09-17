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

/**
 * Plata que SALIÓ hacia proveedores en un rango. Escalar, para sumar al total
 * de gastos de un período.
 *
 * Existe porque "gastos del mes = plata que salió" (decisión del owner
 * 2026-09-17) tiene DOS lados y el primer intento sólo implementó uno: excluir
 * el gasto a cuenta corriente del mes en que se compró. Sin esto, el mes en que
 * se paga queda gratis y el gasto no aparece en NINGÚN mes — un comercio que
 * compra a 30 días vería sus gastos en cero para siempre.
 *
 * Sólo `payment`: un `adjustment` corrige lo que se DEBE, no mueve un peso. Si
 * entrara acá, un ajuste inventaría un gasto que nunca se pagó.
 *
 * Tampoco se filtra por `CARGO_VIGENTE`: un pago ya hecho no se deshace porque
 * después se anule un comprobante (y anular con pagos aplicados está bloqueado).
 */
export const pagosAProveedoresSql = (tenantId: string, desde: string, hasta: string) => sql`
  (SELECT coalesce(sum(p.amount), 0)
     FROM supplier_account_movements p
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.type = 'payment'
      AND p.fecha >= ${desde}::date
      AND p.fecha <  ${hasta}::date)
`;

/**
 * Lo que se le DEBE a proveedores a una fecha de corte (exclusiva).
 *
 * Es una FOTO, como la caja (ítem 1) y los deudores (ítem 5) — no un flujo del
 * período. Y es la MISMA regla que usa `getAcreedoresAlCierre`: saldo por
 * proveedor, sólo cargos vigentes, y sólo los positivos.
 *
 * Los negativos quedan afuera a propósito: pagarle de más a un proveedor es una
 * seña, un crédito NUESTRO. Si entrara, restaría del total adeudado como si
 * fuera menos pasivo.
 *
 * Se comparte en vez de reescribirse en cada lector porque la alternativa era
 * tener dos definiciones de "impago" que se contradicen (CLAUDE.md §20.26): la
 * primera versión calculaba "nació a crédito", que sigue contando una deuda ya
 * saldada porque `medio_pago` no cambia cuando se paga.
 */
export const deudaAProveedoresSql = (tenantId: string, hasta: string) => sql`
  (SELECT coalesce(sum(s.saldo), 0) FROM (
     SELECT ${SALDO_PROVEEDOR_SQL} AS saldo
       FROM supplier_account_movements
      WHERE supplier_account_movements.tenant_id = ${tenantId}::uuid
        AND supplier_account_movements.fecha < ${hasta}::date
        AND ${CARGO_VIGENTE_SQL}
      GROUP BY supplier_account_movements.tercero_id
     HAVING ${SALDO_PROVEEDOR_SQL} > 0
   ) s)
`;

/** Cuántos proveedores quedan con saldo a favor suyo al corte. */
export const cantidadAcreedoresSql = (tenantId: string, hasta: string) => sql`
  (SELECT count(*) FROM (
     SELECT 1
       FROM supplier_account_movements
      WHERE supplier_account_movements.tenant_id = ${tenantId}::uuid
        AND supplier_account_movements.fecha < ${hasta}::date
        AND ${CARGO_VIGENTE_SQL}
      GROUP BY supplier_account_movements.tercero_id
     HAVING ${SALDO_PROVEEDOR_SQL} > 0
   ) s)
`;
