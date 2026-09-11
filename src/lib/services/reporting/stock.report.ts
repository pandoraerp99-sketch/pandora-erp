/**
 * Días de stock restantes.
 *
 * Slice 3 de `RESEARCH-BRIEF-calendario-y-proyecciones.md`, primer bloque.
 * La lógica de clasificación y de umbrales vive en `lib/stock/dias-de-stock`,
 * que se prueba sin base. Acá está sólo lo que necesita SQL.
 *
 * ── POR QUE LA DIVISION SE HACE EN SQL ────────────────────────────────────
 * Es el único lugar donde esta cuenta puede romper, y en SQL el `nullif` que
 * lo evita se ve escrito. En JS la misma división da `Infinity`, que no falla,
 * no avisa y llega a la pantalla como "tenés de sobra".
 *
 * ── POR QUE LOS FILTROS NO SON LOS MISMOS QUE getStockBajo ────────────────
 * `getStockBajo` (la tarjeta Reponer) filtra por `stock_minimum IS NOT NULL`,
 * porque sin mínimo no hay con qué decir que algo está bajo. Acá ese filtro
 * NO va, y la diferencia importa: **20.001 de 20.009 productos de la base no
 * tienen mínimo cargado**. Un producto sin mínimo igual tiene velocidad, y
 * justamente para ése el número de días es lo único que avisa.
 *
 * Lo que sí se comparte es `stock_tracking_enabled`: un producto que no lleva
 * stock tiene `stock_current` en cero por no usarse, no por faltar — sin ese
 * filtro el bloque los clasificaría a todos como "sin stock".
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';
import { ventanaEfectiva } from '../../stock/dias-de-stock.js';
import { TZ_COMERCIO } from './panel.report.js';

function requireTenantId(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'stock.report (sin tenant en el context)'
    );
  }
  return ctx.tenant_id;
}

const VENTA_CERRADA = sql`commercial_status IN ('cobrada', 'terminada')`;

/**
 * Cuántos días de operación real tiene el comercio.
 *
 * Es la distancia desde la PRIMERA venta, no desde que se creó la empresa: un
 * comercio que cargó el catálogo en enero y empezó a vender en marzo tiene la
 * historia que dicen las ventas, no la que dice el alta.
 *
 * Devuelve 0 si no vendió nunca — y eso tiene que contestarse ANTES de
 * cualquier división.
 */
export async function getDiasDeHistoria(): Promise<number> {
  const tenantId = requireTenantId();
  const [fila] = await db.execute<{ dias: string | null }>(
    sql`SELECT (
          (now() AT TIME ZONE ${TZ_COMERCIO})::date
          - min((created_at AT TIME ZONE ${TZ_COMERCIO})::date)
          + 1
        )::text AS dias
        FROM sales
        WHERE tenant_id = ${tenantId} AND ${VENTA_CERRADA}`
  );
  // `min()` sobre cero filas devuelve NULL, y NULL - date da NULL: sin ventas,
  // no hay historia. El `?? '0'` NO es defensivo, es el caso del día 1.
  return Number(fila?.dias ?? '0') || 0;
}

export interface DiasDeStockFila {
  [k: string]: string | null;
  producto_id: string;
  nombre: string;
  /** Unidades. Texto porque la columna es numeric; no es plata. */
  stock: string;
  minimo: string | null;
  /** Unidades vendidas en la ventana. */
  vendido: string;
  /** Unidades por día. */
  velocidad: string;
  /** `null` cuando la velocidad es cero: no hay nada que dividir. */
  dias_restantes: string | null;
}

/**
 * Velocidad y días restantes por producto.
 *
 * @param diasDeHistoria el resultado de `getDiasDeHistoria()`. Se pasa en vez
 *   de recalcularlo adentro para que la ventana y la compuerta usen **el mismo
 *   número**: si cada uno midiera la historia por su lado podrían discrepar y
 *   el bloque mostraría un número gateado con un criterio y calculado con otro.
 */
export async function getDiasDeStock(diasDeHistoria: number): Promise<DiasDeStockFila[]> {
  const tenantId = requireTenantId();
  const ventana = ventanaEfectiva(diasDeHistoria);

  return db.execute<DiasDeStockFila>(
    sql`WITH vendido AS (
          SELECT si.product_id, sum(si.quantity) AS unidades
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          WHERE si.tenant_id = ${tenantId}
            AND s.tenant_id = ${tenantId}
            AND s.${VENTA_CERRADA}
            AND (s.created_at AT TIME ZONE ${TZ_COMERCIO})::date
                > (now() AT TIME ZONE ${TZ_COMERCIO})::date - ${ventana}::int
          GROUP BY si.product_id
        )
        SELECT p.id::text                              AS producto_id,
               p.name                                  AS nombre,
               p.stock_current::text                   AS stock,
               p.stock_minimum::text                   AS minimo,
               coalesce(v.unidades, 0)::numeric(19,4)::text AS vendido,
               (coalesce(v.unidades, 0) / ${ventana}::numeric)::text AS velocidad,
               -- La division que puede romper, con su nullif a la vista: si no
               -- vendio nada, no hay velocidad y esto es NULL, no infinito.
               (p.stock_current / nullif(
                  coalesce(v.unidades, 0) / ${ventana}::numeric, 0))::text
                                                       AS dias_restantes
        FROM products p
        LEFT JOIN vendido v ON v.product_id = p.id
        WHERE p.tenant_id = ${tenantId}
          AND p.is_active
          -- Sin esto, todo producto que no lleva stock entra como "sin stock".
          AND p.stock_tracking_enabled
        -- Primero lo que ya se acabo, despues lo que menos dura. NULLS LAST
        -- deja lo que no rota al final, que es donde tiene que estar.
        ORDER BY (p.stock_current <= 0) DESC,
                 (p.stock_current / nullif(
                    coalesce(v.unidades, 0) / ${ventana}::numeric, 0)) ASC NULLS LAST,
                 p.name`
  );
}
