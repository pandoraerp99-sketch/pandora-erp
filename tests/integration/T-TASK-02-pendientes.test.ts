/**
 * T-TASK-02 — pendientes del comercio.
 *
 * Lo que se protege acá:
 *
 *   1. que tachar una tarea que se repite deje la SIGUIENTE creada — una
 *      diaria tachada sin sucesora desaparece de la lista para siempre y nadie
 *      se entera hasta que falta
 *   2. que destachar (que casi siempre es "me equivoqué de fila") limpie esa
 *      sucesora en vez de dejar un duplicado suelto…
 *   3. …pero NO si alguien ya la tachó o la movió: ahí pasó a ser suya
 *   4. que un pendiente de otro comercio no exista para éste
 *   5. que la base rechace los estados imposibles aunque el service falle
 *
 * La aritmética de la recurrencia se prueba aparte y en serio, sin base, en
 * `tests/unit/tarea-recurrencia.test.ts` (T-TASK-01).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { tasks } from '@/lib/db/schema/tasks';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  completeTask,
  createTask,
  deleteTask,
  listOpenTasks,
  TaskError,
  uncompleteTask,
  updateTask,
} from '@/lib/services/tasks/task.service';

describe('T-TASK-02 — pendientes', () => {
  let tenantId: string;
  let otroTenant: string;
  let userId: string;

  const withCtx = <T,>(fn: () => Promise<T>, tid?: string): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid ?? tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        fn
      )
    );

  const crearCompany = async (id: string, n: number) => {
    await db.insert(companies).values({
      id,
      name: `T-TASK Co ${n}`,
      legal_name: `T-TASK Co ${n} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    otroTenant = crypto.randomUUID();
    userId = crypto.randomUUID();
    await crearCompany(tenantId, 1);
    await crearCompany(otroTenant, 2);
    await db.insert(users).values({
      id: userId,
      email: `t-task-${userId.slice(0, 8)}@test.local`,
      full_name: 'Dueño',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });
  });

  afterEach(async () => {
    const ids = [tenantId, otroTenant];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(tasks).where(inArray(tasks.tenant_id, ids));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  // ── Alta ────────────────────────────────────────────────────────────────

  it('crea un pendiente simple y aparece en la lista', async () => {
    await withCtx(() => createTask({ titulo: '  Llamar al   gasista  ' }));
    const abiertos = await withCtx(() => listOpenTasks());
    expect(abiertos.length).toBe(1);
    // El título se normaliza: sin espacios de más ni al principio ni adentro.
    expect(abiertos[0]?.titulo).toBe('Llamar al gasista');
    expect(abiertos[0]?.tipo).toBe('general');
    expect(abiertos[0]?.due_date).toBeNull();
  });

  it('un título en blanco no crea una fila fantasma', async () => {
    await expect(withCtx(() => createTask({ titulo: '   ' }))).rejects.toBeInstanceOf(
      TaskError
    );
    expect((await withCtx(() => listOpenTasks())).length).toBe(0);
  });

  it('pedir que se repita sin decir desde cuándo se rechaza con un mensaje leíble', async () => {
    await expect(
      withCtx(() => createTask({ titulo: 'Contar caja', recurrencia: 'diaria' }))
    ).rejects.toThrow(/desde qué día/);
  });

  it('los que no tienen fecha van DESPUES de los que vencen', async () => {
    await withCtx(() => createTask({ titulo: 'Sin fecha' }));
    await withCtx(() => createTask({ titulo: 'Vence pronto', due_date: '2026-09-15' }));
    const abiertos = await withCtx(() => listOpenTasks());
    // Sin el NULLS LAST explícito Postgres pone los NULL primero y la lista
    // arranca con lo menos urgente.
    expect(abiertos.map((t) => t.titulo)).toEqual(['Vence pronto', 'Sin fecha']);
  });

  // ── Tachar y la ocurrencia siguiente ────────────────────────────────────

  it('tachar una NO recurrente no crea nada nuevo', async () => {
    const t = await withCtx(() => createTask({ titulo: 'Comprar cinta' }));
    const hecha = await withCtx(() => completeTask(t.id, '2026-09-10'));
    expect(hecha.done_at).not.toBeNull();
    expect(hecha.done_by).toBe(userId);
    expect(hecha.spawned_task_id).toBeNull();
    expect((await withCtx(() => listOpenTasks())).length).toBe(0);
  });

  it('tachar una DIARIA deja la de mañana, y una sola', async () => {
    const t = await withCtx(() =>
      createTask({ titulo: 'Contar caja', tipo: 'caja', due_date: '2026-09-10', recurrencia: 'diaria' })
    );
    const hecha = await withCtx(() => completeTask(t.id, '2026-09-10'));

    const abiertos = await withCtx(() => listOpenTasks());
    expect(abiertos.length).toBe(1);
    expect(abiertos[0]?.due_date).toBe('2026-09-11');
    expect(abiertos[0]?.id).toBe(hecha.spawned_task_id);
    // La hija hereda tipo y recurrencia: si no, la cadena se corta al segundo día.
    expect(abiertos[0]?.tipo).toBe('caja');
    expect(abiertos[0]?.recurrencia).toBe('diaria');
  });

  it('tachar tarde NO acumula: vencía el viernes, se tachó el lunes → una sola, el martes', async () => {
    const t = await withCtx(() =>
      createTask({ titulo: 'Contar caja', due_date: '2026-09-11', recurrencia: 'diaria' })
    );
    await withCtx(() => completeTask(t.id, '2026-09-14'));
    const abiertos = await withCtx(() => listOpenTasks());
    expect(abiertos.length).toBe(1);
    expect(abiertos[0]?.due_date).toBe('2026-09-15');
  });

  it('tachar dos veces es lo mismo que tacharla una: no duplica la siguiente', async () => {
    const t = await withCtx(() =>
      createTask({ titulo: 'Contar caja', due_date: '2026-09-10', recurrencia: 'diaria' })
    );
    await withCtx(() => completeTask(t.id, '2026-09-10'));
    await withCtx(() => completeTask(t.id, '2026-09-10'));
    expect((await withCtx(() => listOpenTasks())).length).toBe(1);
  });

  // ── Destachar ───────────────────────────────────────────────────────────

  it('destachar limpia la siguiente si sigue intacta', async () => {
    const t = await withCtx(() =>
      createTask({ titulo: 'Contar caja', due_date: '2026-09-10', recurrencia: 'diaria' })
    );
    await withCtx(() => completeTask(t.id, '2026-09-10'));
    const vuelta = await withCtx(() => uncompleteTask(t.id));

    expect(vuelta.done_at).toBeNull();
    expect(vuelta.done_by).toBeNull();
    expect(vuelta.spawned_task_id).toBeNull();

    const abiertos = await withCtx(() => listOpenTasks());
    expect(abiertos.length).toBe(1);
    expect(abiertos[0]?.id).toBe(t.id);
  });

  it('destachar NO borra la siguiente si alguien ya la tachó', async () => {
    const t = await withCtx(() =>
      createTask({ titulo: 'Contar caja', due_date: '2026-09-10', recurrencia: 'diaria' })
    );
    const hecha = await withCtx(() => completeTask(t.id, '2026-09-10'));
    const hijaId = hecha.spawned_task_id!;
    await withCtx(() => completeTask(hijaId, '2026-09-11'));

    await withCtx(() => uncompleteTask(t.id));

    const hija = await db.select().from(tasks).where(eq(tasks.id, hijaId));
    // Sigue existiendo y sigue tachada: ese trabajo ya lo hizo alguien.
    expect(hija.length).toBe(1);
    expect(hija[0]?.done_at).not.toBeNull();
  });

  // ── Editar / reprogramar / borrar ───────────────────────────────────────

  it('reprogramar mueve la fecha sin tocar el resto', async () => {
    const t = await withCtx(() => createTask({ titulo: 'Pagar alquiler', due_date: '2026-09-10' }));
    const m = await withCtx(() => updateTask(t.id, { due_date: '2026-09-14' }));
    expect(m.due_date).toBe('2026-09-14');
    expect(m.titulo).toBe('Pagar alquiler');
    expect(m.updated_at.getTime()).toBeGreaterThanOrEqual(t.updated_at.getTime());
  });

  it('sacarle la fecha a una recurrente se rechaza: quedaría sin ancla', async () => {
    const t = await withCtx(() =>
      createTask({ titulo: 'Pagar alquiler', due_date: '2026-09-10', recurrencia: 'mensual' })
    );
    await expect(withCtx(() => updateTask(t.id, { due_date: null }))).rejects.toThrow(
      /desde qué día/
    );
  });

  it('un pendiente mal escrito se borra (no es un hecho contable)', async () => {
    const t = await withCtx(() => createTask({ titulo: 'aaaa' }));
    await withCtx(() => deleteTask(t.id));
    expect((await withCtx(() => listOpenTasks())).length).toBe(0);
  });

  // ── Aislamiento entre comercios ─────────────────────────────────────────

  it('un pendiente de otro comercio no existe para éste', async () => {
    const ajena = await withCtx(
      () => createTask({ titulo: 'Cosa del otro comercio' }),
      otroTenant
    );

    expect((await withCtx(() => listOpenTasks())).length).toBe(0);

    const intentos: Array<() => Promise<unknown>> = [
      () => completeTask(ajena.id, '2026-09-10'),
      () => uncompleteTask(ajena.id),
      () => updateTask(ajena.id, { titulo: 'secuestrada' }),
      () => deleteTask(ajena.id),
    ];
    for (const intento of intentos) {
      await expect(withCtx(intento)).rejects.toBeInstanceOf(TaskError);
    }

    // Y sigue intacta del otro lado.
    const sigue = await db.select().from(tasks).where(eq(tasks.id, ajena.id));
    expect(sigue[0]?.titulo).toBe('Cosa del otro comercio');
  });

  it('sin tenant en el context no se lee nada', async () => {
    await expect(
      Promise.resolve(
        withTracingContext(
          {
            correlation_id: generateCorrelationId(),
            request_id: generateRequestId(),
            tenant_id: null,
            actor_user_id: userId,
            actor_type: 'user',
          },
          () => listOpenTasks()
        )
      )
    ).rejects.toThrow();
  });

  // ── La base defiende sola ───────────────────────────────────────────────

  it('la base rechaza un done_at sin done_by, aunque el service se equivoque', async () => {
    const t = await withCtx(() => createTask({ titulo: 'Algo' }));
    await expect(
      db.execute(sql`UPDATE tasks SET done_at = now() WHERE id = ${t.id}`)
    ).rejects.toThrow();
  });

  it('la base rechaza una recurrencia inventada', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO tasks (tenant_id, titulo, due_date, recurrencia, created_by)
        VALUES (${tenantId}, 'Cada luna llena', '2026-09-10', 'lunar', ${userId})
      `)
    ).rejects.toThrow();
  });

  it('la base rechaza una recurrente sin fecha', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO tasks (tenant_id, titulo, recurrencia, created_by)
        VALUES (${tenantId}, 'Sin ancla', 'diaria', ${userId})
      `)
    ).rejects.toThrow();
  });
});
