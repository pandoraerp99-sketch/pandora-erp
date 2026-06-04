/**
 * Tests unitarios metrics — prepareMetricIncrement (pure helper).
 *
 * Cubre:
 * - Whitelist enforcement (rechaza metric no canonico)
 * - Tag key validation (allowedTagKeys)
 * - Tag value validation (allowedValues bounded)
 * - Tenant resolution: scope=tenant + context / scope=system / sin context
 * - Defaults (amount=1, sin tag → tag_key='', tag_value='')
 * - Whitelist invariantes (cada metric tiene scope valido + cardinalityWarn cuando aplica)
 *
 * Tests integration (INSERT ON CONFLICT real + cardinality warn cron) → diferidos
 * a tests/integration cuando exista Supabase test instance.
 */
import { describe, expect, it } from 'vitest';
import {
  METRIC_WHITELIST,
  MetricNotInWhitelistError,
  MetricTagNotAllowedError,
  MetricTagValueNotAllowedError,
  MetricTenantRequiredError,
  incrementCounter,
  prepareMetricIncrement,
} from '@/lib/observability/metrics';
import { env } from '@/lib/env';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';

const TENANT_REAL = '550e8400-e29b-41d4-a716-446655440000';

function makeTenantCtxAndRun<T>(fn: () => T, tenantId: string | null = TENANT_REAL): T {
  return withTracingContext(
    {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: tenantId,
      actor_user_id: null,
      actor_type: 'system',
    },
    fn
  ) as T;
}

describe('METRIC_WHITELIST — catalogo canonico invariantes', () => {
  it('NO esta vacio (F0 tiene metricas definidas)', () => {
    expect(Object.keys(METRIC_WHITELIST).length).toBeGreaterThan(5);
  });

  it('cada metrica tiene scope = tenant | system', () => {
    for (const [name, config] of Object.entries(METRIC_WHITELIST)) {
      expect(['tenant', 'system']).toContain(config.scope);
    }
  });

  it('cada metrica con allowedValues tiene allowedTagKeys correspondiente', () => {
    // Si una metrica tiene allowedValues[k], k debe estar en allowedTagKeys
    for (const [name, config] of Object.entries(METRIC_WHITELIST)) {
      if (config.allowedValues) {
        for (const tagKey of Object.keys(config.allowedValues)) {
          expect(config.allowedTagKeys).toContain(tagKey);
        }
      }
    }
  });

  it('contiene metricas fiscal F0 esperadas (AFIP CAE)', () => {
    expect(METRIC_WHITELIST['afip.cae.success']).toBeDefined();
    expect(METRIC_WHITELIST['afip.cae.rejected']).toBeDefined();
    expect(METRIC_WHITELIST['afip.cae.timeout']).toBeDefined();
  });

  it('contiene metricas system cross-tenant F0', () => {
    expect(METRIC_WHITELIST['system.cross_tenant.blocked']?.scope).toBe('system');
    expect(METRIC_WHITELIST['system.rate_limit.hit']?.scope).toBe('system');
  });
});

describe('prepareMetricIncrement — whitelist enforcement', () => {
  it('metric canonico → OK', () => {
    const result = prepareMetricIncrement(
      'afip.cae.timeout',
      {},
      TENANT_REAL
    );
    expect(result.metric_name).toBe('afip.cae.timeout');
    expect(result.tenant_id).toBe(TENANT_REAL);
    expect(result.amount).toBe(1);
  });

  it('metric NO canonico → throw MetricNotInWhitelistError', () => {
    expect(() =>
      prepareMetricIncrement('venta.inventada.metric', {}, TENANT_REAL)
    ).toThrow(MetricNotInWhitelistError);
  });

  it('metric con typo (cae.succes en vez de cae.success) → throw', () => {
    expect(() =>
      prepareMetricIncrement('afip.cae.succes', {}, TENANT_REAL)
    ).toThrow(MetricNotInWhitelistError);
  });
});

