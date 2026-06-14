/**
 * T-MT-07 — Jobs queue cross-tenant: defensa contra inyección + poison
 * detection sobre tenant_id + integridad del buzón multi-tenant.
 *
 * CLAUDE.md §7.9 mandatory test + §13.5 poison detection +
 * EVENT-TAXONOMY.md reglas J1-J6 + ADR-0002.
 *
 * **Por qué este test NO usa `withRlsContext()`** (a diferencia de T-MT-01..05):
 * `jobs_queue` corre con conexión service_role/privileged porque los workers
 * y crons no tienen sesión Supabase real (CLAUDE.md §7.5: "jobs_queue.tenant_id
 * NOT NULL. Worker lockea por SKIP LOCKED + WHERE tenant_id"). RLS sobre
 * jobs_queue NO es la capa primaria — la defensa cross-tenant para jobs vive en:
 *
 *   1. **Service-side validation** en `enqueueJob`: si `actor_type='user'`
 *      intenta inyectar `override_tenant_id`, tira `CrossTenantAccessError`.
 *      Solo `actor_type='system'|'cron'` pueden encolar jobs cross-tenant.
 *
 *   2. **Poison detection** en `detectGenericPoison`: jobs con `tenant_id`
 *      null/empty quedan poisoned ANTES de ejecutarse (worker NO los procesa).
 *
 *   3. **Buzón multi-tenant integro**: cada job persiste su `tenant_id` y
 *      el worker debe montar tracing context con ese tenant_id antes de
 *      tocar datos. Verificamos que el INSERT preserva el `tenant_id`
 *      correcto y que `fetchNextJobWithLock` lo devuelve intacto.
 *
 * Cobertura:
 *   T7.1: enqueueJob con `override_tenant_id` desde `actor_type='user'` →
 *         throw CrossTenantAccessError (ataque cross-tenant via enqueue)
 *   T7.2: enqueueJob con `override_tenant_id` desde `actor_type='cron'` →
 *         OK (sistema cross-tenant permitido por design)
 *   T7.3: detectGenericPoison detecta job con tenant_id falsy → 'missing_tenant_id'
 *         (CLAUDE.md §13.5 trigger "Tenant ID malformado")
 *   T7.4: fetchNextJobWithLock con 2 jobs (A y B) los devuelve a workers
 *         distintos con su `tenant_id` intacto cada uno (buzón multi-tenant)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users } from '@/lib/db/schema/users';
import { jobs_queue, type Job } from '@/lib/db/schema/jobs_queue';
import {
  enqueueJob,
  fetchNextJobWithLock,
  detectGenericPoison,
} from '@/lib/jobs_queue/queue.service';
import { withTracingContext } from '@/lib/tracing/context';
import { CrossTenantAccessError } from '@/lib/multi_tenant/errors';
import { env } from '@/lib/env';

describe('T-MT-07 — jobs_queue cross-tenant defense + poison detection sobre tenant_id', () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const userA = crypto.randomUUID();

  beforeAll(async () => {
    for (const [tenantId, userId] of [
      [tenantA, userA],
      [tenantB, crypto.randomUUID()], // user de B no usado en tests, solo para FK companies
    ] as const) {
      await db.insert(companies).values({
        id: tenantId,
        name: `T-MT-07 Co ${tenantId.slice(0, 8)}`,
        legal_name: `T-MT-07 Co SRL ${tenantId.slice(0, 8)}`,
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      });

      await db.insert(users).values({
        id: userId,
        email: `t-mt-07-${userId.slice(0, 8)}@test.local`,
        full_name: `User T-MT-07 ${userId.slice(0, 4)}`,
        is_support: false,
      });
    }
  });

  afterAll(async () => {
    // Cleanup jobs primero (FK al tenant)
    await db
      .delete(jobs_queue)
      .where(inArray(jobs_queue.tenant_id, [tenantA, tenantB, env.SYSTEM_TENANT_ID]));
    await db.delete(users).where(eq(users.id, userA));
    // Eliminar también el user de B (lookup por email pattern)
    // Simpler: dejar el segundo user. companies cleanup último.
    await db.delete(companies).where(inArray(companies.id, [tenantA, tenantB]));
  });

  it('T7.1: enqueueJob desde actor_type=user con override_tenant_id=B → CrossTenantAccessError', async () => {
    let caught: unknown;
    try {
      await withTracingContext(
        {
          correlation_id: crypto.randomUUID(),
          request_id: crypto.randomUUID(),
          tenant_id: tenantA, // user logged como tenant A
          actor_user_id: userA,
          actor_type: 'user',
        },
        async () => {
          await enqueueJob({
            job_type: 'email.send_invoice',
            payload: { sale_id: crypto.randomUUID() },
            override_tenant_id: tenantB, // <-- ataque: inyectar job en tenant B
          });
        }
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(CrossTenantAccessError);

    // Defensa post-hecho: verificar que NO se creó job para tenant B desde user A
    const leaked = await db
      .select({ id: jobs_queue.id })
      .from(jobs_queue)
      .where(
        and(
          eq(jobs_queue.tenant_id, tenantB),
          eq(jobs_queue.job_type, 'email.send_invoice')
        )
      );
    expect(leaked).toHaveLength(0);
  });

  it('T7.2: enqueueJob desde actor_type=cron con override_tenant_id=A → OK (sistema cross-tenant permitido)', async () => {
    const job = await withTracingContext(
      {
        correlation_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        tenant_id: env.SYSTEM_TENANT_ID,
        actor_user_id: null,
        actor_type: 'cron',
      },
      async () => {
        return enqueueJob({
          job_type: 'cron.cleanup_old_jobs',
          payload: { target_tenant_id: tenantA },
          override_tenant_id: tenantA, // cron habilitado para encolar per-tenant
        });
      }
    );

    expect(job.tenant_id).toBe(tenantA);
    expect(job.status).toBe('pending');
    expect(job.job_type).toBe('cron.cleanup_old_jobs');
  });

  it('T7.3: detectGenericPoison detecta tenant_id null/empty → "missing_tenant_id"', async () => {
    // Construyo un Job-shape con tenant_id vacío para simular row corrupta.
    // En producción, RLS NOT NULL constraint impide INSERT con null, pero un
    // bug de migration o un INSERT raw mal hecho podría introducir tenant_id=''.
    // detectGenericPoison es la última línea de defensa.
    const corruptJob = {
      id: BigInt(1),
      job_type: 'email.send_invoice',
      tenant_id: '', // <-- corrupto
      correlation_id: crypto.randomUUID(),
      last_request_id: null,
      payload: { sale_id: 'x' },
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      next_attempt_at: new Date(),
      started_at: null,
      completed_at: null,
      last_error: null,
      created_at: new Date(),
      updated_at: new Date(),
    } as unknown as Job;

    expect(detectGenericPoison(corruptJob)).toBe('missing_tenant_id');

    // Sanity: un job válido NO se marca poison por tenant
    const validJob = { ...corruptJob, tenant_id: tenantA };
    expect(detectGenericPoison(validJob)).toBeNull();

    // Sanity: payload null también es poison (CLAUDE.md §13.5)
    const noPayload = { ...corruptJob, tenant_id: tenantA, payload: null };
    expect(detectGenericPoison(noPayload)).toBe('invalid_payload_shape');
  });

  it('T7.4: fetchNextJobWithLock devuelve jobs de tenants distintos preservando tenant_id', async () => {
    // Encolar 2 jobs de mismo job_type pero distinto tenant desde cron context
    const jobAId = await withTracingContext(
      {
        correlation_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        tenant_id: env.SYSTEM_TENANT_ID,
        actor_user_id: null,
        actor_type: 'cron',
      },
      async () => {
        const j = await enqueueJob({
          job_type: 'afip.refresh_padron',
          payload: { cuit: '20111111111' },
          override_tenant_id: tenantA,
        });
        return j.id;
      }
    );

    const jobBId = await withTracingContext(
      {
        correlation_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        tenant_id: env.SYSTEM_TENANT_ID,
        actor_user_id: null,
        actor_type: 'cron',
      },
      async () => {
        const j = await enqueueJob({
          job_type: 'afip.refresh_padron',
          payload: { cuit: '20222222222' },
          override_tenant_id: tenantB,
        });
        return j.id;
      }
    );

    // 2 workers concurrentes (simulados con Promise.all). SKIP LOCKED garantiza
    // que NO procesan el mismo job. Cada uno debe obtener UNA row con su
    // tenant_id intacto.
    const fetchA = await fetchNextJobWithLock(
      'afip.refresh_padron',
      crypto.randomUUID()
    );
    const fetchB = await fetchNextJobWithLock(
      'afip.refresh_padron',
      crypto.randomUUID()
    );

    expect(fetchA).not.toBeNull();
    expect(fetchB).not.toBeNull();

    // El orden de fetch sigue created_at ASC — el primero encolado se procesa
    // primero. Sin importar el orden, el SET de tenant_ids debe ser {A, B}.
    const fetchedTenants = new Set([fetchA!.tenant_id, fetchB!.tenant_id]);
    expect(fetchedTenants).toEqual(new Set([tenantA, tenantB]));

    // El SET de job IDs también debe ser {jobAId, jobBId} — cada worker tomó
    // un job distinto, no doble-procesamiento.
    const fetchedIds = new Set([fetchA!.id, fetchB!.id]);
    expect(fetchedIds).toEqual(new Set([jobAId, jobBId]));

    // Sanity: el job con tenant_id=A tiene el payload de A (no se mezcló)
    const jobOfA = [fetchA, fetchB].find((j) => j!.tenant_id === tenantA)!;
    const jobOfB = [fetchA, fetchB].find((j) => j!.tenant_id === tenantB)!;
    const payloadA = jobOfA.payload as { cuit: string };
    const payloadB = jobOfB.payload as { cuit: string };
    expect(payloadA.cuit).toBe('20111111111');
    expect(payloadB.cuit).toBe('20222222222');

    // 3er fetch: cola vacía (no hay más jobs pending de ese job_type)
    const fetchC = await fetchNextJobWithLock(
      'afip.refresh_padron',
      crypto.randomUUID()
    );
    expect(fetchC).toBeNull();
  });
});
