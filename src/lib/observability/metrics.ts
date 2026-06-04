/**
 * Metrics counter writer + whitelist enforcement.
 * EVENT-TAXONOMY.md §4 v2.0.2 + CLAUDE.md §10.4.
 *
 * **Anti-pattern §20.8 (unbounded cardinality):** sin whitelist, cualquier dev
 * podria escribir `incrementCounter('venta', { product_id: 'abc' })` y la
 * tabla explota a N filas por tenant. Whitelist obligatoria a nivel TS
 * previene esto: solo metricas + tag_keys + tag_values explicitamente
 * permitidos pasan.
 *
 * **Trust boundary entre cardinality explosion y observabilidad:**
 * - `cardinalityWarn`: si una metrica supera N rows distintos, cron mensual
 *   alerta. NO bloquea — observabilidad es operacionalmente critica.
 * - Hard limit `cardinalityHardCap` (F1+): bloquearia inserts si supera.
 *
 * **Scope semantics:**
 * - `'tenant'`: tenant_id viene del context. Sin context activo → throw.
 * - `'system'`: tenant_id = SYSTEM_TENANT_ID sentinel siempre. Ignora context.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { metrics_counter } from '../db/schema/metrics.js';
import { env } from '../env.js';
import { getCurrentTenantId } from '../tracing/context.js';
import { logger } from './logger.js';

export interface MetricConfig {
  scope: 'tenant' | 'system';
  /** Tag keys permitidos. `[]` si la metrica no tiene tags. */
  allowedTagKeys: readonly string[];
  /** Si bounded, lista explicita de tag_values por tag_key. */
  allowedValues?: Readonly<Record<string, readonly string[]>>;
  /**
   * Cardinalidad maxima sospechosa.
   *
   * **F0 NO se enforce.** Campo declarado para que el catalogo documente
   * la expectativa (60 = ~10 sale_points x 6 invoice_types). F1+ trigger:
   * cron mensual que ejecuta `SELECT count(distinct ...) FROM metrics_counter
   * GROUP BY metric_name` y alerta si una metrica supera su warn. Sin esto,
   * agregar el field a runtime es no-op (advisor flag: claim falso si
   * COVERAGE-MATRIX dice T-OBS-04 cubre cardinality cuando F0 solo cubre
   * whitelist enforcement).
   */
  cardinalityWarn?: number;
}

/**
 * Catalogo cerrado de metricas F0. Agregar metrica nueva = PR + entry aqui +
 * justificacion (bounded cardinality + utilidad medible). EVENT-TAXONOMY §4.1.
 */
export const METRIC_WHITELIST: Readonly<Record<string, MetricConfig>> = {
  // ──── AFIP / Fiscal ────────────────────────────────────────────
  'afip.cae.success': {
    scope: 'tenant',
    allowedTagKeys: ['sale_point', 'invoice_type'],
    allowedValues: {
      invoice_type: ['A', 'B', 'C', 'NC_A', 'NC_B', 'NC_C'],
    },
    cardinalityWarn: 60,
  },
  'afip.cae.rejected': {
    scope: 'tenant',
    allowedTagKeys: ['error_code'],
    cardinalityWarn: 100,
  },
  'afip.cae.timeout': {
    scope: 'tenant',
    allowedTagKeys: [],
  },
  'afip.padron.cache_hit_rate': {
    scope: 'tenant',
    allowedTagKeys: ['outcome'],
    allowedValues: { outcome: ['hit', 'miss'] },
    cardinalityWarn: 2,
  },
  'fiscal.rounding.delta_cents': {
    scope: 'tenant',
    allowedTagKeys: ['mode', 'stage'],
    allowedValues: {
      mode: ['HALF_UP', 'HALF_DOWN', 'HALF_EVEN'],
      stage: ['PER_LINE', 'PER_TAX_BRACKET'],
    },
    cardinalityWarn: 6,
  },

  // ──── Payment ──────────────────────────────────────────────────
  'payment.mp.confirmed': { scope: 'tenant', allowedTagKeys: [] },
  'payment.mp.timeout': { scope: 'tenant', allowedTagKeys: [] },

  // ──── System (cross-tenant) ─────────────────────────────────────
  'system.rate_limit.hit': {
    scope: 'system',
    allowedTagKeys: ['endpoint'],
    cardinalityWarn: 50,
  },
  'system.cross_tenant.blocked': {
    scope: 'system',
    allowedTagKeys: [],
  },
  'system.price_tampering_attempt': {
    scope: 'tenant',
    allowedTagKeys: [],
  },
  'system.webhook.replay_detected': {
    scope: 'system',
    allowedTagKeys: ['provider'],
    allowedValues: { provider: ['mercadopago', 'afip'] },
    cardinalityWarn: 5,
  },

  // ──── Cash session ──────────────────────────────────────────────
  'cash_session.diff.amount': {
    scope: 'tenant',
    allowedTagKeys: ['sign'],
    allowedValues: { sign: ['positive', 'negative', 'zero'] },
    cardinalityWarn: 3,
  },
} as const;

export type MetricName = keyof typeof METRIC_WHITELIST;

