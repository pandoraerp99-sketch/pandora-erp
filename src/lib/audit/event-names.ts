/**
 * Catalogo canonico de event_names F0 — EVENT-TAXONOMY.md §5 v2.1.0.
 *
 * REGLA J1 (catalogo CERRADO): agregar evento aqui = agregar a EVENT-TAXONOMY +
 * PR review + actualizar DECISION-LEDGER. No agregar event names "on the fly".
 *
 * Cambios al catalogo bumpean version de EVENT-TAXONOMY.
 */

/**
 * Lista canonica de event_names que se admiten en audit_log.
 * Cualquier otro string que llegue a writeAuditLog() es rechazado por
 * audit-writer con AuditEventNotInCatalogError.
 *
 * Ordenado por dominio segun EVENT-TAXONOMY §5.
 */
export const AUDIT_EVENT_NAMES = [
  // Domain: auth (6)
  'auth.login.success',
  'auth.login.failed',
  'auth.password.changed',
  'auth.role.changed',
  // v2.1.0 — un tercero gana o pierde acceso a los datos del comercio
  'auth.accountant.granted',
  'auth.accountant.revoked',

  // Domain: sale (4)
  'sale.completed',
  'sale.cancelled',
  'sale.voided',
  'sale.refunded',

  // Domain: fiscal (8)
  'fiscal.invoice.cae_received',
  'fiscal.invoice.cae_rejected',
  'fiscal.invoice.requires_reconciliation',
  'fiscal.invoice.reconciled_issued',
  'fiscal.invoice.reconciliation_timeout',
  'fiscal.invoice.number_burned',
  'fiscal.invoice.manual_resolution_required',
  'fiscal.invariant_violation',

  // Domain: payment (4)
  'payment.cash.received',
  'payment.mp.confirmed',
  'payment.mp.refunded',
  'payment.method_reclassified', // ADR-0026 — corrección append-only de medio

  // Domain: stock (2)
  'stock.adjusted_manually',
  'stock.negative.allowed',

  // Domain: product (6) — agregado v2.0.2
  'product.created',
  'product.deactivated',
  'product.price_changed',
  'product.tax_rate_changed',
  'product.tdf_exempt_changed',
  'product.bulk_imported',

  // Domain: cash_session (3)
  'cash_session.opened',
  'cash_session.closed',
  'cash_session.closed_with_difference',

  // Domain: customer (4)
  'customer.created',
  'customer.deletion_requested',
  // v2.1.0 — cuenta corriente (ADR-0027): cobro y ajuste manual de deuda
  'customer.account.settled',
  'customer.account.adjusted',

  // Domain: expense (2) — v2.1.0. Plata que sale; en mercadería, stock que entra
  'expense.registered',
  'expense.annulled',

  // Domain: subscription (2)
  'subscription.activated',
  'subscription.suspended',

  // Domain: system + security — criticals (4)
  'system.cross_tenant_attempt_blocked',
  'system.price_tampering_attempt',
  'system.fiscal_emergency_stop_activated',
  'security.tls.validation_failed',

  // Sub-domain: system.dead_job.* (3)
  'system.dead_job.re_enqueued',
  'system.dead_job.discarded',
  'system.dead_job.resolved_manually',

  // Sub-domain: system.incident_handled (1)
  'system.incident_handled',
] as const;

export type AuditEventName = (typeof AUDIT_EVENT_NAMES)[number];

const AUDIT_EVENT_NAMES_SET: ReadonlySet<string> = new Set(AUDIT_EVENT_NAMES);

export function isAuditEventName(value: string): value is AuditEventName {
  return AUDIT_EVENT_NAMES_SET.has(value);
}

/**
 * Total: 49 eventos auditables F0 (43 hasta v2.0.3 + 6 de v2.1.0, aprobados por
 * el owner el 2026-09-14).
 *
 * Lo que va a Pino log (NO audit_log):
 * - sale.draft.* (lifecycle items, customer set durante draft)
 * - product.updated (campos triviales: name, description, sku, barcode)
 * - fiscal.wsaa.token_*, padron.cache_*, stock.reserved/released
 * - system.cron.executed, rate_limit_exceeded
 * - fiscal.invoice.requested/afip_request_sent (estado interno)
 *
 * Ver EVENT-TAXONOMY.md §5 "Lo que NO va a audit_log".
 */
export const TOTAL_AUDIT_EVENTS_F0 = AUDIT_EVENT_NAMES.length;
