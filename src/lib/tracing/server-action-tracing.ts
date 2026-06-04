/**
 * withServerActionTracing — bridge entre Edge middleware (que setea headers)
 * y Node server (que necesita AsyncLocalStorage).
 *
 * Toda Server Action / Route Handler que requiera tracing context debe
 * envolverse en este wrapper.
 *
 * CORRELATION-PROPAGATION.md §4.
 */
import { headers } from 'next/headers';
import type { ActorType } from '../db/schema/_common.js';
import { getCurrentSession } from '../auth/session.js';
import { withTracingContext } from './context.js';
import { generateCorrelationId, generateRequestId, resolveInboundIds } from './ids.js';

interface ServerActionTracingOptions {
  requireAuth?: boolean;
  fallbackTenantId?: string | null;
}

export async function withServerActionTracing<T>(
  fn: () => T | Promise<T>,
  options: ServerActionTracingOptions = {}
): Promise<T> {
  const { requireAuth = true, fallbackTenantId = null } = options;

  const h = await headers();
  const rawRequestId = h.get('x-request-id');
  const rawCorrelationId = h.get('x-correlation-id');

  // Trust boundary: headers vienen de Edge middleware. Validar UUID format
  // antes de propagar — sin esto, garbage correlation_ids manchan Pino + audit_log.
  const { correlation_id: correlationId, request_id: requestId } = resolveInboundIds(
    rawCorrelationId,
    rawRequestId
  );

  const session = await getCurrentSession();

  if (requireAuth && !session) {
    throw new Error('Server Action requiere autenticacion pero no hay session activa.');
  }

  const tenantId = session?.active_company_id ?? fallbackTenantId ?? null;
  const actorUserId = session?.user_id ?? null;

  // Fix advisor 2026-06-02: cuando NO hay session (requireAuth=false en endpoint
  // publico como webhook receiver / health), actor_type DEBE ser 'system', NO 'user'.
  // 'user' implica que hay user_id; loguear actor='user' con user_id=null mancha
  // audit_log con eventos huerfanos imposibles de atribuir.
  const actorType: ActorType = session
    ? session.is_support
      ? 'support'
      : 'user'
    : 'system';

  return withTracingContext(
    {
      correlation_id: correlationId,
      request_id: requestId,
      tenant_id: tenantId,
      actor_user_id: actorUserId,
      actor_type: actorType,
    },
    fn
  );
}

export async function withCronTracing<T>(
  fn: () => T | Promise<T>
): Promise<T> {
  return withTracingContext(
    {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      tenant_id: null,
      actor_user_id: null,
      actor_type: 'cron',
    },
    fn
  );
}

export async function withWorkerTracing<T>(
  options: {
    tenant_id: string;
    correlation_id: string;
  },
  fn: () => T | Promise<T>
): Promise<T> {
  return withTracingContext(
    {
      correlation_id: options.correlation_id,
      request_id: generateRequestId(),
      tenant_id: options.tenant_id,
      actor_user_id: null,
      actor_type: 'worker',
    },
    fn
  );
}
