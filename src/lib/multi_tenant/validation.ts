/**
 * Validacion multi-tenant en la capa de servicio.
 * CLAUDE.md §7.2 — defensa en profundidad: RLS Postgres + service validation.
 *
 * Toda Application Service que toca datos de tenant debe llamar
 * validateTenantAccess() con el recurso accedido vs el tenant_id del context.
 */
import { env } from '../env.js';
import { getCurrentTenantId, requireTenantId } from '../tracing/context.js';
import { CrossTenantAccessError } from './errors.js';

interface TenantOwned {
  tenant_id: string;
  id?: string | undefined;
}

export function validateTenantAccess<T extends TenantOwned>(
  resource: T,
  resourceName: string
): T {
  const currentTenantId = requireTenantId();

  if (resource.tenant_id !== currentTenantId) {
    throw new CrossTenantAccessError(
      resource.tenant_id,
      currentTenantId,
      resourceName
    );
  }

  return resource;
}

export function validateTenantAccessMany<T extends TenantOwned>(
  resources: T[],
  resourceName: string
): T[] {
  const currentTenantId = requireTenantId();

  for (const r of resources) {
    if (r.tenant_id !== currentTenantId) {
      throw new CrossTenantAccessError(r.tenant_id, currentTenantId, resourceName);
    }
  }

  return resources;
}

export function isSystemTenant(tenantId: string): boolean {
  return tenantId === env.SYSTEM_TENANT_ID;
}

export function isCurrentTenant(tenantId: string): boolean {
  return getCurrentTenantId() === tenantId;
}
