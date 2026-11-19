/**
 * Fijo / variable / mixto de los gastos (migration 0045) — Compras y gastos,
 * V1 paso 1. Ver RESEARCH-BRIEF-costos-gastos-compras.md §3.
 *
 * La clasificación vive en `expense_cost_behaviour` (append-only): la vigente
 * es la más reciente, y un gasto sin fila usa el default de su categoría.
 *
 * El resumen por mes usa la MISMA base que la tarjeta "Por categoría" de
 * /gastos: lo GASTADO por fecha del gasto, pagado o no, total con IVA, sólo
 * gastos vigentes (los anulados no cuentan). Así los dos números de la misma
 * pantalla se pueden comparar. La mercadería queda afuera: es compra, no gasto
 * del mes.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '../../db/client.js';
import { expenses, GASTO_VIGENTE_SQL } from '../../db/schema/expenses.js';
import { expense_cost_behaviour } from '../../db/schema/expense_cost_behaviour.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { exigirQueOpereElComercio } from '../../auth/autorizacion.js';
import { isValidUuid } from '../../tracing/ids.js';
import { logger } from '../../observability/logger.js';
import {
  COMPORTAMIENTOS,
  comportamientoEfectivo,
  seClasifica,
  type Comportamiento,
} from '../../domain/comportamiento-costo.js';
import { mesesDelComercio } from '../../domain/fecha-comercio.js';

export class CostBehaviourError extends DomainError {
  constructor(code: string, messageEs: string, status = 422) {
    super(code, messageEs, status);
  }
}

function ctx() {
  const c = requireTracingContext();
  if (!c.tenant_id) {
    throw new CrossTenantAccessError('desconocido', null, 'cost-behaviour (sin tenant)');
  }
  return { tenantId: c.tenant_id, userId: c.actor_user_id ?? null };
}

/**
 * Cambia la clasificación de un gasto ya cargado. Agrega una fila; no edita
 * nada. Si el gasto ya tiene ese valor (explícito o por su categoría), no hace
 * nada: un doble click no ensucia la historia.
 */
export async function clasificarGasto(
  expenseId: string,
  comportamiento: string
): Promise<{ cambiado: boolean }> {
  await exigirQueOpereElComercio();
  const { tenantId, userId } = ctx();
  if (!userId) throw new CostBehaviourError('no_actor', 'Hace falta un usuario identificado');
  if (!isValidUuid(expenseId)) throw new CostBehaviourError('invalid_expense', 'Gasto no válido');
  if (!(COMPORTAMIENTOS as readonly string[]).includes(comportamiento)) {
    throw new CostBehaviourError('comportamiento_invalido', 'Elegí fijo, variable o mixto');
  }

  return db.transaction(async (tx) => {
    const [g] = await tx
      .select({ id: expenses.id, categoria: expenses.categoria })
      .from(expenses)
      .where(and(eq(expenses.tenant_id, tenantId), eq(expenses.id, expenseId), GASTO_VIGENTE_SQL))
      .limit(1);
    if (!g) throw new CostBehaviourError('expense_not_found', 'Ese gasto no existe o está anulado', 404);
    if (!seClasifica(g.categoria)) {
      throw new CostBehaviourError(
        'comportamiento_no_aplica',
        'La mercadería no se clasifica como fijo o variable: es una compra que va al stock'
      );
    }
    const [ultima] = await tx
      .select({ comportamiento: expense_cost_behaviour.comportamiento })
      .from(expense_cost_behaviour)
      .where(
        and(
          eq(expense_cost_behaviour.tenant_id, tenantId),
          eq(expense_cost_behaviour.expense_id, expenseId)
        )
      )
      .orderBy(desc(expense_cost_behaviour.created_at))
      .limit(1);
    if (comportamientoEfectivo(g.categoria, ultima?.comportamiento ?? null) === comportamiento) {
      return { cambiado: false };
    }
    await tx.insert(expense_cost_behaviour).values({
      tenant_id: tenantId,
      expense_id: expenseId,
      comportamiento,
      created_by: userId,
    });
    logger.info({ expense_id: expenseId, comportamiento }, 'expense.cost_behaviour.changed');
    return { cambiado: true };
  });
}

/** La clasificación explícita vigente de cada gasto pedido (los sin fila no aparecen). */
export async function clasificacionesExplicitas(
  expenseIds: string[]
): Promise<Map<string, Comportamiento>> {
  const { tenantId } = ctx();
  const ids = expenseIds.filter(isValidUuid);
  if (ids.length === 0) return new Map();
  const filas = await db
    .selectDistinctOn([expense_cost_behaviour.expense_id], {
      expense_id: expense_cost_behaviour.expense_id,
      comportamiento: expense_cost_behaviour.comportamiento,
    })
    .from(expense_cost_behaviour)
    .where(
      and(
        eq(expense_cost_behaviour.tenant_id, tenantId),
        inArray(expense_cost_behaviour.expense_id, ids)
      )
    )
    .orderBy(expense_cost_behaviour.expense_id, desc(expense_cost_behaviour.created_at));
  return new Map(filas.map((f) => [f.expense_id, f.comportamiento as Comportamiento]));
}

export interface MesFijosVariables {
  /** 'AAAA-MM' */
  mes: string;
  fijo: string;
  variable: string;
  mixto: string;
  /** Gastos sin valor explícito ni default de categoría (impuestos, otros). */
  sin_clasificar: string;
  cantidad_sin_clasificar: number;
  total: string;
}

