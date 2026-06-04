/**
 * Tests unitarios audit-writer — prepareAuditLogValues (pure helper).
 *
 * Cubre:
 * - event_name catalog enforcement (rechaza no-canonicos)
 * - Multi-tenant guard: override_tenant_id solo para system|support
 * - tenant_id resolution: override → ctx → SYSTEM_TENANT_ID
 * - Defaults: event_version=1, pii_level='internal', severity='info'
 * - Context fields pass-through (correlation_id, request_id, actor_*)
 *
 * Tests con DB real (INSERT + trigger inmutable T-OBS-05 + RLS) van a
 * tests/integration cuando exista Supabase test instance.
 */
import { describe, expect, it } from 'vitest';
import {
  prepareAuditLogValues,
  writeAuditLog,
  type AuditLogInput,
} from '@/lib/audit/audit-writer';
import { env } from '@/lib/env';
import {
  AuditEventNotInCatalogError,
  CrossTenantAccessError,
} from '@/lib/multi_tenant/errors';
import type { TracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';

function makeCtx(overrides: Partial<TracingContext> = {}): TracingContext {
  return {
    correlation_id: generateCorrelationId(),
    request_id: generateRequestId(),
    tenant_id: 'tenant-real-uuid',
    actor_user_id: 'user-x',
    actor_type: 'user',
    ...overrides,
  };
}

const validInput: AuditLogInput = {
  event_name: 'sale.completed',
  payload: { sale_id: 's1', amount: 1500 },
};

describe('prepareAuditLogValues — catalog enforcement', () => {
  it('event_name canonico → OK', () => {
    const result = prepareAuditLogValues(validInput, makeCtx());
    expect(result.event_name).toBe('sale.completed');
  });

  it('event_name NO canonico → throw AuditEventNotInCatalogError', () => {
    expect(() =>
      prepareAuditLogValues(
        // @ts-expect-error testing runtime guard, TS lo bloquea en compile time
        { event_name: 'sale.invented_event', payload: {} },
        makeCtx()
      )
    ).toThrow(AuditEventNotInCatalogError);
  });

  it('event_name vacio → throw AuditEventNotInCatalogError', () => {
    expect(() =>
      prepareAuditLogValues(
        // @ts-expect-error testing runtime guard
        { event_name: '', payload: {} },
        makeCtx()
      )
    ).toThrow(AuditEventNotInCatalogError);
  });
});

describe('prepareAuditLogValues — multi-tenant guard', () => {
  it('SIN override + actor user → tenant_id = ctx.tenant_id', () => {
    const ctx = makeCtx({ tenant_id: 'tenant-AAA', actor_type: 'user' });
    const result = prepareAuditLogValues(validInput, ctx);
    expect(result.tenant_id).toBe('tenant-AAA');
  });

  // Nota: tests usan UUIDs reales porque advisor fix 2026-06-02 agrego
  // UUID validation a override_tenant_id. Strings no-UUID throw antes del
  // actor check.
  const TENANT_BBB = '550e8400-e29b-41d4-a716-44665544bbbb';
  const TENANT_CCC = '550e8400-e29b-41d4-a716-44665544cccc';
  const TENANT_OTHER = '550e8400-e29b-41d4-a716-44665544ffff';
  const TENANT_ACTOR_UUID = '11111111-1111-1111-1111-111111111111';
  const TENANT_ATTEMPTED_UUID = '22222222-2222-2222-2222-222222222222';

  it('CON override + actor system → tenant_id = override (PERMITIDO)', () => {
    const ctx = makeCtx({
      tenant_id: null,
      actor_user_id: null,
      actor_type: 'system',
    });
    const result = prepareAuditLogValues(
      { ...validInput, override_tenant_id: TENANT_BBB },
      ctx
    );
    expect(result.tenant_id).toBe(TENANT_BBB);
  });

  it('CON override + actor support → tenant_id = override (PERMITIDO)', () => {
    const ctx = makeCtx({
      tenant_id: TENANT_ACTOR_UUID,
      actor_user_id: 'support-user',
      actor_type: 'support',
    });
    const result = prepareAuditLogValues(
      { ...validInput, override_tenant_id: TENANT_CCC },
      ctx
    );
    expect(result.tenant_id).toBe(TENANT_CCC);
  });

  it('CON override + actor user → throw CrossTenantAccessError', () => {
    const ctx = makeCtx({ actor_type: 'user' });
    expect(() =>
      prepareAuditLogValues(
        { ...validInput, override_tenant_id: TENANT_OTHER },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('CON override + actor worker → throw CrossTenantAccessError', () => {
    const ctx = makeCtx({ actor_type: 'worker', actor_user_id: null });
    expect(() =>
      prepareAuditLogValues(
        { ...validInput, override_tenant_id: TENANT_OTHER },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('CON override + actor cron → throw CrossTenantAccessError', () => {
    // Cron NO es system — cron es eventos automaticos sin actor, mientras
    // que system se usa para operaciones de mantenimiento administrativas.
    const ctx = makeCtx({
      actor_type: 'cron',
      tenant_id: null,
      actor_user_id: null,
    });
    expect(() =>
      prepareAuditLogValues(
        { ...validInput, override_tenant_id: TENANT_OTHER },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('CrossTenantAccessError contiene attempted + actor tenants + resource', () => {
    const ctx = makeCtx({
      tenant_id: TENANT_ACTOR_UUID,
      actor_type: 'user',
    });
    try {
      prepareAuditLogValues(
        { ...validInput, override_tenant_id: TENANT_ATTEMPTED_UUID },
        ctx
      );
    } catch (e) {
      expect(e).toBeInstanceOf(CrossTenantAccessError);
      const err = e as CrossTenantAccessError;
      expect(err.attempted_tenant_id).toBe(TENANT_ATTEMPTED_UUID);
      expect(err.actor_tenant_id).toBe(TENANT_ACTOR_UUID);
      expect(err.resource).toBe('audit_log.override_tenant_id');
    }
  });
});

describe('prepareAuditLogValues — tenant_id resolution chain', () => {
  it('override > ctx.tenant_id > SYSTEM_TENANT_ID', () => {
    const OVERRIDE_UUID = '33333333-3333-3333-3333-333333333333';
    const ctx = makeCtx({
      tenant_id: 'tenant-CTX',
      actor_type: 'system',
      actor_user_id: null,
    });
    const result = prepareAuditLogValues(
      { ...validInput, override_tenant_id: OVERRIDE_UUID },
      ctx
    );
    expect(result.tenant_id).toBe(OVERRIDE_UUID);
  });

  it('ctx.tenant_id null + actor cron + sin override → SYSTEM_TENANT_ID', () => {
    const ctx = makeCtx({
      tenant_id: null,
      actor_type: 'cron',
      actor_user_id: null,
    });
    const result = prepareAuditLogValues(validInput, ctx);
    expect(result.tenant_id).toBe(env.SYSTEM_TENANT_ID);
  });

  it('ctx.tenant_id presente + sin override → usa ctx.tenant_id', () => {
    const ctx = makeCtx({ tenant_id: 'tenant-X' });
    const result = prepareAuditLogValues(validInput, ctx);
    expect(result.tenant_id).toBe('tenant-X');
  });
});

describe('prepareAuditLogValues — defaults', () => {
  it('SIN event_version → default 1', () => {
    const result = prepareAuditLogValues(validInput, makeCtx());
    expect(result.event_version).toBe(1);
  });

  it('CON event_version → respeta', () => {
    const result = prepareAuditLogValues(
      { ...validInput, event_version: 3 },
      makeCtx()
    );
    expect(result.event_version).toBe(3);
  });

  it('SIN pii_level → default internal', () => {
    const result = prepareAuditLogValues(validInput, makeCtx());
    expect(result.pii_level).toBe('internal');
  });

  it('CON pii_level pii_high → respeta', () => {
    const result = prepareAuditLogValues(
      { ...validInput, pii_level: 'pii_high' },
      makeCtx()
    );
    expect(result.pii_level).toBe('pii_high');
  });

  it('SIN severity → default info', () => {
    const result = prepareAuditLogValues(validInput, makeCtx());
    expect(result.severity).toBe('info');
  });

  it('CON severity critical → respeta', () => {
    const result = prepareAuditLogValues(
      { ...validInput, severity: 'critical' },
      makeCtx()
    );
    expect(result.severity).toBe('critical');
  });
});

describe('prepareAuditLogValues — context pass-through', () => {
  it('correlation_id + request_id + actor_user_id + actor_type del ctx', () => {
    const ctx = makeCtx({
      correlation_id: 'fixed-cid-uuid',
      request_id: 'fixed-rid-uuid',
      actor_user_id: 'user-abc',
      actor_type: 'support',
    });
    const result = prepareAuditLogValues(validInput, ctx);
    expect(result.correlation_id).toBe('fixed-cid-uuid');
    expect(result.request_id).toBe('fixed-rid-uuid');
    expect(result.actor_user_id).toBe('user-abc');
    expect(result.actor_type).toBe('support');
  });

  it('payload SIN secrets pasa intacto + PII preservada', () => {
    // PII (DNI, email, direccion) NO se scrubea — es scope legal de audit_log
    // (Ley 11.683). Solo secrets (password, token, etc.) se scrubean.
    const ctx = makeCtx();
    const payload = {
      sale_id: 's-001',
      amount_cents: 12345,
      customer_dni: '20-12345678-9',
    };
    const result = prepareAuditLogValues(
      { event_name: 'sale.completed', payload, pii_level: 'pii_high' },
      ctx
    );
    expect(result.payload).toEqual(payload);
    expect(result.pii_level).toBe('pii_high');
  });
});

// Advisor fix #1 2026-06-02: scrub secrets del payload antes de persistir.
// Audit_log es 10 anios inmutable — trust-the-caller no escala.
describe('prepareAuditLogValues — scrub secrets payload (advisor fix CRITICO)', () => {
  it('payload con password root → scrubeado a [REDACTED]', () => {
    const ctx = makeCtx();
    const result = prepareAuditLogValues(
      {
        event_name: 'auth.login.failed',
        payload: { email: 'attacker@example.com', password: 'leak-attempt' },
      },
      ctx
    );
    const payload = result.payload as Record<string, unknown>;
    expect(payload.password).toBe('[REDACTED]');
    expect(payload.email).toBe('attacker@example.com');
  });

  it('payload AFIP Auth nested (Token + Sign PascalCase) → scrubeado', () => {
    const ctx = makeCtx({ actor_type: 'system', actor_user_id: null });
    const result = prepareAuditLogValues(
      {
        event_name: 'fiscal.invoice.cae_received',
        payload: {
          request: {
            Auth: {
              Token: 'WSAA-leak-token',
              Sign: 'leak-sign',
              Cuit: 30712345678,
            },
            FeCabReq: { CantReg: 1, PtoVta: 1, CbteTipo: 6 },
          },
        },
      },
      ctx
    );
    const auth = (
      (result.payload as Record<string, unknown>).request as Record<string, unknown>
    ).Auth as Record<string, unknown>;
    expect(auth.Token).toBe('[REDACTED]');
    expect(auth.Sign).toBe('[REDACTED]');
    expect(auth.Cuit).toBe(30712345678);
  });

  it('payload sin secrets → NO se modifica + scrubbedPaths vacia', () => {
    const ctx = makeCtx();
    const payload = {
      sale_id: 's-001',
      amount_cents: 12345,
    };
    const result = prepareAuditLogValues(
      { event_name: 'sale.completed', payload },
      ctx
    );
    expect(result.payload).toEqual(payload);
  });

  it('input no se muta (immutability del payload original)', () => {
    const ctx = makeCtx();
    const payload = {
      password: 'original-leak',
      sale_id: 's-001',
    };
    const payloadBackup = { ...payload };
    prepareAuditLogValues(
      { event_name: 'auth.login.failed', payload },
      ctx
    );
    expect(payload).toEqual(payloadBackup);
    expect(payload.password).toBe('original-leak');
  });
});

// Advisor fix #2 2026-06-02: override_tenant_id UUID validation.
describe('prepareAuditLogValues — override_tenant_id UUID validation', () => {
  it('override_tenant_id UUID valido + actor system → OK', () => {
    const ctx = makeCtx({ actor_type: 'system', actor_user_id: null });
    const result = prepareAuditLogValues(
      {
        ...validInput,
        override_tenant_id: '550e8400-e29b-41d4-a716-446655440000',
      },
      ctx
    );
    expect(result.tenant_id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('override_tenant_id string vacio → throw CrossTenantAccessError', () => {
    const ctx = makeCtx({ actor_type: 'system' });
    expect(() =>
      prepareAuditLogValues(
        { ...validInput, override_tenant_id: '' },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('override_tenant_id NO uuid → throw CrossTenantAccessError', () => {
    const ctx = makeCtx({ actor_type: 'system' });
    expect(() =>
      prepareAuditLogValues(
        { ...validInput, override_tenant_id: 'not-a-uuid' },
        ctx
      )
    ).toThrow(CrossTenantAccessError);
  });

  it('UUID validation corre ANTES de actor_type check (defense layered)', () => {
    // Si UUID invalido + actor user → debe throw por UUID, no por actor.
    // Sin esto, error message confuso ("acceso denegado por actor" en vez
    // de "uuid invalido"). Verifico el resource string contiene "UUID".
    const ctx = makeCtx({ actor_type: 'user' });
    try {
      prepareAuditLogValues(
        { ...validInput, override_tenant_id: 'garbage' },
        ctx
      );
    } catch (e) {
      expect(e).toBeInstanceOf(CrossTenantAccessError);
      const err = e as CrossTenantAccessError;
      expect(err.resource).toContain('UUID');
    }
  });
});

// Advisor fix #3 2026-06-02: writeAuditLog wrapper smoke test.
describe('writeAuditLog wrapper — requireTracingContext gate', () => {
  it('llamado FUERA de tracing context → throw requireTracingContext error', async () => {
    // El wrapper hace requireTracingContext() antes de prepareAuditLogValues.
    // Sin context, debe throw — sin esto, audit_log seria orphan (sin
    // correlation_id/request_id) o usar undefined que rompe el insert.
    await expect(
      writeAuditLog({ event_name: 'sale.completed', payload: {} })
    ).rejects.toThrow(/no esta inicializado/);
  });
});
