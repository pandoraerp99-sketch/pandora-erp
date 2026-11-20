/**
 * El detalle de una compra de mercadería: **el lote**.
 *
 * Una compra en Pandora es un `expenses` con `categoria='mercaderia'` — ahí
 * viven la fecha, el proveedor con su CUIT, el comprobante, los importes y el
 * medio de pago. Lo que esta tabla agrega es lo único que faltaba: qué
 * producto entró, cuántas unidades y a qué costo.
 *
 * Eso es lo que el ítem 8 del pedido de la contadora necesita para el
 * "inventario de bienes de cambio valorizado al cierre": la **fecha de
 * adquisición** (la del gasto) y el **importe de compra** (estas líneas), que
 * `products.cost` por sí solo no puede dar porque es un valor único que se
 * pisa cada vez que el proveedor aumenta.
 *
 * ── NO GUARDA CUÁNTO QUEDA ────────────────────────────────────────────────
 * No hay `remaining_qty`. Bajo PEPS las unidades en stock son las de las
 * compras más recientes, así que la valuación se deriva caminando las compras
 * hacia atrás desde el stock a esa fecha — computable desde el ledger, que
 * guarda el signo desde la migration 0032. Una columna de remanente daría el
 * mismo número y sería la única pieza mutable de una cadena append-only.
 *
 * ── APPEND-ONLY (trigger, migration 0034) ─────────────────────────────────
 * Corregir una compra es **anular el gasto** (`expenses.corrects_id`) y volver
 * a cargarlo. La anulación por supersede asume que las líneas del comprobante
 * anulado quedan congeladas tal como se cargaron.
 */
import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies.js';
import { expenses } from './expenses.js';
import { products } from './products.js';

export const expense_items = pgTable(
  'expense_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    expense_id: uuid('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'restrict' }),

    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),

    /**
     * El renglón del papel (1, 2, 3…). Columna de ORDEN, no de negocio.
     *
     * Dos líneas del mismo comprobante se insertan en la misma transacción y
     * comparten `created_at` al milisegundo (en Postgres `now()` es el arranque
     * de la transacción), así que sin esto el detalle se relee en orden
     * arbitrario — y anular no puede decidir determinísticamente qué línea fija
     * `products.cost`. Migration 0036.
     */
    linea: integer('linea').notNull(),

    /** Unidades que entraron. Decimal por los productos que se venden por kg/m/l. */
    qty: numeric('qty', { precision: 19, scale: 4 }).notNull(),

    /**
     * Costo unitario **NETO de IVA recuperable**.
     *
     * Las líneas reconcilian contra `neto` cuando el IVA está discriminado y
     * contra `total` cuando no: el IVA no discriminado no da crédito fiscal,
     * así que es parte del costo de la mercadería.
     *
     * ⚠️ De acá sale `products.cost`, y de ahí `unit_cost_snapshot` al vender.
     * Un costo en bruto dejaría todos los márgenes ~21% subestimados con un
     * número que parece razonable.
     */
    unit_cost: numeric('unit_cost', { precision: 19, scale: 4 }).notNull(),

    /** La historia no se reescribe si después renombran el producto. */
    product_name_snapshot: text('product_name_snapshot').notNull(),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    expenseIdx: index('expense_items_expense_idx').on(table.expense_id),
    // Las compras de un producto, de la más nueva a la más vieja: es
    // exactamente como se camina el lote hacia atrás al valorizar.
    tenantProductIdx: index('expense_items_tenant_product_idx').on(
      table.tenant_id,
      table.product_id
    ),
    qtyPositiveCheck: check('expense_items_qty_positive', sql`${table.qty} > 0`),
    costNoNegativoCheck: check(
      'expense_items_cost_no_negativo',
      sql`${table.unit_cost} >= 0`
    ),
    lineaPositivaCheck: check('expense_items_linea_positiva', sql`${table.linea} > 0`),
    // Dos renglones no pueden ser el mismo renglón. Además de la integridad, es
    // lo que hace determinístico el desempate al recalcular el costo.
    lineaUq: unique('expense_items_linea_uq').on(table.expense_id, table.linea),
  })
);

export type ExpenseItem = typeof expense_items.$inferSelect;
export type NewExpenseItem = typeof expense_items.$inferInsert;

/**
 * Costo unitario de un renglón de compra CON SU PARTE DEL FLETE (0046).
 *
 * Para usar con las tablas sin alias `expense_items` y `expenses`, igual que
 * `GASTO_VIGENTE_SQL`. Es la fórmula única: la usan el costo actual del
 * producto (`recalcularCostoUltimaCompra`) y el inventario valorizado, y la
 * vista previa de la carga hace la misma cuenta en `domain/impacto-compra`.
 *
 * El flete se reparte POR VALOR: a cada renglón le toca
 *     flete × (qty × costo) / Σ(qty × costo de la compra)
 * y por unidad eso es  flete × costo / Σ.  Sin redondear en el camino: las
 * partes suman exactamente el flete. Un renglón a costo 0 (bonificado) no
 * lleva flete.
 *
 * El flete es su NETO si la factura discrimina IVA (el IVA se recupera, no es
 * costo; misma regla que la mercadería) y su total si no. Sólo cuentan los
 * fletes VIGENTES: uno anulado deja de sumar.
 */
export const COSTO_UNITARIO_CON_FLETE_SQL = sql`(
  expense_items.unit_cost + COALESCE(
    (
      SELECT sum(CASE WHEN f.neto > 0 OR f.iva > 0 THEN f.neto ELSE f.total END)
        FROM expenses f
       WHERE f.flete_de_compra_id = expense_items.expense_id
         AND f.tenant_id = expense_items.tenant_id
         AND f.total > 0
         AND NOT EXISTS (SELECT 1 FROM expenses fc WHERE fc.corrects_id = f.id)
    ) * expense_items.unit_cost / NULLIF(
      (
        SELECT sum(i2.qty * i2.unit_cost)
          FROM expense_items i2
         WHERE i2.expense_id = expense_items.expense_id
           AND i2.tenant_id = expense_items.tenant_id
      ),
      0
    ),
    0
  )
)`;
