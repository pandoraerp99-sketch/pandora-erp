/**
 * Tests unitarios tracing context + ids + cron/worker tracing helpers.
 *
 * Cubre:
 * - generateCorrelationId / generateRequestId: UUID v4 format + entropy
 * - isValidUuid: case-insensitive + rechazos
 * - withTracingContext + accessors: get/require + null cases
 * - Aislamiento entre runs paralelos (AsyncLocalStorage invariante)
 * - Heredancia en awaits internos (AsyncLocalStorage funciona con promesas)
 * - withCronTracing: nuevo correlation_id + nuevo request_id + actor=cron + tenant=null
 * - withWorkerTracing: HEREDA correlation_id (no genera) + GENERA request_id + actor=worker
 *
 * NO cubre withServerActionTracing (requiere mockear next/headers + auth/session;
 * va a integration tests cuando exista test app).
 */
import { describe, expect, it } from 'vitest';
import {
  getCurrentActor,
  getCurrentCorrelationId,
  getCurrentRequestId,
  getCurrentTenantId,
  getTracingContext,
  requireTenantId,
  requireTracingContext,
  withTracingContext,
} from '@/lib/tracing/context';
import {
  generateCorrelationId,
  generateRequestId,
  isValidUuid,
  resolveInboundIds,
  UUID_REGEX,
} from '@/lib/tracing/ids';
import {
  withCronTracing,
  withWorkerTracing,
} from '@/lib/tracing/server-action-tracing';

describe('ids — generateCorrelationId + generateRequestId', () => {
  it('generateCorrelationId devuelve UUID v4 valido', () => {
    const id = generateCorrelationId();
    expect(UUID_REGEX.test(id)).toBe(true);
  });

  it('generateRequestId devuelve UUID v4 valido', () => {
    const id = generateRequestId();
    expect(UUID_REGEX.test(id)).toBe(true);
  });

  it('100 correlation_ids distintos (sanity entropy)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateCorrelationId());
    expect(set.size).toBe(100);
  });

  it('100 request_ids distintos (sanity entropy)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateRequestId());
    expect(set.size).toBe(100);
  });
});

