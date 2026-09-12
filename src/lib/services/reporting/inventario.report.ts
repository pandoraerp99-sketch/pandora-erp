/**
 * Inventario de bienes de cambio valorizado al cierre — ítem 8 de la contadora.
 *
 * Textual del pedido: *"Inventario de bienes de cambio VALORIZADO al cierre
 * (fecha adq., detalle, importe de compra)"*.
 *
 * ── ES UNA FOTO A UNA FECHA, NO UN PERÍODO ────────────────────────────────
 * Los otros bloques de `/contador` son flujos (ventas del período, cobros,
 * gastos). Éste es un **saldo a un instante**, y por eso todo acá recibe una
 * `fechaCierre` y no un rango.
 *
 * ── EL STOCK SALE DEL LIBRO, NO DE `products.stock_current` ───────────────
 * `stock_current` es HOY; el cierre fue hace meses. La cantidad a la fecha se
 * reconstruye sumando los movimientos con su signo (`direction`, migration
 * 0032) hasta ese día. Que esa cuenta dé bien es lo que arregló la migration
 * 0035: antes, de 7 productos con movimientos, 7 no reconstruían.
 *
 * ── EL DÍA ES EL DEL COMERCIO ─────────────────────────────────────────────
 * La base corre en UTC: un movimiento de las 23:30 del 31/07 en Ushuaia es el
 * 01/08 en UTC y se caería del inventario del cierre. Misma regla que
 * `panel.report.ts`: toda frontera de tiempo pasa por `AT TIME ZONE`.
 *
 * La aritmética vive en `domain/inventario.ts` (pura, testeada aparte). Acá
 * sólo se lee y se arma.
 */
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '../../db/client.js';
import { GASTO_VIGENTE_SQL } from '../../db/schema/expenses.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';
import { TZ_COMERCIO } from './panel.report.js';
import { csvArmar, csvNum, csvTxt } from './csv.js';
import {
  valorizarProducto,
  METODO_VALUACION,
  type CompraDelProducto,
  type LoteValorizado,
} from '../../domain/inventario.js';

function requireTenantId(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'inventario.report (sin tenant en el context)'
    );
  }
  return ctx.tenant_id;
}

export interface FilaInventario {
  product_id: string;
  name: string;
  sku: string | null;
  /** Unidades a la fecha de cierre, según el libro. */
  cantidad: string;
  /** El `cost` del producto: declarado, no verificable contra un comprobante. */
  costo_declarado: string | null;
  lotes: LoteValorizado[];
  sin_compra_qty: string;
  sin_compra_total: string | null;
  con_compra_qty: string;
  con_compra_total: string;
  /** Lo valorizable de este producto. Parcial si `sin_valorizar_qty > 0`. */
  total: string;
  /** Unidades que quedaron afuera del total por no tener costo. */
  sin_valorizar_qty: string;
  /** Hay unidades sin compra y el producto no tiene costo cargado. */
  sin_costo: boolean;
  /** El libro da negativo. No debería pasar: se muestra, no se esconde. */
  anomalia: boolean;
}

export interface InventarioAlCierre {
  /** 'AAAA-MM-DD'. */
  fecha: string;
  /** El supuesto bajo el que se valorizó. Va en pantalla y en el CSV. */
  metodo: typeof METODO_VALUACION;
  filas: FilaInventario[];
  /** Unidades respaldadas por un comprobante de compra. */
  con_compra_total: string;
  /** Unidades al costo DECLARADO (no verificable contra un papel). */
  sin_compra_total: string;
  /**
   * El inventario valorizado. **Parcial** si `sin_valorizar_qty > 0`: quien lo
   * muestre tiene que decir cuántas unidades quedaron afuera, o el número miente
   * por omisión.
   */
  total: string;
  /** Unidades sin costo, que NO entran al total. */
  sin_valorizar_qty: string;
  /** Cuántos productos tienen unidades sin valorizar. */
  sin_valorizar_productos: number;
  /** Productos con stock que quedaron fuera por no llevar control de stock. */
  sin_tracking: number;
  /** Productos con unidades sin compra asociada. Siempre va a haber algunos. */
  con_unidades_sin_compra: number;
}

