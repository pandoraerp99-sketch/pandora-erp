/**
 * Gastos del comercio (migration 0026).
 *
 * APPEND-ONLY con triggers en la base: corregir es registrar un gasto de
 * ajuste, no editar. Un gasto editable después de que la contadora lo usó para
 * una DDJJ es un problema, no una comodidad.
 *
 * Ver RESEARCH-BRIEF-gastos.md.
 */
import {
  bigint,
  boolean,
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
import { terceros } from './terceros.js';
import { users } from './users.js';

/** Categorías tomadas del pedido real de la contadora, no inventadas. */
export const EXPENSE_CATEGORIES = [
  'alquiler',
  'seguros',
  'servicios',
  'impuestos_y_tasas',
  'honorarios',
  'mercaderia',
  'otros',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * Sólo `efectivo` genera movimiento de caja.
 *
 * `cuenta_corriente` (migration 0039) es el gasto que TODAVÍA NO SE PAGÓ: no
 * mueve plata, genera una deuda con el proveedor en
 * `supplier_account_movements`. Exige `tercero_id` — una deuda sin acreedor
 * identificado no se puede informar ni pagar.
 *
 * ⚠️ Son DOS checks: esta lista y `expenses_medio_pago_check` en la migración
 * 0039. Actualizar uno solo hace que el gasto falle al guardarse con un error
 * de constraint que no dice nada del negocio.
 */
export const EXPENSE_PAYMENT_METHODS = [
  'efectivo',
  'transferencia',
  'debito',
  'credito',
  'otro',
  'cuenta_corriente',
] as const;

/**
 * El gasto que movió plata de verdad.
 *
 * Decisión del owner (2026-09-17): el número grande de "gastos del mes" sigue
 * siendo **lo que salió**, no lo comprometido. Lo impago se muestra aparte y
 * declarado. Así ningún número ya entregado cambia de valor en silencio el día
 * que aparece la primera compra a 30 días.
 */
export const GASTO_PAGADO_SQL = sql`expenses.medio_pago <> 'cuenta_corriente'`;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    /** Fecha DEL GASTO, no de la carga: se cargan atrasados todo el tiempo. */
    fecha: date('fecha').notNull(),
    categoria: text('categoria').notNull(),

    /** Opcional. El nombre va aparte, como snapshot. */
    tercero_id: uuid('tercero_id').references(() => terceros.id, {
      onDelete: 'restrict',
    }),
    payee_name: text('payee_name'),
    /** CUIT al momento del gasto. La contadora lo pide para el detalle. */
    payee_doc: text('payee_doc'),

    neto: numeric('neto', { precision: 19, scale: 4 }).notNull().default('0'),
    iva: numeric('iva', { precision: 19, scale: 4 }).notNull().default('0'),
    total: numeric('total', { precision: 19, scale: 4 }).notNull(),

    descripcion: text('descripcion'),
    comprobante_tipo: text('comprobante_tipo'),
    comprobante_numero: text('comprobante_numero'),

    /**
     * Si entra al IVA compras. Los que SÍ, el estudio ya los baja de ARCA; los
     * que NO son los que el comercio tiene que mandar. Sin esta separación el
     * export duplica lo que la contadora ya tiene.
     */
    en_iva_compras: boolean('en_iva_compras').notNull().default(false),

    medio_pago: text('medio_pago').notNull(),
    // bigint: cash_movements usa bigserial.
    cash_movement_id: bigint('cash_movement_id', { mode: 'bigint' }),

    /**
     * Gasto que esta fila corrige o anula (migration 0033, patrón ADR-0026).
     *
     * La tabla es append-only por trigger: corregir es INSERTAR una fila con
     * los valores correctos apuntando a la vieja, y anular es insertar una en
     * CERO. Una fila está **vigente** si nadie la apunta y su `total > 0` —
     * ver `GASTO_VIGENTE`, que es el único lugar donde esa regla se escribe.
     */
    corrects_id: uuid('corrects_id'),

    /**
     * Compra de mercadería de la que este gasto es el FLETE (migration 0046).
     *
     * El flete es costo de adquisición (decisión del owner, 2026-11-19; A-33
     * pendiente con la contadora): se reparte entre los artículos de esa
     * compra por valor. Acá se guarda sólo la relación; la parte de cada
     * artículo se calcula al leer (`COSTO_UNITARIO_CON_FLETE_SQL`), así que
     * anular el flete o la compra corrige el costo sin reescribir nada.
     * FK compuesta con tenant_id: no puede apuntar a otro comercio.
     */
    flete_de_compra_id: uuid('flete_de_compra_id'),

    created_by: uuid('created_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantFechaIdx: index('expenses_tenant_fecha_idx').on(
      table.tenant_id,
      table.fecha
    ),
  })
);

export type Expense = typeof expenses.$inferSelect;

/**
 * Qué gasto CUENTA.
 *
 * Las dos condiciones son necesarias y cada una tapa un agujero distinto:
 *
 * - `NOT EXISTS (...)` saca al original que ya fue corregido. Si faltara, el
 *   gasto se contaría dos veces: el viejo y el nuevo.
 * - `total > 0` saca a la fila de anulación. Si faltara, la anulación sumaría
 *   $0 (inofensivo) pero **contaría como un comprobante más** en todos los
 *   `count(*)` — incluido el CSV de proveedores que va al estudio, que
 *   reportaría comprobantes anulados como si existieran.
 *
 * Se exporta como fragmento único a propósito: son 7 consultas las que leen
 * esta tabla, y la regla escrita 7 veces es la regla que se desincroniza.
 */
export const GASTO_VIGENTE = sql`
  ${expenses.total} > 0
  AND NOT EXISTS (
    SELECT 1 FROM expenses c WHERE c.corrects_id = ${expenses.id}
  )
`;

/** Igual que `GASTO_VIGENTE` pero para SQL crudo, donde la tabla se llama `expenses`. */
export const GASTO_VIGENTE_SQL = sql`
  expenses.total > 0
  AND NOT EXISTS (
    SELECT 1 FROM expenses c WHERE c.corrects_id = expenses.id
  )
`;
