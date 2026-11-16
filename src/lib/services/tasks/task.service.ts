/**
 * Pendientes del comercio.
 *
 * Slice 2 de `RESEARCH-BRIEF-calendario-y-proyecciones.md`.
 *
 * ── ESTE SERVICE ESCRIBE UPDATE, Y ESO ES NUEVO ───────────────────────────
 * Todo lo demás que se construyó este mes es append-only. Acá no: un pendiente
 * es una intención, no un hecho. Ver el encabezado de la migration 0030 para
 * la decisión completa y lo que cuesta.
 *
 * ── LO QUE EL SISTEMA YA SABE NO SE GUARDA ────────────────────────────────
 * "Hay una caja abierta de un día anterior" NO se persiste como tarea: ya vive
 * en `cash_sessions` y una copia sólo puede desincronizarse. Se deriva al leer
 * (`derivarPendientes`) y se muestra SIN casilla: no se resuelve tachándolo, se
 * resuelve cerrando la caja.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  tasks,
  TASK_RECURRENCES,
  TASK_TYPES,
  type Task,
  type TaskRecurrence,
  type TaskType,
} from '../../db/schema/tasks.js';
import { proximaFecha } from '../../tasks/recurrencia.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { logger } from '../../observability/logger.js';
import { exigirQueOpereElComercio } from '../../auth/autorizacion.js';

export class TaskError extends DomainError {
  constructor(code: string, messageEs: string) {
    super(code, messageEs, 422);
  }
}

function ctx() {
  const c = requireTracingContext();
  if (!c.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'task.service (sin tenant en el context)'
    );
  }
  if (!c.actor_user_id) {
    throw new TaskError('no_actor', 'Hace falta un usuario identificado');
  }
  return { tenantId: c.tenant_id, userId: c.actor_user_id };
}

const TITULO_MAX = 200;

function limpiarTitulo(raw: string): string {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (t.length === 0) {
    throw new TaskError('titulo_vacio', 'Escribí qué hay que hacer');
  }
  if (t.length > TITULO_MAX) {
    throw new TaskError(
      'titulo_largo',
      `El título no puede pasar de ${TITULO_MAX} caracteres`
    );
  }
  return t;
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function validarFecha(iso: string | null | undefined, campo: string): string | null {
  if (iso === null || iso === undefined || iso === '') return null;
  if (!ES_FECHA.test(iso)) {
    throw new TaskError('fecha_invalida', `${campo} tiene que ser AAAA-MM-DD`);
  }
  return iso;
}

export interface NuevaTarea {
  titulo: string;
  detalle?: string;
  tipo?: TaskType;
  /** `AAAA-MM-DD` en la fecha del comercio. Nullable: "alguna vez". */
  due_date?: string | null;
  recurrencia?: TaskRecurrence | null;
}

export async function createTask(input: NuevaTarea): Promise<Task> {
  await exigirQueOpereElComercio();
  const { tenantId, userId } = ctx();

  const tipo = input.tipo ?? 'general';
  if (!TASK_TYPES.includes(tipo)) {
    throw new TaskError('tipo_invalido', 'Ese tipo de pendiente no existe');
  }

  const recurrencia = input.recurrencia ?? null;
  if (recurrencia !== null && !TASK_RECURRENCES.includes(recurrencia)) {
    throw new TaskError('recurrencia_invalida', 'Esa repetición no existe');
  }

  const due = validarFecha(input.due_date, 'La fecha');

  // El CHECK de la base dice lo mismo, pero un error de constraint le llega al
  // usuario como un choclo en inglés. Esto le dice qué le falta.
  if (recurrencia !== null && due === null) {
    throw new TaskError(
      'recurrencia_sin_fecha',
      'Para que se repita hace falta decir desde qué día'
    );
  }

  const [fila] = await db
    .insert(tasks)
    .values({
      tenant_id: tenantId,
      titulo: limpiarTitulo(input.titulo),
      detalle: input.detalle?.trim() || null,
      tipo,
      due_date: due,
      recurrencia,
      created_by: userId,
    })
    .returning();

  if (!fila) throw new Error('Insert de tarea no devolvio fila');
  logger.info({ task_id: fila.id, tipo, recurrencia }, 'task.created');
  return fila;
}