/**
 * El CSV que va al estudio: **una fila por lote**, que es como lo pide el
 * ítem 8 ("fecha adq., detalle, importe de compra").
 *
 * Las unidades sin compra van en su propia fila, marcadas como tales y con la
 * fecha vacía: poner ahí una fecha inventada sería exactamente lo que este
 * reporte vino a evitar. El método de valuación viaja en el encabezado, porque
 * un inventario sin método no se puede auditar.
 */
export function armarCsvInventario(inv: InventarioAlCierre): string {
  const filas: string[][] = [];

  for (const f of inv.filas) {
    for (const l of f.lotes) {
      filas.push([
        csvTxt(f.name),
        csvTxt(f.sku ?? ''),
        l.fecha,
        csvTxt(l.comprobante ?? ''),
        csvNum(l.qty),
        csvNum(l.unit_cost),
        csvNum(l.importe),
        'compra registrada',
      ]);
    }
    if (new Decimal(f.sin_compra_qty).gt(0)) {
      filas.push([
        csvTxt(f.name),
        csvTxt(f.sku ?? ''),
        // Sin fecha: no hay comprobante detrás. Inventar una es exactamente lo
        // que este reporte vino a evitar.
        '',
        '',
        csvNum(f.sin_compra_qty),
        f.costo_declarado === null ? '' : csvNum(f.costo_declarado),
        f.sin_compra_total === null ? '' : csvNum(f.sin_compra_total),
        f.sin_compra_total === null
          ? 'sin compra asociada y SIN COSTO: no valorizado'
          : 'sin compra asociada (costo declarado)',
      ]);
    }
  }

  return csvArmar(
    [
      `Inventario de bienes de cambio al ${inv.fecha} - metodo ${inv.metodo}`,
      'SKU',
      'Fecha de adquisicion',
      'Comprobante',
      'Cantidad',
      'Costo unitario',
      'Importe',
      'Origen',
    ],
    filas
  );
}

/**
 * El inventario a una fecha.
 *
 * @param fechaCierre 'AAAA-MM-DD' — el último día que entra.
 */