describe('ids — isValidUuid', () => {
  it('acepta UUID v4 lowercase', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('acepta UUID v4 uppercase (case-insensitive)', () => {
    expect(isValidUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('acepta UUID v4 mixed-case', () => {
    expect(isValidUuid('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
  });

  it('rechaza string vacio', () => {
    expect(isValidUuid('')).toBe(false);
  });

  it('rechaza string sin guiones', () => {
    expect(isValidUuid('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('rechaza string con caracteres no-hex', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-XXXXXXXXXXXX')).toBe(false);
  });

  it('rechaza string mas corto', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716')).toBe(false);
  });

  it('rechaza string mas largo', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
  });
});

describe('ids — resolveInboundIds (trust boundary)', () => {
  const validCid = '550e8400-e29b-41d4-a716-446655440000';
  const validRid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

  it('ambos validos → respeta los entrantes (no genera nuevos)', () => {
    const result = resolveInboundIds(validCid, validRid);
    expect(result.correlation_id).toBe(validCid);
    expect(result.request_id).toBe(validRid);
  });

  it('cid invalido + rid valido → genera cid nuevo, respeta rid', () => {
    const result = resolveInboundIds('garbage-not-uuid', validRid);
    expect(result.correlation_id).not.toBe('garbage-not-uuid');
    expect(isValidUuid(result.correlation_id)).toBe(true);
    expect(result.request_id).toBe(validRid);
  });

  it('cid valido + rid invalido → respeta cid, genera rid nuevo', () => {
    const result = resolveInboundIds(validCid, 'not-a-uuid-at-all');
    expect(result.correlation_id).toBe(validCid);
    expect(result.request_id).not.toBe('not-a-uuid-at-all');
    expect(isValidUuid(result.request_id)).toBe(true);
  });

  it('ambos null → genera ambos UUID v4 validos', () => {
    const result = resolveInboundIds(null, null);
    expect(isValidUuid(result.correlation_id)).toBe(true);
    expect(isValidUuid(result.request_id)).toBe(true);
  });

  it('ambos undefined → genera ambos UUID v4 validos', () => {
    const result = resolveInboundIds(undefined, undefined);
    expect(isValidUuid(result.correlation_id)).toBe(true);
    expect(isValidUuid(result.request_id)).toBe(true);
  });

  it('string vacio se trata como invalido → genera nuevo', () => {
    const result = resolveInboundIds('', '');
    expect(result.correlation_id).not.toBe('');
    expect(result.request_id).not.toBe('');
    expect(isValidUuid(result.correlation_id)).toBe(true);
    expect(isValidUuid(result.request_id)).toBe(true);
  });

  // Sprint 2 #3: flags *_was_generated para que proxy Edge pueda emitir
  // `x-correlation-id-generated: true` y warning logs para detectar clientes
  // que olvidan setear el header.

  it('ambos validos → flags was_generated = false', () => {
    const result = resolveInboundIds(validCid, validRid);
    expect(result.correlation_was_generated).toBe(false);
    expect(result.request_was_generated).toBe(false);
  });

  it('cid invalido → correlation_was_generated = true', () => {
    const result = resolveInboundIds('garbage', validRid);
    expect(result.correlation_was_generated).toBe(true);
    expect(result.request_was_generated).toBe(false);
  });

  it('rid null → request_was_generated = true (cid valido respetado)', () => {
    const result = resolveInboundIds(validCid, null);
    expect(result.correlation_was_generated).toBe(false);
    expect(result.request_was_generated).toBe(true);
  });

  it('ambos null → ambos was_generated = true', () => {
    const result = resolveInboundIds(null, null);
    expect(result.correlation_was_generated).toBe(true);
    expect(result.request_was_generated).toBe(true);
  });

  it('cid garbage como `<script>alert(1)</script>` → genera + flag true (XSS-safe)', () => {
    // Sin validacion UUID, esto se propagaria literal a x-correlation-id
    // response header + logs. Trust boundary check previene.
    const result = resolveInboundIds('<script>alert(1)</script>', validRid);
    expect(result.correlation_id).not.toContain('<script>');
    expect(result.correlation_was_generated).toBe(true);
    expect(isValidUuid(result.correlation_id)).toBe(true);
  });
});

describe('TracingContext — basics', () => {
  it('getTracingContext() fuera de un run → undefined', () => {
    // No envolvemos en withTracingContext — debe ser undefined
    expect(getTracingContext()).toBeUndefined();
  });

  it('getTracingContext() dentro de un run → devuelve el ctx', () => {
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-abc',
      actor_user_id: 'user-123',
      actor_type: 'user' as const,
    };
    const result = withTracingContext(ctx, () => getTracingContext());
    expect(result).toEqual(ctx);
  });

  it('requireTracingContext() fuera de un run → throw', () => {
    expect(() => requireTracingContext()).toThrow(/no esta inicializado/);
  });

  it('requireTracingContext() dentro de un run → devuelve el ctx', () => {
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-xyz',
      actor_user_id: null,
      actor_type: 'system' as const,
    };
    const result = withTracingContext(ctx, () => requireTracingContext());
    expect(result).toEqual(ctx);
  });

  it('withTracingContext anidado → el inner gana', () => {
    const outer = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-outer',
      actor_user_id: null,
      actor_type: 'system' as const,
    };
    const inner = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-inner',
      actor_user_id: null,
      actor_type: 'worker' as const,
    };
    // Cast: withTracingContext devuelve T | Promise<T>; aca fn es sync,
    // el return es sync, pero TS no narrowa el overload sin runtime check.
    const result = withTracingContext(outer, () =>
      withTracingContext(inner, () => getTracingContext())
    ) as { tenant_id: string; actor_type: string } | undefined;
    expect(result?.tenant_id).toBe('tenant-inner');
    expect(result?.actor_type).toBe('worker');
  });
});

