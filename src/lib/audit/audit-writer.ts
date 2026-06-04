/**
 * Audit writer helper.
 * Toda Application Service que muta datos debe llamar writeAuditLog()
 * dentro de la misma transaccion que la mutacion (CLAUDE.md §15.2).
 *
 * El tenant_id, actor_user_id, actor_type, correlation_id, request_id
 * se inyectan desde el tracing context AsyncLocalStorage.
 *
 * event_name DEBE estar en el catalogo canonico (EVENT-TAXONOMY §5).
 * Si no esta, se lanza AuditEventNotInCatalogError — es bug de programacion
 * y el handler debe loguearlo como fatal.
 *
 * override_tenant_id solo permitido para actor_type='system'|'support' —
 * previene developer error de auditar al tenant equivocado.
 */
import { env } from '../env.js';
import { audit_log, type NewAuditLog } from '../db/schema/audit.js';
import { db } from '../db/client.js';
import { requireTracingContext } from '../tracing/context.js';
import type { TracingContext } from '../tracing/context.js';
import { isValidUuid } from '../tracing/ids.js';
import {
  AuditEventNotInCatalogError,
  CrossTenantAccessError,
} from '../multi_tenant/errors.js';
import type { PiiLevel, Severity } from '../db/schema/_common.js';
import { logger } from '../observability/logger.js';
import { scrubSecretsFromPayload } from '../observability/scrub.js';
import { isAuditEventName, type AuditEventName } from './event-names.js';

export interface AuditLogInput {
  event_name: AuditEventName;
  event_version?: number;
  payload: Record<string, unknown>;
  pii_level?: PiiLevel;
  severity?: Severity;
  /**
   * Override del tenant_id del context. SOLO permitido cuando
   * actor_type === 'system' o 'support'. Para audits cross-tenant
   * del system (ej: cron de mantenimiento).
   */
  override_tenant_id?: string;
}

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Prepara los valores del INSERT a audit_log — pure helper testeable sin DB.
 *
 * Hace todas las validaciones criticas:
 * - event_name pertenece al catalogo canonico
 * - override_tenant_id UUID format valido (trust boundary)
 * - override_tenant_id solo permitido para system|support (multi-tenant guard)
 * - tenant_id resolution: override → ctx → SYSTEM_TENANT_ID fallback
 * - defaults: event_version=1, pii_level='internal', severity='info'
 * - **scrub payload secrets** — advisor fix 2026-06-02. audit_log es 10 anios
 *   inmutable (Ley 11.683 + trigger SQL); cualquier secret en payload queda
 *   PARA SIEMPRE. Trust-the-caller NO escala (mismo aprendizaje Sprint 2 #2
 *   Pino redact). Scrubeamos antes de devolver + warning Pino visible.
 *
 * @throws AuditEventNotInCatalogError si event_name no esta en catalogo
 * @throws CrossTenantAccessError si override_tenant_id sin actor adecuado
 *   O si override_tenant_id no es UUID valido
 */
export function prepareAuditLogValues(
  input: AuditLogInput,
  ctx: TracingContext
): NewAuditLog {
  if (!isAuditEventName(input.event_name)) {
    throw new AuditEventNotInCatalogError(input.event_name);
  }

  // Trust boundary: override_tenant_id viene del caller. Validar UUID format
  // antes de propagar — sin esto, `override_tenant_id: ''` o `'not-a-uuid'`
  // produce INSERT con tenant_id invalido y error feo de Postgres.
  // Fix advisor 2026-06-02.
  if (input.override_tenant_id !== undefined) {
    if (!isValidUuid(input.override_tenant_id)) {
      throw new CrossTenantAccessError(
        input.override_tenant_id,
        ctx.tenant_id,
        'audit_log.override_tenant_id (UUID format invalido)'
      );
    }
    if (ctx.actor_type !== 'system' && ctx.actor_type !== 'support') {
      throw new CrossTenantAccessError(
        input.override_tenant_id,
        ctx.tenant_id,
        'audit_log.override_tenant_id'
      );
    }
  }

  const tenantId =
    input.override_tenant_id ?? ctx.tenant_id ?? env.SYSTEM_TENANT_ID;

  // Scrub secrets antes de persistir. Si scrubbedPaths > 0, el caller
  // metio un secret accidentalmente — Pino warn lo hace visible al dev
  // sin bloquear el audit (audit_log es operacionalmente critico).
  const { scrubbed, scrubbedPaths } = scrubSecretsFromPayload(input.payload);
  if (scrubbedPaths.length > 0) {
    logger.warn(
      {
        event: 'audit.payload.secrets_scrubbed',
        event_name: input.event_name,
        scrubbed_paths: scrubbedPaths,
      },
      'audit_log payload contenia secrets en cleartext (scrubeado a [REDACTED]) — bug del caller, revisar'
    );
  }

  return {
    event_name: input.event_name,
    event_version: input.event_version ?? 1,
    tenant_id: tenantId,
    actor_user_id: ctx.actor_user_id,
    actor_type: ctx.actor_type,
    correlation_id: ctx.correlation_id,
    request_id: ctx.request_id,
    payload: scrubbed,
    pii_level: input.pii_level ?? 'internal',
    severity: input.severity ?? 'info',
  };
}

export async function writeAuditLog(
  input: AuditLogInput,
  txOrDb: DbOrTransaction = db
): Promise<void> {
  const ctx = requireTracingContext();
  const values = prepareAuditLogValues(input, ctx);
  await txOrDb.insert(audit_log).values(values);
}
