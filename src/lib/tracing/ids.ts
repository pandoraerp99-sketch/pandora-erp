/**
 * IDs canonicos para tracing.
 * CORRELATION-PROPAGATION.md v1.0.0 §2.
 * - correlation_id: life span = operacion logica (segundos a horas)
 * - request_id: life span = un HTTP request o un job attempt
 */

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Resuelve IDs entrantes desde headers HTTP (trust boundary) — pure helper.
 *
 * Si el header crudo es un UUID v4 valido, lo respeta (cliente/middleware previo
 * lo seteo correctamente). Si es null/undefined/invalido, genera uno nuevo.
 *
 * Retorna flags `*_was_generated` para que el proxy Edge pueda emitir
 * `x-correlation-id-generated: true` y detectar clientes que olvidan setear
 * `x-correlation-id` (warning log en lista cerrada de exempt paths).
 *
 * Extraido como pure helper desde withServerActionTracing para poder testear
 * el contrato del trust boundary sin mockear next/headers + session
 * (fix advisor 2026-06-02 Sprint 2 #1).
 *
 * Edge-compatible: solo usa crypto.randomUUID (Web Crypto) + RegExp.
 */
export interface ResolveInboundIdsResult {
  correlation_id: string;
  request_id: string;
  correlation_was_generated: boolean;
  request_was_generated: boolean;
}

export function resolveInboundIds(
  rawCorrelationId: string | null | undefined,
  rawRequestId: string | null | undefined
): ResolveInboundIdsResult {
  const cidValid = !!rawCorrelationId && isValidUuid(rawCorrelationId);
  const ridValid = !!rawRequestId && isValidUuid(rawRequestId);
  return {
    correlation_id: cidValid ? rawCorrelationId! : generateCorrelationId(),
    request_id: ridValid ? rawRequestId! : generateRequestId(),
    correlation_was_generated: !cidValid,
    request_was_generated: !ridValid,
  };
}