describe('TracingContext — accessors null cases', () => {
  it('getCurrentTenantId() fuera de un run → null', () => {
    expect(getCurrentTenantId()).toBeNull();
  });

  it('getCurrentCorrelationId() fuera de un run → null', () => {
    expect(getCurrentCorrelationId()).toBeNull();
  });

  it('getCurrentRequestId() fuera de un run → null', () => {
    expect(getCurrentRequestId()).toBeNull();
  });

  it('getCurrentActor() fuera de un run → null', () => {
    expect(getCurrentActor()).toBeNull();
  });

  it('getCurrentTenantId() con tenant_id = null → null (no string)', () => {
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: null,
      actor_user_id: null,
      actor_type: 'cron' as const,
    };
    const result = withTracingContext(ctx, () => getCurrentTenantId());
    expect(result).toBeNull();
  });

  it('getCurrentActor() con context valido → user_id + type', () => {
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-a',
      actor_user_id: 'user-x',
      actor_type: 'support' as const,
    };
    const result = withTracingContext(ctx, () => getCurrentActor());
    expect(result).toEqual({ user_id: 'user-x', type: 'support' });
  });
});

describe('TracingContext — requireTenantId', () => {
  it('requireTenantId() fuera de un run → throw', () => {
    expect(() => requireTenantId()).toThrow(/tenant_id requerido/);
  });

  it('requireTenantId() con tenant_id = null → throw', () => {
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: null,
      actor_user_id: null,
      actor_type: 'cron' as const,
    };
    expect(() =>
      withTracingContext(ctx, () => requireTenantId())
    ).toThrow(/tenant_id requerido/);
  });

  it('requireTenantId() con tenant_id valido → devuelve string', () => {
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-real-uuid',
      actor_user_id: 'user-1',
      actor_type: 'user' as const,
    };
    const result = withTracingContext(ctx, () => requireTenantId());
    expect(result).toBe('tenant-real-uuid');
  });
});

describe('TracingContext — async isolation invariante CRITICA', () => {
  it('runs paralelos NO comparten context (AsyncLocalStorage aislamiento)', async () => {
    const ctxA = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-A',
      actor_user_id: null,
      actor_type: 'user' as const,
    };
    const ctxB = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-B',
      actor_user_id: null,
      actor_type: 'user' as const,
    };

    const [resultA, resultB] = await Promise.all([
      withTracingContext(ctxA, async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return getCurrentTenantId();
      }),
      withTracingContext(ctxB, async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return getCurrentTenantId();
      }),
    ]);

    expect(resultA).toBe('tenant-A');
    expect(resultB).toBe('tenant-B');
  });

  it('await interno HEREDA context (AsyncLocalStorage propagacion)', async () => {
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-heredado',
      actor_user_id: null,
      actor_type: 'worker' as const,
    };

    const result = await withTracingContext(ctx, async () => {
      // 1er await
      await new Promise(resolve => setImmediate(resolve));
      const lvl1 = getCurrentTenantId();
      // 2do await (anidado, simulando llamada a service profundo)
      await new Promise(resolve => setTimeout(resolve, 5));
      const lvl2 = getCurrentTenantId();
      return { lvl1, lvl2 };
    });

    expect(result.lvl1).toBe('tenant-heredado');
    expect(result.lvl2).toBe('tenant-heredado');
  });

  it('context post-run vuelve a undefined (no leak)', async () => {
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-leak-test',
      actor_user_id: null,
      actor_type: 'system' as const,
    };

    await withTracingContext(ctx, async () => {
      expect(getCurrentTenantId()).toBe('tenant-leak-test');
    });

    // Post-run debe estar limpio
    expect(getCurrentTenantId()).toBeNull();
    expect(getTracingContext()).toBeUndefined();
  });

  it('context se limpia POST-THROW (AsyncLocalStorage cleanup invariante)', async () => {
    // Advisor fix 2026-06-02: AsyncLocalStorage.run() exits scope al throw.
    // Sin este test, un bug en runtime de Node que filtre context tras throw
    // pasaria desapercibido — y todas las operaciones siguientes verian
    // tenant_id incorrecto.
    const ctx = {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: 'tenant-throw-test',
      actor_user_id: null,
      actor_type: 'system' as const,
    };

    await expect(
      withTracingContext(ctx, async () => {
        expect(getCurrentTenantId()).toBe('tenant-throw-test');
        throw new Error('intentional test error');
      })
    ).rejects.toThrow('intentional test error');

    // Post-throw debe estar limpio igual que post-success
    expect(getCurrentTenantId()).toBeNull();
    expect(getTracingContext()).toBeUndefined();
  });
});

