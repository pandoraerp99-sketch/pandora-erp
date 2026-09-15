/**
 * Merma y valor del stock — acceso a datos (RESEARCH-BRIEF-panel §8.e).
 *
 * Junta el crudo; lo que se puede afirmar lo decide `src/lib/reporting/merma.ts`.
 *
 * ── "CON MOTIVO" = LO DECLARÓ UNA PERSONA ──────────────────────────────────
 * `stock_movements.motivo` (migration 0038) sólo lo escribe `adjustStock`, el
 * ajuste a mano desde Productos (verificado con
 * `scripts/origenes-motivo-y-fecha.sh`). Los movimientos que genera el sistema
 * lo dejan en NULL y su origen está en su vínculo:
 *
 *   - el STOCK INICIAL del alta es `adjustment` sin motivo (migration 0035);
 *   - la salida de una COMPRA ANULADA es `adjustment` sin motivo, con
 *     `related_expense_id`.
 *
 * Contar `type = 'adjustment'` a secas mostraría la carga del catálogo como
 * "correcciones" (en la base de dev: 7 filas, 149 unidades). Por eso las
 * correcciones se filtran por motivo. Si alguna vez otro camino empieza a
 * escribir `motivo`, esta regla deja de ser cierta: revisar acá.
 *
 * ── EL MES ES EL DEL COMERCIO, POR `fecha` ─────────────────────────────────
 * `fecha` es el día en que el movimiento PASÓ (migration 0037), NOT NULL con
 * default en hora de Ushuaia. Se acota por los dos lados: un movimiento con
 * fecha del mes que viene no es merma de este.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';
import { TZ_COMERCIO } from './panel.report.js';
import type {
  CrudoMermaMotivo,
  CrudoMermaProducto,
  CrudoValorStock,
} from '../../reporting/merma.js';

function requireTenantId(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'merma.report (sin tenant en el context)'
    );
  }
  return ctx.tenant_id;
}

const INICIO_MES = sql`date_trunc('month', (now() AT TIME ZONE ${TZ_COMERCIO}))::date`;
const DEL_MES = sql`m.fecha >= ${INICIO_MES} AND m.fecha < (${INICIO_MES} + interval '1 month')::date`;

export interface CrudoMermaDelMes {
  motivos: CrudoMermaMotivo[];
  productos: CrudoMermaProducto[];
  /** Correcciones declaradas (recuento / error de carga / otro), por motivo. */
  correcciones: Array<{ motivo: string; filas: number }>;
}

export async function getMermaDelMes(): Promise<CrudoMermaDelMes> {
  const tenantId = requireTenantId();

  const [motivos, productos, correcciones] = await Promise.all([
    db.execute<{
      motivo: string;
      unidades: string;
      unidades_sin_costo: string;
      costo: string;
      filas: string;
    }>(
      sql`SELECT m.motivo,
            sum(m.qty)::numeric(19,4)::text AS unidades,
            coalesce(sum(m.qty) FILTER (WHERE p.cost IS NULL), 0)::numeric(19,4)::text
              AS unidades_sin_costo,
            coalesce(sum(m.qty * p.cost) FILTER (WHERE p.cost IS NOT NULL), 0)::numeric(19,4)::text
              AS costo,
            count(*)::text AS filas
          FROM stock_movements m
          JOIN products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
          WHERE m.tenant_id = ${tenantId}
            AND m.type = 'loss'
            AND ${DEL_MES}
          GROUP BY m.motivo`
    ),
    db.execute<{ product_id: string; nombre: string; unidades: string; costo: string | null }>(
      sql`SELECT p.id::text AS product_id,
            p.name AS nombre,
            sum(m.qty)::numeric(19,4)::text AS unidades,
            CASE WHEN p.cost IS NULL THEN NULL
                 ELSE (sum(m.qty) * p.cost)::numeric(19,4)::text
            END AS costo
          FROM stock_movements m
          JOIN products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
          WHERE m.tenant_id = ${tenantId}
            AND m.type = 'loss'
            AND ${DEL_MES}
          GROUP BY p.id, p.name, p.cost`
    ),
    db.execute<{ motivo: string; filas: string }>(
      sql`SELECT m.motivo, count(*)::text AS filas
          FROM stock_movements m
          WHERE m.tenant_id = ${tenantId}
            AND m.type = 'adjustment'
            AND m.motivo IS NOT NULL
            AND ${DEL_MES}
          GROUP BY m.motivo
          ORDER BY count(*) DESC, m.motivo`
    ),
  ]);

  return {
    motivos: motivos.map((f) => ({
      motivo: f.motivo,
      unidades: f.unidades,
      unidades_sin_costo: f.unidades_sin_costo,
      costo: f.costo,
      filas: Number(f.filas),
    })),
    // La capa pura ordena y recorta: acá van todos, para que el orden de los
    // sin costo lo decida un solo lugar.
    productos: productos.map((f) => ({
      product_id: f.product_id,
      nombre: f.nombre,
      unidades: f.unidades,
      costo: f.costo,
    })),
    correcciones: correcciones.map((f) => ({ motivo: f.motivo, filas: Number(f.filas) })),
  };
}

/**
 * Plata quieta en góndola, a costo de última compra.
 *
 * Productos activos, con control de stock y stock > 0. Un producto sin control
 * de stock (un servicio) no tiene unidades que valorizar, y uno dado de baja no
 * está en góndola.
 */
export async function getValorStock(): Promise<CrudoValorStock> {
  const tenantId = requireTenantId();
  const [fila] = await db.execute<{
    valor: string;
    productos_con_stock: string;
    productos_sin_costo: string;
  }>(
    sql`SELECT
          coalesce(sum(stock_current * cost) FILTER (WHERE cost IS NOT NULL), 0)::numeric(19,4)::text
            AS valor,
          count(*)::text AS productos_con_stock,
          count(*) FILTER (WHERE cost IS NULL)::text AS productos_sin_costo
        FROM products
        WHERE tenant_id = ${tenantId}
          AND is_active
          AND stock_tracking_enabled
          AND stock_current > 0`
  );
  return {
    valor: fila?.valor ?? '0.0000',
    productos_con_stock: Number(fila?.productos_con_stock ?? '0'),
    productos_sin_costo: Number(fila?.productos_sin_costo ?? '0'),
  };
}
