/**
 * Margen bruto histórico — acceso a datos.
 *
 * Lee `sale_items.unit_cost_snapshot` (migration 0031): el costo que el
 * producto tenía cuando se vendió. La capa pura que decide qué se muestra y
 * qué no está en `src/lib/reporting/margen.ts`; acá sólo se junta el crudo.
 *
 * ── SOBRE QUÉ SE CALCULA ───────────────────────────────────────────────────
 * Sobre `line_subtotal`, que es el NETO de la línea — sin IVA. El IVA no es
 * ingreso del comercio: es plata que se cobra para depositar. Meterlo en el
 * numerador inflaría el margen ~21% de aire.
 *
 * ── LAS LÍNEAS SIN COSTO NO SE DESCARTAN ───────────────────────────────────
 * Las tres sumas salen de la MISMA pasada, y se devuelve tanto lo facturado
 * total como lo facturado que tiene costo. Filtrar las líneas sin costo en el
 * `WHERE` habría sido más corto y habría producido un número que parece
 * completo sin serlo: el `facturado_total` es justamente lo que permite decir
 * "esto cubre el 62%".
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';
import { TZ_COMERCIO } from './panel.report.js';
import type { CrudoMargen, CrudoProducto } from '../../reporting/margen.js';

function requireTenantId(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'margen.report (sin tenant en el context)'
    );
  }
  return ctx.tenant_id;
}

/** El mes corriente según el comercio, no según UTC. */
const DESDE_EL_MES = sql`(s.created_at AT TIME ZONE ${TZ_COMERCIO})::date
  >= date_trunc('month', (now() AT TIME ZONE ${TZ_COMERCIO}))::date`;

/** Una venta cuenta cuando está cobrada. Un carrito abandonado no es venta. */
const VENTA_CERRADA = sql`s.commercial_status IN ('cobrada', 'terminada')`;

export async function getMargenDelMes(): Promise<CrudoMargen> {
  const tenantId = requireTenantId();

  const [fila] = await db.execute<{
    facturado_total: string;
    facturado_con_costo: string;
    costo: string;
    lineas_total: string;
    lineas_con_costo: string;
  }>(
    // El `::numeric(19,4)::text` y no `::text` a secas: sin el cast explícito
    // un sum vacío sale como '0' en vez de '0.0000', y la escala deja de
    // coincidir con la de la columna.
    sql`SELECT
          coalesce(sum(si.line_subtotal), 0)::numeric(19,4)::text AS facturado_total,
          coalesce(sum(si.line_subtotal)
            FILTER (WHERE si.unit_cost_snapshot IS NOT NULL), 0
          )::numeric(19,4)::text AS facturado_con_costo,
          coalesce(sum(si.unit_cost_snapshot * si.quantity), 0
          )::numeric(19,4)::text AS costo,
          count(*)::text AS lineas_total,
          count(si.unit_cost_snapshot)::text AS lineas_con_costo
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE si.tenant_id = ${tenantId}
          AND ${VENTA_CERRADA}
          AND ${DESDE_EL_MES}`
  );

  return {
    facturado_total: fila?.facturado_total ?? '0.0000',
    facturado_con_costo: fila?.facturado_con_costo ?? '0.0000',
    costo: fila?.costo ?? '0.0000',
    lineas_total: Number(fila?.lineas_total ?? '0'),
    lineas_con_costo: Number(fila?.lineas_con_costo ?? '0'),
  };
}

/**
 * "Rentabilidad por producto" del mes, por facturación.
 *
 * ── POR QUÉ EL COSTO ES TODO-O-NADA POR PRODUCTO ───────────────────────────
 * Si un producto tiene la mitad de sus líneas con costo y la otra mitad sin,
 * sumar sólo las que tienen y dividir por TODO lo facturado daría un margen
 * falsamente bajo. Y dividir por la mitad con costo daría un porcentaje que no
 * se corresponde con los pesos facturados que se muestran en la misma fila.
 *
 * Así que el costo del producto se informa sólo cuando TODAS sus líneas del
 * período lo tienen (`count(*) = count(unit_cost_snapshot)`). Si no, va `null`
 * y la fila dice "sin costo cargado" — que es la verdad: de ese producto, en
 * este mes, no se puede afirmar un margen.
 *
 * El producto igual aparece en la lista, con lo facturado, que sí se sabe.
 */
export async function getRentabilidadPorProducto(
  limite = 6
): Promise<CrudoProducto[]> {
  const tenantId = requireTenantId();

  const filas = await db.execute<{
    product_id: string;
    nombre: string;
    facturado: string;
    costo: string | null;
  }>(
    sql`SELECT
          si.product_id,
          -- El nombre COMO SE VENDIÓ. Si el producto se renombró después, la
          -- fila sigue diciendo lo que decía el ticket.
          max(si.product_name_snapshot) AS nombre,
          sum(si.line_subtotal)::numeric(19,4)::text AS facturado,
          CASE WHEN count(*) = count(si.unit_cost_snapshot)
               THEN sum(si.unit_cost_snapshot * si.quantity)::numeric(19,4)::text
               ELSE NULL
          END AS costo
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE si.tenant_id = ${tenantId}
          AND ${VENTA_CERRADA}
          AND ${DESDE_EL_MES}
        GROUP BY si.product_id
        ORDER BY sum(si.line_subtotal) DESC
        LIMIT ${limite}`
  );

  return filas.map((f) => ({
    product_id: f.product_id,
    nombre: f.nombre,
    facturado: f.facturado,
    costo: f.costo,
  }));
}