describe('withCronTracing', () => {
  it('genera correlation_id + request_id nuevos cada llamada', async () => {
    const ids1 = await withCronTracing(async () => ({
      cid: getCurrentCorrelationId(),
      rid: getCurrentRequestId(),
    }));
    const ids2 = await withCronTracing(async () => ({
      cid: getCurrentCorrelationId(),
      rid: getCurrentRequestId(),
    }));
    expect(ids1.cid).not.toBe(ids2.cid);
    expect(ids1.rid).not.toBe(ids2.rid);
  });

  it('actor_type = cron + tenant_id = null + actor_user_id = null', async () => {
    const result = await withCronTracing(async () => getTracingContext());
    expect(result?.actor_type).toBe('cron');
    expect(result?.tenant_id).toBeNull();
    expect(result?.actor_user_id).toBeNull();
  });

  it('correlation_id y request_id son UUID v4 validos', async () => {
    const result = await withCronTracing(async () => ({
      cid: getCurrentCorrelationId(),
      rid: getCurrentRequestId(),
    }));
    expect(isValidUuid(result.cid!)).toBe(true);
    expect(isValidUuid(result.rid!)).toBe(true);
  });
});

describe('withWorkerTracing — INVARIANTE: hereda correlation_id, genera request_id nuevo', () => {
  it('HEREDA correlation_id del parametro (no genera nuevo)', async () => {
    const inheritedCorrelationId = generateCorrelationId();
    const result = await withWorkerTracing(
      {
        tenant_id: 'tenant-worker',
        correlation_id: inheritedCorrelationId,
      },
      async () => getCurrentCorrelationId()
    );
    expect(result).toBe(inheritedCorrelationId);
  });

  it('GENERA request_id nuevo cada attempt (no hereda)', async () => {
    const sharedCorrelationId = generateCorrelationId();
    const attempt1 = await withWorkerTracing(
      { tenant_id: 'tenant-w', correlation_id: sharedCorrelationId },
      async () => getCurrentRequestId()
    );
    const attempt2 = await withWorkerTracing(
      { tenant_id: 'tenant-w', correlation_id: sharedCorrelationId },
      async () => getCurrentRequestId()
    );
    // 2 attempts del mismo job (mismo correlation_id) DEBEN tener request_id distintos
    expect(attempt1).not.toBe(attempt2);
    expect(isValidUuid(attempt1!)).toBe(true);
    expect(isValidUuid(attempt2!)).toBe(true);
  });

  it('actor_type = worker + tenant_id pasado + actor_user_id = null', async () => {
    const result = await withWorkerTracing(
      { tenant_id: 'tenant-w-actor', correlation_id: generateCorrelationId() },
      async () => getTracingContext()
    );
    expect(result?.actor_type).toBe('worker');
    expect(result?.tenant_id).toBe('tenant-w-actor');
    expect(result?.actor_user_id).toBeNull();
  });
});