/**
 * Los últimos `meses` meses (incluido el actual, en el calendario del
 * comercio), cada uno con lo gastado fijo / variable / mixto / sin clasificar.
 * Siempre devuelve los `meses` meses, aunque alguno esté en cero: un mes sin
 * gastos no es lo mismo que un mes que falta.
 */
export async function getFijosVariablesPorMes(
  meses = 6,
  ahora: Date = new Date()
): Promise<MesFijosVariables[]> {
  const { tenantId } = ctx();
  const lista = mesesDelComercio(meses, ahora); // ['AAAA-MM', ...] del más viejo al actual
  const desde = `${lista[0]}-01`;
  const [y, m] = (lista[lista.length - 1] as string).split('-').map(Number) as [number, number];
  const hasta = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  const filas = await db.execute<{
    mes: string;
    categoria: string;
    explicito: string | null;
    total: string;
    cantidad: number;
  }>(sql`
    SELECT to_char(e.fecha, 'YYYY-MM') AS mes,
           e.categoria,
           cb.comportamiento AS explicito,
           sum(e.total)::text AS total,
           count(*)::int AS cantidad
      FROM expenses e
      LEFT JOIN LATERAL (
        SELECT b.comportamiento FROM expense_cost_behaviour b
         WHERE b.expense_id = e.id AND b.tenant_id = e.tenant_id
         ORDER BY b.created_at DESC LIMIT 1
      ) cb ON true
     WHERE e.tenant_id = ${tenantId}
       AND e.fecha >= ${desde}::date AND e.fecha < ${hasta}::date
       AND e.categoria <> 'mercaderia'
       AND e.total > 0
       AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.corrects_id = e.id)
     GROUP BY 1, 2, 3`);

  const vacio = () => ({
    fijo: new Decimal(0),
    variable: new Decimal(0),
    mixto: new Decimal(0),
    sin: new Decimal(0),
    nSin: 0,
  });
  const acc = new Map(lista.map((mes) => [mes, vacio()]));
  for (const f of filas) {
    const a = acc.get(f.mes);
    if (!a) continue;
    const c = comportamientoEfectivo(f.categoria, f.explicito);
    const monto = new Decimal(f.total);
    if (c === 'fijo') a.fijo = a.fijo.plus(monto);
    else if (c === 'variable') a.variable = a.variable.plus(monto);
    else if (c === 'mixto') a.mixto = a.mixto.plus(monto);
    else {
      a.sin = a.sin.plus(monto);
      a.nSin += Number(f.cantidad);
    }
  }
  return lista.map((mes) => {
    const a = acc.get(mes)!;
    return {
      mes,
      fijo: a.fijo.toFixed(2),
      variable: a.variable.toFixed(2),
      mixto: a.mixto.toFixed(2),
      sin_clasificar: a.sin.toFixed(2),
      cantidad_sin_clasificar: a.nSin,
      total: a.fijo.plus(a.variable).plus(a.mixto).plus(a.sin).toFixed(2),
    };
  });
}

export interface MemoriaProveedor {
  categoria: string;
  /** Fijo / variable / mixto que valía en ese último gasto; null si no tenía. */
  comportamiento: Comportamiento | null;
}

/**
 * Lo que se usó la ÚLTIMA vez con cada proveedor: categoría y fijo/variable.
 *
 * Es la memoria del alta: al elegir un proveedor que ya se usó, el formulario
 * completa solo la categoría y el tipo (pedido del owner, 2026-11-19: "que se
 * autocomplete y se asigne solo"). Sale del último gasto VIGENTE cargado con
 * ese proveedor, por fecha de carga. No es una tabla de reglas: si una vez la
 * luz se cargó como "Otros", la próxima propone "Otros", y corregirlo una vez
 * alcanza para que la siguiente proponga lo nuevo.
 *
 * El fijo/variable es el que VALÍA en ese gasto: el elegido a mano (la última
 * fila de `expense_cost_behaviour`) o, si no se eligió, el de su categoría.
 */
export async function memoriaPorProveedor(): Promise<Record<string, MemoriaProveedor>> {
  const { tenantId } = ctx();
  const filas = await db.execute<{
    tercero_id: string;
    categoria: string;
    explicito: string | null;
  }>(sql`
    SELECT DISTINCT ON (e.tercero_id)
           e.tercero_id::text AS tercero_id,
           e.categoria,
           cb.comportamiento AS explicito
      FROM expenses e
      LEFT JOIN LATERAL (
        SELECT b.comportamiento FROM expense_cost_behaviour b
         WHERE b.expense_id = e.id AND b.tenant_id = e.tenant_id
         ORDER BY b.created_at DESC LIMIT 1
      ) cb ON true
     WHERE e.tenant_id = ${tenantId}
       AND e.tercero_id IS NOT NULL
       AND e.total > 0
       AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.corrects_id = e.id)
     ORDER BY e.tercero_id, e.created_at DESC`);
  const out: Record<string, MemoriaProveedor> = {};
  for (const f of filas) {
    out[f.tercero_id] = {
      categoria: f.categoria,
      comportamiento: seClasifica(f.categoria)
        ? comportamientoEfectivo(f.categoria, f.explicito)
        : null,
    };
  }
  return out;
}
