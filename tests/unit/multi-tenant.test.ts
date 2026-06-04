import { describe, expect, it } from 'vitest';
import { withTracingContext } from '@/lib/tracing/context';
import { validateTenantAccess, validateTenantAccessMany } from '@/lib/multi_tenant/validation';
import { CrossTenantAccessError } from '@/lib/multi_tenant/errors';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';

const baseContext = {
  correlation_id: '00000000-0000-0000-0000-000000000000',
  request_id: '00000000-0000-0000-0000-000000000000',
  actor_user_id: 'user-a',
  actor_type: 'user' as const,
};

describe('validateTenantAccess', () => {
  it('permite acceso al mismo tenant', () => {
    withTracingContext({ ...baseContext, tenant_id: TENANT_A }, () => {
      const resource = { tenant_id: TENANT_A, id: 'foo' };
      const r = validateTenantAccess(resource, 'product');
      expect(r).toEqual(resource);
    });
  });

  it('bloquea acceso a otro tenant', () => {
    withTracingContext({ ...baseContext, tenant_id: TENANT_A }, () => {
      const resource = { tenant_id: TENANT_B, id: 'foo' };
      expect(() => validateTenantAccess(resource, 'product')).toThrow(
        CrossTenantAccessError
      );
    });
  });

  it('CrossTenantAccessError contiene info para audit', () => {
    withTracingContext({ ...baseContext, tenant_id: TENANT_A }, () => {
      try {
        validateTenantAccess({ tenant_id: TENANT_B, id: 'x' }, 'sale');
        expect.fail('debio lanzar');
      } catch (err) {
        expect(err).toBeInstanceOf(CrossTenantAccessError);
        const e = err as CrossTenantAccessError;
        expect(e.attempted_tenant_id).toBe(TENANT_B);
        expect(e.actor_tenant_id).toBe(TENANT_A);
        expect(e.resource).toBe('sale');
        expect(e.statusCode).toBe(403);
      }
    });
  });

  it('lanza si no hay tracing context', () => {
    expect(() => validateTenantAccess({ tenant_id: TENANT_A }, 'product')).toThrow();
  });
});

describe('validateTenantAccessMany', () => {
  it('permite si todos son del mismo tenant', () => {
    withTracingContext({ ...baseContext, tenant_id: TENANT_A }, () => {
      const resources = [
        { tenant_id: TENANT_A, id: '1' },
        { tenant_id: TENANT_A, id: '2' },
      ];
      const r = validateTenantAccessMany(resources, 'products');
      expect(r).toEqual(resources);
    });
  });

  it('bloquea si UN solo recurso es de otro tenant', () => {
    withTracingContext({ ...baseContext, tenant_id: TENANT_A }, () => {
      const resources = [
        { tenant_id: TENANT_A, id: '1' },
        { tenant_id: TENANT_B, id: '2' },
        { tenant_id: TENANT_A, id: '3' },
      ];
      expect(() => validateTenantAccessMany(resources, 'products')).toThrow(
        CrossTenantAccessError
      );
    });
  });
});