describe('prepareMetricIncrement — tag_key validation', () => {
  it('tag_key permitido (sale_point en afip.cae.success) → OK', () => {
    const result = prepareMetricIncrement(
      'afip.cae.success',
      { tag: { key: 'sale_point', value: '0001' } },
      TENANT_REAL
    );
    expect(result.tag_key).toBe('sale_point');
    expect(result.tag_value).toBe('0001');
  });

  it('tag_key NO permitido → throw MetricTagNotAllowedError', () => {
    // afip.cae.success allows sale_point + invoice_type, NO customer_id
    expect(() =>
      prepareMetricIncrement(
        'afip.cae.success',
        { tag: { key: 'customer_id', value: '20-12345678-9' } },
        TENANT_REAL
      )
    ).toThrow(MetricTagNotAllowedError);
  });

  it('metric SIN tags + caller pasa tag → throw', () => {
    // afip.cae.timeout no permite tags
    expect(() =>
      prepareMetricIncrement(
        'afip.cae.timeout',
        { tag: { key: 'anything', value: 'X' } },
        TENANT_REAL
      )
    ).toThrow(MetricTagNotAllowedError);
  });

  it('metric SIN tags + caller NO pasa tag → tag_key="", tag_value=""', () => {
    const result = prepareMetricIncrement('afip.cae.timeout', {}, TENANT_REAL);
    expect(result.tag_key).toBe('');
    expect(result.tag_value).toBe('');
  });
});

describe('prepareMetricIncrement — tag_value bounded validation', () => {
  it('invoice_type A → OK', () => {
    const result = prepareMetricIncrement(
      'afip.cae.success',
      { tag: { key: 'invoice_type', value: 'A' } },
      TENANT_REAL
    );
    expect(result.tag_value).toBe('A');
  });

  it('invoice_type Z (no en allowedValues) → throw MetricTagValueNotAllowedError', () => {
    expect(() =>
      prepareMetricIncrement(
        'afip.cae.success',
        { tag: { key: 'invoice_type', value: 'Z' } },
        TENANT_REAL
      )
    ).toThrow(MetricTagValueNotAllowedError);
  });

  it('NC_A (variant aceptado) → OK', () => {
    const result = prepareMetricIncrement(
      'afip.cae.success',
      { tag: { key: 'invoice_type', value: 'NC_A' } },
      TENANT_REAL
    );
    expect(result.tag_value).toBe('NC_A');
  });

  it('rounding mode HALF_EVEN → OK (catalog ADR-0005)', () => {
    const result = prepareMetricIncrement(
      'fiscal.rounding.delta_cents',
      { tag: { key: 'mode', value: 'HALF_EVEN' } },
      TENANT_REAL
    );
    expect(result.tag_value).toBe('HALF_EVEN');
  });

  it('rounding mode invalido → throw', () => {
    expect(() =>
      prepareMetricIncrement(
        'fiscal.rounding.delta_cents',
        { tag: { key: 'mode', value: 'BANKERS' } },
        TENANT_REAL
      )
    ).toThrow(MetricTagValueNotAllowedError);
  });

  it('tag_key SIN allowedValues (sale_point) acepta cualquier valor', () => {
    // sale_point esta en allowedTagKeys pero NO en allowedValues
    // → cualquier string es valido (sale_points son bounded por tenant)
    const result = prepareMetricIncrement(
      'afip.cae.success',
      { tag: { key: 'sale_point', value: 'CUSTOM_SP_999' } },
      TENANT_REAL
    );
    expect(result.tag_value).toBe('CUSTOM_SP_999');
  });
});

describe('prepareMetricIncrement — tenant_id resolution', () => {
  it('scope=tenant + context con tenant → usa el del context', () => {
    const result = prepareMetricIncrement('afip.cae.timeout', {}, TENANT_REAL);
    expect(result.tenant_id).toBe(TENANT_REAL);
  });

  it('scope=tenant + ctx null + sin override → throw MetricTenantRequiredError', () => {
    expect(() =>
      prepareMetricIncrement('afip.cae.timeout', {}, null)
    ).toThrow(MetricTenantRequiredError);
  });

  it('scope=tenant + ctx null + override valido → usa override', () => {
    const OVERRIDE = '11111111-1111-1111-1111-111111111111';
    const result = prepareMetricIncrement(
      'afip.cae.timeout',
      { overrideTenantId: OVERRIDE },
      null
    );
    expect(result.tenant_id).toBe(OVERRIDE);
  });

  it('scope=system → SIEMPRE usa SYSTEM_TENANT_ID, ignora context', () => {
    const result = prepareMetricIncrement(
      'system.cross_tenant.blocked',
      {},
      TENANT_REAL
    );
    expect(result.tenant_id).toBe(env.SYSTEM_TENANT_ID);
  });

  it('scope=system + override → SIGUE usando SYSTEM_TENANT_ID (system es system)', () => {
    // El override es para casos tenant-scoped. System siempre = sentinel.
    const result = prepareMetricIncrement(
      'system.cross_tenant.blocked',
      { overrideTenantId: '11111111-1111-1111-1111-111111111111' },
      null
    );
    expect(result.tenant_id).toBe(env.SYSTEM_TENANT_ID);
  });
});

