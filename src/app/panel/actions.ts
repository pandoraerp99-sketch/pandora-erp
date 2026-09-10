'use server';

/**
 * Server Actions del Panel — Pendientes.
 *
 * Mismo patrón que /gastos y /clientes: tracing + envelope, cero lógica de
 * negocio (vive en `task.service.ts`).
 *
 * ── POR QUE EL DIA VIAJA DESDE EL CLIENTE ─────────────────────────────────
 * `completarPendienteAction` recibe `hoyLocal`. Podría parecer que el servidor
 * lo sabe mejor, pero el servidor corre en UTC: a las 21:30 de Ushuaia `now()`
 * ya está en el día siguiente, y una tarea diaria tachada a esa hora saltearía
 * un día entero. El día del comercio lo calcula la página (Server Component,
 * con `Intl` y `TZ_COMERCIO`) y baja como prop — nunca con `new Date()` en el
 * navegador, que daría la fecha de la máquina del usuario.
 *
 * Es un dato de presentación, no de autoridad: lo peor que puede hacer un valor
 * falseado acá es correrle a ESE comercio la fecha de SU propia tarea.
 */
import { revalidatePath } from 'next/cache';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { DomainError } from '@/lib/multi_tenant/errors';
import {
  completeTask,
  createTask,
  deleteTask,
  uncompleteTask,
  updateTask,
  type CambiosTarea,
  type NuevaTarea,
} from '@/lib/services/tasks/task.service';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await withServerActionTracing(fn, { requireAuth: true });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DomainError) {
      return { ok: false, error: e.messageEs, code: e.code };
    }
    throw e;
  }
}

export async function crearPendienteAction(
  input: NuevaTarea
): Promise<ActionResult<null>> {
  return runAction(async () => {
    await createTask(input);
    revalidatePath('/panel');
    return null;
  });
}

export async function completarPendienteAction(
  id: string,
  hoyLocal: string
): Promise<ActionResult<null>> {
  return runAction(async () => {
    await completeTask(id, hoyLocal);
    revalidatePath('/panel');
    return null;
  });
}

export async function destacharPendienteAction(
  id: string
): Promise<ActionResult<null>> {
  return runAction(async () => {
    await uncompleteTask(id);
    revalidatePath('/panel');
    return null;
  });
}

export async function editarPendienteAction(
  id: string,
  cambios: CambiosTarea
): Promise<ActionResult<null>> {
  return runAction(async () => {
    await updateTask(id, cambios);
    revalidatePath('/panel');
    return null;
  });
}

export async function borrarPendienteAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await deleteTask(id);
    revalidatePath('/panel');
    return null;
  });
}