export class MetricNotInWhitelistError extends Error {
  constructor(public readonly metric: string) {
    super(
      `Metric "${metric}" no esta en METRIC_WHITELIST. Agregar entry en ` +
        `src/lib/observability/metrics.ts con justificacion (bounded cardinality + utilidad).`
    );
    this.name = 'MetricNotInWhitelistError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MetricTagNotAllowedError extends Error {
  constructor(
    public readonly metric: string,
    public readonly tagKey: string,
    public readonly allowedKeys: readonly string[]
  ) {
    super(
      `Metric "${metric}": tag_key="${tagKey}" no permitido. ` +
        `Allowed: ${allowedKeys.length === 0 ? '(ninguno)' : allowedKeys.join(', ')}`
    );
    this.name = 'MetricTagNotAllowedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MetricTagValueNotAllowedError extends Error {
  constructor(
    public readonly metric: string,
    public readonly tagKey: string,
    public readonly tagValue: string,
    public readonly allowedValues: readonly string[]
  ) {
    super(
      `Metric "${metric}": tag_key="${tagKey}" tag_value="${tagValue}" no permitido. ` +
        `Allowed values: ${allowedValues.join(', ')}`
    );
    this.name = 'MetricTagValueNotAllowedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MetricTenantRequiredError extends Error {
  constructor(public readonly metric: string) {
    super(
      `Metric "${metric}" tiene scope=tenant pero no hay tenant_id en context. ` +
        `Llamar dentro de withTracingContext con tenant_id valido.`
    );
    this.name = 'MetricTenantRequiredError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface IncrementCounterOptions {
  tag?: { key: string; value: string };
  amount?: number;
  /** Para tests + casos de override system→tenant explicit. */
  overrideTenantId?: string;
}

/**
 * Prepara los valores del INSERT a metrics_counter — pure helper testeable
 * sin DB. Valida contra whitelist + resuelve tenant_id.
 *
 * @throws MetricNotInWhitelistError si metric_name no esta en catalogo
 * @throws MetricTagNotAllowedError si tag_key no esta en allowedTagKeys
 * @throws MetricTagValueNotAllowedError si tag_value no esta en allowedValues
 * @throws MetricTenantRequiredError si scope=tenant + no hay tenant_id context
 */
export function prepareMetricIncrement(
  metric: string,
  options: IncrementCounterOptions,
  ctxTenantId: string | null = getCurrentTenantId()
): {
  metric_name: string;
  tenant_id: string;
  tag_key: string;
  tag_value: string;
  amount: number;
} {
  const config = METRIC_WHITELIST[metric];
  if (!config) {
    throw new MetricNotInWhitelistError(metric);
  }

  const tagKey = options.tag?.key ?? '';
  const tagValue = options.tag?.value ?? '';

  // Validar tag_key
  if (tagKey !== '') {
    if (!config.allowedTagKeys.includes(tagKey)) {
      throw new MetricTagNotAllowedError(metric, tagKey, config.allowedTagKeys);
    }
    // Validar tag_value si la metrica tiene allowedValues para esa tag_key
    const allowedValues = config.allowedValues?.[tagKey];
    if (allowedValues && !allowedValues.includes(tagValue)) {
      throw new MetricTagValueNotAllowedError(
        metric,
        tagKey,
        tagValue,
        allowedValues
      );
    }
  }

  // Resolucion tenant_id segun scope
  let tenantId: string;
  if (config.scope === 'system') {
    // System metrics SIEMPRE usan SYSTEM_TENANT_ID — ignora context
    tenantId = env.SYSTEM_TENANT_ID;
  } else {
    // Tenant scope: override > context > throw
    const resolved = options.overrideTenantId ?? ctxTenantId;
    if (!resolved) {
      throw new MetricTenantRequiredError(metric);
    }
    tenantId = resolved;
  }

  return {
    metric_name: metric,
    tenant_id: tenantId,
    tag_key: tagKey,
    tag_value: tagValue,
    amount: options.amount ?? 1,
  };
}

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Incrementa atomico de counter en metrics_counter (UPSERT ON CONFLICT).
 *
 * F0: usa INSERT ... ON CONFLICT DO UPDATE desde TS. F1+ podria migrar a
 * funcion plpgsql `increment_counter(...)` si performance lo amerita
 * (~1 roundtrip menos).
 *
 * NO emite warning de cardinality runtime — eso es cron mensual que
 * compara contra METRIC_WHITELIST.cardinalityWarn.
 */
export async function incrementCounter(
  metric: string,
  options: IncrementCounterOptions = {},
  txOrDb: DbOrTransaction = db
): Promise<void> {
  const values = prepareMetricIncrement(metric, options);

  try {
    await txOrDb
      .insert(metrics_counter)
      .values({
        metric_name: values.metric_name,
        tenant_id: values.tenant_id,
        tag_key: values.tag_key,
        tag_value: values.tag_value,
        count: BigInt(values.amount),
      })
      .onConflictDoUpdate({
        target: [
          metrics_counter.metric_name,
          metrics_counter.tenant_id,
          metrics_counter.tag_key,
          metrics_counter.tag_value,
        ],
        set: {
          count: getCountIncrement(values.amount),
          last_incremented_at: new Date(),
        },
      });
  } catch (err) {
    // metrics NO debe bloquear el flow operativo — solo warn.
    logger.warn(
      { event: 'metrics.increment_failed', metric, err },
      'metrics_counter INSERT fallo — no bloquea operacion'
    );
  }
}

// Helper para SQL atomic increment via Drizzle sql template
function getCountIncrement(amount: number) {
  return sql`${metrics_counter.count} + ${BigInt(amount)}`;
}
