/**
 * Tracing context via AsyncLocalStorage (Node runtime only).
 * CORRELATION-PROPAGATION.md §3.
 *
 * Provee correlation_id + request_id + tenant_id + actor a TODA la capa server
 * sin pasar argumentos manualmente. Pino auto-inject + audit_log auto-inject leen
 * desde aca.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ActorType } from '../db/schema/_common.js';

export interface TracingContext {
  correlation_id: string;
  request_id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_type: ActorType;
}

const tracingStorage = new AsyncLocalStorage<TracingContext>();

export function getTracingContext(): TracingContext | undefined {
  return tracingStorage.getStore();
}

export function requireTracingContext(): TracingContext {
  const ctx = tracingStorage.getStore();
  if (!ctx) {
    throw new Error(
      'Tracing context no esta inicializado. Envolver la operacion en withTracingContext().'
    );
  }
  return ctx;
}

export function withTracingContext<T>(
  context: TracingContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return tracingStorage.run(context, fn);
}

export function getCurrentTenantId(): string | null {
  return tracingStorage.getStore()?.tenant_id ?? null;
}

export function requireTenantId(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error(
      'tenant_id requerido pero no esta en el tracing context. ' +
        'Esta operacion probablemente esta fuera de un Server Action / Route Handler / Worker.'
    );
  }
  return tenantId;
}

export function getCurrentCorrelationId(): string | null {
  return tracingStorage.getStore()?.correlation_id ?? null;
}

export function getCurrentRequestId(): string | null {
  return tracingStorage.getStore()?.request_id ?? null;
}

export function getCurrentActor(): { user_id: string | null; type: ActorType } | null {
  const ctx = tracingStorage.getStore();
  if (!ctx) return null;
  return { user_id: ctx.actor_user_id, type: ctx.actor_type };
}
