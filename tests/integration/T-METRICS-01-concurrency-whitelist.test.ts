/**
 * T-METRICS-01 — metrics_counter INSERT ON CONFLICT DO UPDATE concurrencia + whitelist.
 * Sprint 2 ROADMAP Platform + EVENT-TAXONOMY §4 + CLAUDE.md §10.4.
 *
 * **Por qué CRÍTICO:**
 * - Anti-pattern §20.8 (unbounded cardinality) — solo whitelist garantiza
 *   bounded growth. T-METRICS-01 valida que metric fuera de catálogo es
 *   rechazado en runtime (no solo en TS-level).
 * - INSERT ON CONFLICT DO UPDATE atomicidad — N increments paralelos del
 *   mismo (metric, tenant, tag) deben sumar exactamente N (cero pérdidas
 *   por race condition).
 *
 * **Lo que validamos:**
 * - Increment fresh → row insertado con count=1
 * - 100 increments paralelos del mismo (metric, tenant, tag) → count=100 exacto
 *   (sin race conditions / sin lost updates)
 * - Metric fuera del whitelist → MetricNotInWhitelistError (preparación)
 * - Tag value fuera de allowedValues → MetricTagValueNotAllowedError
 * - System-scope metric → tenant_id=SYSTEM_TENANT_ID (independiente del context)
 * - Distintos tag_values en mismo (metric, tenant) → rows distintas (key dimension)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { metrics_counter } from '@/lib/db/schema/metrics';
import {
  incrementCounter,
  prepareMetricIncrement,
  MetricNotInWhitelistError,
  MetricTagValueNotAllowedError,
  MetricTenantRequiredError,
} from '@/lib/observability/metrics';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { env } from '@/lib/env';

describe('T-METRICS-01 — INSERT ON CONFLICT DO UPDATE + whitelist enforcement', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-METRICS-01 Test Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userId,
      email: `t-metrics-01-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Test',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      // metrics_counter del tenant
      await tx.delete(metrics_counter).where(eq(metrics_counter.tenant_id, tenantId));
      // metrics system scope (SYSTEM_TENANT_ID) creados por este test — solo
      // los del metric específico para no interferir con otros tests
      await tx
        .delete(metrics_counter)
        .where(
          and(
            eq(metrics_counter.tenant_id, env.SYSTEM_TENANT_ID),
            eq(metrics_counter.metric_name, 'system.cross_tenant.blocked')
          )
        );
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('Increment fresh sobre (metric, tenant) → row insertado con count=1', async () => {
    await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () => incrementCounter('payment.mp.confirmed')
    );

    const rows = await db
      .select()
      .from(metrics_counter)
      .where(
        and(
          eq(metrics_counter.metric_name, 'payment.mp.confirmed'),
          eq(metrics_counter.tenant_id, tenantId)
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(BigInt(1));
  });

  it('100 increments paralelos del mismo (metric, tenant) → count=100 exacto (atomic)', async () => {
    const metric = 'afip.cae.timeout';

    const runIncrement = () =>
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        () => incrementCounter(metric)
      );

    await Promise.all(Array.from({ length: 100 }, runIncrement));

    const rows = await db
      .select()
      .from(metrics_counter)
      .where(
        and(
          eq(metrics_counter.metric_name, metric),
          eq(metrics_counter.tenant_id, tenantId)
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(BigInt(100));
  });

  it('Distintos tag_values → rows distintas (key dimension)', async () => {
    const metric = 'afip.cae.success';

    await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      async () => {
        await incrementCounter(metric, { tag: { key: 'invoice_type', value: 'A' } });
        await incrementCounter(metric, { tag: { key: 'invoice_type', value: 'A' } });
        await incrementCounter(metric, { tag: { key: 'invoice_type', value: 'B' } });
        await incrementCounter(metric, { tag: { key: 'invoice_type', value: 'C' } });
      }
    );

    const rows = await db
      .select()
      .from(metrics_counter)
      .where(
        and(
          eq(metrics_counter.metric_name, metric),
          eq(metrics_counter.tenant_id, tenantId)
        )
      );
    expect(rows).toHaveLength(3); // 3 tag_value distintos: A, B, C

    const byValue = Object.fromEntries(rows.map((r) => [r.tag_value, r.count]));
    expect(byValue['A']).toBe(BigInt(2));
    expect(byValue['B']).toBe(BigInt(1));
    expect(byValue['C']).toBe(BigInt(1));
  });

  it('Metric fuera del whitelist → MetricNotInWhitelistError (prepareMetricIncrement)', () => {
    // El wrapper catch error y NO rethrowa (fail-open § 13.9), pero el pure
    // helper SÍ throw. Lo testeamos directamente.
    expect(() => prepareMetricIncrement('inexistente.metric', {}, tenantId)).toThrow(
      MetricNotInWhitelistError
    );
  });

  it('Tag value fuera de allowedValues → MetricTagValueNotAllowedError', () => {
    // afip.cae.success acepta invoice_type ∈ {A, B, C, NC_A, NC_B, NC_C}
    expect(() =>
      prepareMetricIncrement(
        'afip.cae.success',
        { tag: { key: 'invoice_type', value: 'X' } },
        tenantId
      )
    ).toThrow(MetricTagValueNotAllowedError);
  });

  it('Tenant-scope metric sin tenant_id en context → MetricTenantRequiredError', () => {
    // payment.mp.confirmed es scope=tenant. Sin context tenant_id ni override → throw.
    expect(() => prepareMetricIncrement('payment.mp.confirmed', {}, null)).toThrow(
      MetricTenantRequiredError
    );
  });

  it('System-scope metric → tenant_id = SYSTEM_TENANT_ID (independiente del context)', async () => {
    // system.cross_tenant.blocked es scope=system. Aunque el tracing context
    // tenga tenant_id custom, la metric se persiste con SYSTEM_TENANT_ID.
    await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId, // ← tenant custom
        actor_user_id: userId,
        actor_type: 'user',
      },
      () => incrementCounter('system.cross_tenant.blocked')
    );

    const rowsCustom = await db
      .select()
      .from(metrics_counter)
      .where(
        and(
          eq(metrics_counter.metric_name, 'system.cross_tenant.blocked'),
          eq(metrics_counter.tenant_id, tenantId) // NO debería existir
        )
      );
    expect(rowsCustom).toHaveLength(0);

    const rowsSystem = await db
      .select()
      .from(metrics_counter)
      .where(
        and(
          eq(metrics_counter.metric_name, 'system.cross_tenant.blocked'),
          eq(metrics_counter.tenant_id, env.SYSTEM_TENANT_ID) // SÍ debería existir
        )
      );
    expect(rowsSystem.length).toBeGreaterThanOrEqual(1);
  });
});
