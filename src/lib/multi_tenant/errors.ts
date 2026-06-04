/**
 * Errores tipados de dominio.
 * CLAUDE.md §15.7 — boundary atrapa estos errores con respuesta formateada.
 */

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly messageEs: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(messageEs);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CrossTenantAccessError extends DomainError {
  constructor(
    public readonly attempted_tenant_id: string,
    public readonly actor_tenant_id: string | null,
    public readonly resource: string
  ) {
    super(
      'CROSS_TENANT_ACCESS',
      'Acceso denegado a recurso de otro comercio',
      403,
      { attempted_tenant_id, actor_tenant_id, resource }
    );
  }
}

export class FiscalIntegrityError extends DomainError {
  constructor(messageEs: string, details?: Record<string, unknown>) {
    super('FISCAL_INTEGRITY', messageEs, 422, details);
  }
}

export class MoneyError extends DomainError {
  constructor(messageEs: string, details?: Record<string, unknown>) {
    super('MONEY_ERROR', messageEs, 400, details);
  }
}

export class ValidationError extends DomainError {
  constructor(messageEs: string, public readonly fieldErrors: Record<string, string>) {
    super('VALIDATION_ERROR', messageEs, 422, { fieldErrors });
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, identifier: string) {
    super('NOT_FOUND', `${resource} no encontrado`, 404, { resource, identifier });
  }
}

export class UnauthorizedError extends DomainError {
  constructor(reason: string) {
    super('UNAUTHORIZED', 'No autorizado', 401, { reason });
  }
}

export class StateTransitionError extends DomainError {
  constructor(
    public readonly entity: string,
    public readonly fromState: string,
    public readonly toState: string
  ) {
    super(
      'INVALID_STATE_TRANSITION',
      `Transicion invalida en ${entity}: ${fromState} -> ${toState}`,
      422,
      { entity, fromState, toState }
    );
  }
}

/**
 * Lanzado cuando writeAuditLog recibe un event_name que NO esta
 * en el catalogo canonico (EVENT-TAXONOMY §5).
 *
 * Es bug de programacion (developer error), por eso 500 — no 422.
 * El handler debe loggearlo como fatal + crash el flow.
 */
export class AuditEventNotInCatalogError extends DomainError {
  constructor(public readonly attempted_event_name: string) {
    super(
      'AUDIT_EVENT_NOT_IN_CATALOG',
      `event_name no esta en catalogo EVENT-TAXONOMY: "${attempted_event_name}"`,
      500,
      { attempted_event_name }
    );
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