export async function getInventarioAlCierre(
  fechaCierre: string
): Promise<InventarioAlCierre> {
  const tenantId = requireTenantId();

  // (1) Cantidad por producto a la fecha, desde el libro.
  const cantidades = await db.execute<{
    product_id: string;
    name: string;
    sku: string | null;
    cost: string | null;
    cantidad: string;
  }>(sql`
    SELECT p.id::text        AS product_id,
           p.name,
           p.sku,
           p.cost::text      AS cost,
           COALESCE(SUM(
             CASE WHEN m.direction = 'in' THEN m.qty ELSE -m.qty END
           ), 0)::text       AS cantidad
      FROM products p
      LEFT JOIN stock_movements m
             ON m.product_id = p.id
            AND m.tenant_id = p.tenant_id
            AND (m.created_at AT TIME ZONE ${TZ_COMERCIO})::date <= ${fechaCierre}::date
     WHERE p.tenant_id = ${tenantId}
       AND p.stock_tracking_enabled
     GROUP BY p.id, p.name, p.sku, p.cost
     HAVING COALESCE(SUM(
              CASE WHEN m.direction = 'in' THEN m.qty ELSE -m.qty END
            ), 0) <> 0
     ORDER BY p.name
  `);

  // (2) Las compras vigentes hasta esa fecha, de la más nueva a la más vieja.
  //     Un gasto anulado no respalda nada: `GASTO_VIGENTE_SQL` lo saca.
  const compras = await db.execute<{
    product_id: string;
    fecha: string;
    qty: string;
    unit_cost: string;
    comprobante: string | null;
  }>(sql`
    SELECT expense_items.product_id::text AS product_id,
           expenses.fecha::text           AS fecha,
           expense_items.qty::text        AS qty,
           expense_items.unit_cost::text  AS unit_cost,
           COALESCE(
             NULLIF(TRIM(COALESCE(expenses.comprobante_tipo, '') || ' ' ||
                         COALESCE(expenses.comprobante_numero, '')), ''),
             expenses.payee_name
           ) AS comprobante
      FROM expense_items
      JOIN expenses ON expenses.id = expense_items.expense_id
     WHERE expense_items.tenant_id = ${tenantId}
       AND expenses.fecha <= ${fechaCierre}::date
       AND ${GASTO_VIGENTE_SQL}
     ORDER BY expenses.fecha DESC, expenses.created_at DESC, expense_items.linea DESC
  `);

  const comprasPorProducto = new Map<string, CompraDelProducto[]>();
  for (const c of compras) {
    const lista = comprasPorProducto.get(c.product_id) ?? [];
    lista.push({
      fecha: c.fecha,
      qty: c.qty,
      unit_cost: c.unit_cost,
      comprobante: c.comprobante,
    });
    comprasPorProducto.set(c.product_id, lista);
  }

  // (3) Los que no llevan control de stock quedan afuera, y se dice cuántos.
  //     `stock_current` ahí no está respaldado por el libro, así que no se
  //     puede reconstruir a una fecha pasada: valorizarlo sería meter en el
  //     total lo único que nadie puede auditar.
  const [sinTracking] = await db.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n
      FROM products
     WHERE tenant_id = ${tenantId}
       AND NOT stock_tracking_enabled
       AND stock_current <> 0
  `);

  const filas: FilaInventario[] = [];
  let conCompra = new Decimal(0);
  let sinCompra = new Decimal(0);
  let sinValorizar = new Decimal(0);
  let conSinCompra = 0;
  let sinValorizarProductos = 0;

  for (const p of cantidades) {
    const v = valorizarProducto({
      cantidad: p.cantidad,
      costoDeclarado: p.cost,
      compras: comprasPorProducto.get(p.product_id) ?? [],
      fechaCierre,
    });
    if (v.vacio) continue;

    filas.push({
      product_id: p.product_id,
      name: p.name,
      sku: p.sku,
      cantidad: new Decimal(p.cantidad).toFixed(4),
      costo_declarado: p.cost === null ? null : new Decimal(p.cost).toFixed(4),
      lotes: v.lotes,
      sin_compra_qty: v.sin_compra_qty,
      sin_compra_total: v.sin_compra_total,
      con_compra_qty: v.con_compra_qty,
      con_compra_total: v.con_compra_total,
      total: v.total,
      sin_valorizar_qty: v.sin_valorizar_qty,
      sin_costo: v.sin_costo,
      anomalia: v.anomalia,
    });

    conCompra = conCompra.plus(v.con_compra_total);
    sinCompra = sinCompra.plus(v.sin_compra_total ?? 0);
    if (new Decimal(v.sin_compra_qty).gt(0)) conSinCompra += 1;
    if (v.sin_costo || v.anomalia) {
      sinValorizar = sinValorizar.plus(v.sin_valorizar_qty);
      sinValorizarProductos += 1;
    }
  }

  return {
    fecha: fechaCierre,
    metodo: METODO_VALUACION,
    filas,
    con_compra_total: conCompra.toFixed(4),
    sin_compra_total: sinCompra.toFixed(4),
    total: conCompra.plus(sinCompra).toFixed(4),
    sin_valorizar_qty: sinValorizar.toFixed(4),
    sin_valorizar_productos: sinValorizarProductos,
    sin_tracking: Number(sinTracking?.n ?? '0'),
    con_unidades_sin_compra: conSinCompra,
  };
}