describe('prepareMetricIncrement — amount + defaults', () => {
  it('SIN amount → default 1', () => {
    const result = prepareMetricIncrement('afip.cae.timeout', {}, TENANT_REAL);
    expect(result.amount).toBe(1);
  });

  it('amount=5 → respeta', () => {
    const result = prepareMetricIncrement(
      'afip.cae.timeout',
      { amount: 5 },
      TENANT_REAL
    );
    expect(result.amount).toBe(5);
  });
});

describe('prepareMetricIncrement — integracion tracing context', () => {
  it('lee ctxTenantId del AsyncLocalStorage cuando no se pasa explicito', () => {
    const result = makeTenantCtxAndRun(() =>
      prepareMetricIncrement('afip.cae.timeout', {})
    );
    expect(result.tenant_id).toBe(TENANT_REAL);
  });

  it('scope=system dentro de context → ignora ctx, usa SYSTEM_TENANT_ID', () => {
    const result = makeTenantCtxAndRun(() =>
      prepareMetricIncrement('system.rate_limit.hit', {
        tag: { key: 'endpoint', value: '/api/sale/charge' },
      })
    );
    expect(result.tenant_id).toBe(env.SYSTEM_TENANT_ID);
  });
});

// Advisor fix #1 2026-06-02: wrapper incrementCounter NO debe rethrow
// errores de DB — metrics NO debe bloquear flow operativo (CLAUDE.md §10.4).
describe('incrementCounter wrapper — fail-open behavior (advisor fix)', () => {
  /**
   * Mock txOrDb que simula DB caida — chain insert().values().onConflictDoUpdate()
   * que termina rejecting. El wrapper debe atrapar + warn + NO rethrow.
   */
  function makeFailingTxDb(): unknown {
    const failingChain = {
      values() {
        return {
          onConflictDoUpdate() {
            return Promise.reject(new Error('DB connection refused (simulated)'));
          },
        };
      },
    };
    return {
      insert() {
        return failingChain;
      },
    };
  }

  it('DB error → NO rethrowa (metrics fail-open, no bloquea operacion)', async () => {
    // Sin este test, alguien podria quitar el try/catch en refactor pensando
    // "lo correcto es propagar errores" y romper invariante operacional:
    // venta cobrada NO debe fallar porque un counter no se pudo incrementar.
    //
    // Uso metric system-scope para que no requiera tracing context tenant_id
    // (esa validacion es antes que el INSERT, no testea fail-open de DB).
    await expect(
      incrementCounter(
        'system.cross_tenant.blocked',
        {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeFailingTxDb() as any
      )
    ).resolves.toBeUndefined();
  });

  it('llamado con metric NO en whitelist → SIGUE throwando (whitelist es contrato del catalogo)', async () => {
    // Diferencia critica: error de DB se traga (operacional), error de
    // whitelist se propaga (bug del codigo). El wrapper NO debe enmascarar
    // bugs de programacion como "fallo de metrics".
    await expect(
      incrementCounter(
        'metric.no.existe',
        {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeFailingTxDb() as any
      )
    ).rejects.toThrow(MetricNotInWhitelistError);
  });

  it('llamado con tag NO permitido → SIGUE throwando (validation es contrato)', async () => {
    await expect(
      incrementCounter(
        'afip.cae.success',
        { tag: { key: 'invalid_key', value: 'X' } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeFailingTxDb() as any
      )
    ).rejects.toThrow(MetricTagNotAllowedError);
  });
});
