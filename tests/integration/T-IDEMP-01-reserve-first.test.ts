/**
 * T-IDEMP-01 — withIdempotency reserve-first (ADR-0010 / T-SALES-03 diferido).
 *
 * El valor de idempotency SON estos tests de concurrencia: sin verificar el
 * comportamiento bajo requests duplicados/concurrentes contra la DB real, el
 * claim "dedup de mutaciones" no está probado.
 *
 * Lo que validamos (advisor steer):
 *  1. same key (secuencial)        → result cacheado, fn NO se re-ejecuta.
 *  2. different key                → fn se ejecuta de nuevo.
 *  3. concurrent same key          → EXACTAMENTE 1 ejecuta fn; el otro
 *                                     recibe IdempotencyInProgressError.
 *  4. misma key en 2 tenants       → aislado por UNIQUE (tenant_id, key) vía
 *                                     cliente privileged (NO prueba RLS).
 *  5. same key + distinto hash     → IdempotencyKeyReuseError.
 *  6. fn falla → row queda 'pending' (huérfano aceptable F0); retry con la
 *     misma key → InProgress (NO se libera la key — evita doble side effect).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { idempotency_log } from '@/lib/db/schema/idempotency_log';
import { withIdempotency } from '@/lib/idempotency/idempotency';
import {
  IdempotencyInProgressError,
  IdempotencyKeyReuseError,
} from '@/lib/multi_tenant/errors';

describe('T-IDEMP-01 — withIdempotency reserve-first', () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();

  const seedCompany = (id: string, tag: string) =>
    db.insert(companies).values({
      id,
      name: `T-IDEMP ${tag}`,
      legal_name: `T-IDEMP ${tag} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });

  beforeAll(async () => {
    await seedCompany(tenantA, 'A');
    await seedCompany(tenantB, 'B');
  });

  afterAll(async () => {
    // idempotency_log primero (FK ON DELETE RESTRICT a companies).
    await db.delete(idempotency_log).where(inArray(idempotency_log.tenant_id, [tenantA, tenantB]));
    await db.delete(companies).where(inArray(companies.id, [tenantA, tenantB]));
  });

  it('1. same key (secuencial) → result cacheado, fn NO se re-ejecuta', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return { v: 42 };
    };
    const key = crypto.randomUUID();

    const r1 = await withIdempotency(
      { tenantId: tenantA, key, operation: 'test.replay', requestHash: 'h' },
      fn
    );
    const r2 = await withIdempotency(
      { tenantId: tenantA, key, operation: 'test.replay', requestHash: 'h' },
      fn
    );

    expect(r1.replayed).toBe(false);
    expect(r1.result).toEqual({ v: 42 });
    expect(r2.replayed).toBe(true);
    expect(r2.result).toEqual({ v: 42 }); // round-trip jsonb
    expect(calls).toBe(1); // fn ejecutó UNA sola vez
  });

  it('2. different key → fn se ejecuta de nuevo', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return { n: calls };
    };

    await withIdempotency(
      { tenantId: tenantA, key: crypto.randomUUID(), operation: 'test.diff', requestHash: 'h' },
      fn
    );
    await withIdempotency(
      { tenantId: tenantA, key: crypto.randomUUID(), operation: 'test.diff', requestHash: 'h' },
      fn
    );

    expect(calls).toBe(2);
  });

  it('3. concurrent same key → exactamente 1 ejecuta fn; el otro InProgress', async () => {
    let calls = 0;
    // fn lento → el perdedor ve 'pending' de forma determinística.
    const slowFn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 150));
      return { ok: true };
    };
    const key = crypto.randomUUID();
    const params = { tenantId: tenantA, key, operation: 'test.concurrent', requestHash: 'h' };

    const results = await Promise.allSettled([
      withIdempotency(params, slowFn),
      withIdempotency(params, slowFn),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(calls).toBe(1); // ← el invariante: fn ejecutó UNA sola vez
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((fulfilled[0] as PromiseFulfilledResult<{ replayed: boolean }>).value.replayed).toBe(
      false
    );
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      IdempotencyInProgressError
    );
  });

  it('4. misma key en 2 tenants → ambos ejecutan (aislado por UNIQUE tenant_id+key)', async () => {
    // NOTA honesta: esto prueba aislamiento por el UNIQUE (tenant_id, key) con
    // el cliente PRIVILEGED (withIdempotency corre como el resto del service
    // layer, bypassa RLS). NO prueba aislamiento RLS — el helper nunca usa el
    // role `authenticated`. Un test de RLS-isolation sería con withRlsContext,
    // pero acá no aplica: el primitivo corre privileged por diseño.
    let calls = 0;
    const fn = async () => {
      calls++;
      return { tenant: calls };
    };
    const key = crypto.randomUUID(); // MISMA key en ambos tenants

    const rA = await withIdempotency(
      { tenantId: tenantA, key, operation: 'test.xtenant', requestHash: 'h' },
      fn
    );
    const rB = await withIdempotency(
      { tenantId: tenantB, key, operation: 'test.xtenant', requestHash: 'h' },
      fn
    );

    expect(rA.replayed).toBe(false);
    expect(rB.replayed).toBe(false);
    expect(calls).toBe(2); // sin colisión cross-tenant
  });

  it('5. same key + distinto request_hash → IdempotencyKeyReuseError', async () => {
    const key = crypto.randomUUID();

    await withIdempotency(
      { tenantId: tenantA, key, operation: 'test.reuse', requestHash: 'hashA' },
      async () => ({ v: 1 })
    );

    await expect(
      withIdempotency(
        { tenantId: tenantA, key, operation: 'test.reuse', requestHash: 'hashB' },
        async () => ({ v: 2 })
      )
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
  });

  it('6. fn falla → row queda pending; retry misma key → InProgress (no se libera)', async () => {
    const key = crypto.randomUUID();

    await expect(
      withIdempotency(
        { tenantId: tenantA, key, operation: 'test.fail', requestHash: 'h' },
        async () => {
          throw new Error('boom');
        }
      )
    ).rejects.toThrow('boom');

    // El row quedó 'pending' (huérfano aceptable F0). Retry con la MISMA key
    // NO re-ejecuta — el cliente debe usar una key nueva.
    let retried = false;
    await expect(
      withIdempotency(
        { tenantId: tenantA, key, operation: 'test.fail', requestHash: 'h' },
        async () => {
          retried = true;
          return { v: 1 };
        }
      )
    ).rejects.toBeInstanceOf(IdempotencyInProgressError);
    expect(retried).toBe(false);

    // Verificación directa: el row sigue 'pending'.
    const [row] = await db
      .select()
      .from(idempotency_log)
      .where(eq(idempotency_log.idempotency_key, key));
    expect(row?.status).toBe('pending');
  });

  it('7. releaseOnError=true: fn falla → row liberado; retry misma key → re-ejecuta OK', async () => {
    const key = crypto.randomUUID();

    // 1er intento falla → con releaseOnError, el row 'pending' se borra.
    await expect(
      withIdempotency(
        {
          tenantId: tenantA,
          key,
          operation: 'test.release',
          requestHash: 'h',
          releaseOnError: true,
        },
        async () => {
          throw new Error('transient');
        }
      )
    ).rejects.toThrow('transient');

    // El row fue liberado (NO quedó huérfano).
    const afterFail = await db
      .select({ id: idempotency_log.id })
      .from(idempotency_log)
      .where(eq(idempotency_log.idempotency_key, key));
    expect(afterFail).toHaveLength(0);

    // Retry con la MISMA key → re-clama y ejecuta (la key NO quedó envenenada).
    let retried = false;
    const r = await withIdempotency(
      {
        tenantId: tenantA,
        key,
        operation: 'test.release',
        requestHash: 'h',
        releaseOnError: true,
      },
      async () => {
        retried = true;
        return { v: 7 };
      }
    );
    expect(retried).toBe(true);
    expect(r.replayed).toBe(false);
    expect(r.result).toEqual({ v: 7 });

    const [completed] = await db
      .select({ status: idempotency_log.status })
      .from(idempotency_log)
      .where(eq(idempotency_log.idempotency_key, key));
    expect(completed?.status).toBe('completed');
  });
});