/**
 * Los pendientes abiertos.
 *
 * `NULLS LAST` a propósito: los que no tienen fecha van al final, después de
 * todo lo que sí vence. Sin eso Postgres los pone primero y la lista arranca
 * con lo menos urgente.
 */
export async function listOpenTasks(limite = 100): Promise<Task[]> {
  const { tenantId } = ctx();
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenant_id, tenantId), isNull(tasks.done_at)))
    .orderBy(sql`due_date ASC NULLS LAST`, asc(tasks.created_at))
    .limit(limite);
}

async function traerPropia(
  tx: typeof db,
  tenantId: string,
  id: string
): Promise<Task> {
  const [fila] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenant_id, tenantId), eq(tasks.id, id)))
    .limit(1);
  // Filtrar por tenant DENTRO del where (CLAUDE.md §7.2): un id de otro
  // comercio devuelve cero filas y termina acá, sin haber estado en memoria.
  if (!fila) throw new TaskError('not_found', 'Ese pendiente no existe');
  return fila;
}

/**
 * Tacha un pendiente.
 *
 * Si se repite, ADEMÁS crea la ocurrencia siguiente — en la misma transacción,
 * porque una tarea diaria tachada sin su sucesora desaparece de la lista para
 * siempre y nadie se entera hasta que falta.
 *
 * @param hoyLocal fecha del comercio (`AAAA-MM-DD`). Viene de afuera y no de
 *   `now()` porque el servidor corre en UTC: a las 21:30 de Ushuaia ya es el
 *   día siguiente, y una tarea diaria tachada a esa hora saltearía un día.
 */
export async function completeTask(id: string, hoyLocal: string): Promise<Task> {
  await exigirQueOpereElComercio();
  const { tenantId, userId } = ctx();
  const hoy = validarFecha(hoyLocal, 'La fecha de hoy');
  if (hoy === null) throw new TaskError('fecha_invalida', 'Falta la fecha de hoy');

  return db.transaction(async (tx) => {
    const actual = await traerPropia(tx as typeof db, tenantId, id);
    if (actual.done_at !== null) return actual; // idempotente: doble click

    let spawnedId: string | null = null;

    if (actual.recurrencia !== null && actual.due_date !== null) {
      const siguiente = proximaFecha(
        actual.due_date,
        actual.recurrencia as TaskRecurrence,
        hoy
      );
      const [hija] = await tx
        .insert(tasks)
        .values({
          tenant_id: tenantId,
          titulo: actual.titulo,
          detalle: actual.detalle,
          tipo: actual.tipo,
          due_date: siguiente,
          recurrencia: actual.recurrencia,
          created_by: userId,
        })
        .returning({ id: tasks.id });
      spawnedId = hija?.id ?? null;
    }

    const [fila] = await tx
      .update(tasks)
      .set({
        done_at: new Date(),
        done_by: userId,
        spawned_task_id: spawnedId,
        updated_at: new Date(),
      })
      .where(and(eq(tasks.tenant_id, tenantId), eq(tasks.id, id)))
      .returning();

    if (!fila) throw new Error('Update de tarea no devolvio fila');
    logger.info({ task_id: id, spawned_task_id: spawnedId }, 'task.completed');
    return fila;
  });
}

/**
 * Destacha un pendiente.
 *
 * Si al tacharlo se creó la ocurrencia siguiente, la borra — pero SÓLO si sigue
 * intacta. Si alguien ya la tachó, la reprogramó o le cambió el título, pasó a
 * ser suya y borrarla sería tirarle el trabajo.
 *
 * "Intacta" se mide como `updated_at = created_at`. Las dos columnas nacen del
 * mismo `DEFAULT now()` —que es el arranque de la transacción, así que dan
 * idéntico incluso cuando la hija se inserta junto con el UPDATE del padre— y
 * `updateTask` siempre pisa `updated_at`. Verificado contra la base antes de
 * apoyarse en esto.
 */
export async function uncompleteTask(id: string): Promise<Task> {
  await exigirQueOpereElComercio();
  const { tenantId } = ctx();

  return db.transaction(async (tx) => {
    const actual = await traerPropia(tx as typeof db, tenantId, id);
    if (actual.done_at === null) return actual; // idempotente

    if (actual.spawned_task_id !== null) {
      const borradas = await tx
        .delete(tasks)
        .where(
          and(
            eq(tasks.tenant_id, tenantId),
            eq(tasks.id, actual.spawned_task_id),
            isNull(tasks.done_at),
            eq(tasks.updated_at, tasks.created_at)
          )
        )
        .returning({ id: tasks.id });
      if (borradas.length === 0) {
        logger.info(
          { task_id: id, spawned_task_id: actual.spawned_task_id },
          'task.uncompleted.spawned_kept'
        );
      }
    }

    const [fila] = await tx
      .update(tasks)
      .set({ done_at: null, done_by: null, spawned_task_id: null, updated_at: new Date() })
      .where(and(eq(tasks.tenant_id, tenantId), eq(tasks.id, id)))
      .returning();

    if (!fila) throw new Error('Update de tarea no devolvio fila');
    logger.info({ task_id: id }, 'task.uncompleted');
    return fila;
  });
}

export interface CambiosTarea {
  titulo?: string;
  detalle?: string | null;
  tipo?: TaskType;
  due_date?: string | null;
  recurrencia?: TaskRecurrence | null;
}

/** Editar / reprogramar. */
export async function updateTask(id: string, cambios: CambiosTarea): Promise<Task> {
  await exigirQueOpereElComercio();
  const { tenantId } = ctx();

  const actual = await traerPropia(db, tenantId, id);

  const tipo = cambios.tipo ?? (actual.tipo as TaskType);
  if (!TASK_TYPES.includes(tipo)) {
    throw new TaskError('tipo_invalido', 'Ese tipo de pendiente no existe');
  }

  const recurrencia =
    cambios.recurrencia === undefined
      ? (actual.recurrencia as TaskRecurrence | null)
      : cambios.recurrencia;
  if (recurrencia !== null && !TASK_RECURRENCES.includes(recurrencia)) {
    throw new TaskError('recurrencia_invalida', 'Esa repetición no existe');
  }

  const due =
    cambios.due_date === undefined
      ? actual.due_date
      : validarFecha(cambios.due_date, 'La fecha');

  if (recurrencia !== null && due === null) {
    throw new TaskError(
      'recurrencia_sin_fecha',
      'Para que se repita hace falta decir desde qué día'
    );
  }

  const [fila] = await db
    .update(tasks)
    .set({
      titulo: cambios.titulo === undefined ? actual.titulo : limpiarTitulo(cambios.titulo),
      detalle:
        cambios.detalle === undefined ? actual.detalle : cambios.detalle?.trim() || null,
      tipo,
      due_date: due,
      recurrencia,
      updated_at: new Date(),
    })
    .where(and(eq(tasks.tenant_id, tenantId), eq(tasks.id, id)))
    .returning();

  if (!fila) throw new Error('Update de tarea no devolvio fila');
  logger.info({ task_id: id }, 'task.updated');
  return fila;
}

/**
 * Borra un pendiente.
 *
 * Existe —y en el resto del sistema no— porque un pendiente mal escrito no se
 * corrige registrando otro: se borra. No es un hecho contable.
 */
export async function deleteTask(id: string): Promise<void> {
  await exigirQueOpereElComercio();
  const { tenantId } = ctx();
  await traerPropia(db, tenantId, id);
  await db.delete(tasks).where(and(eq(tasks.tenant_id, tenantId), eq(tasks.id, id)));
  logger.info({ task_id: id }, 'task.deleted');
}
