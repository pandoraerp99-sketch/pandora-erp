/**
 * Catalogo canonico de event_names F0 — EVENT-TAXONOMY.md §5 v2.2.0.
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

  // Domain: expense (6) — v2.1.0. Plata que sale; en mercadería, stock que entra
  'expense.registered',
  'expense.annulled',
  // v2.2.0 — cuenta corriente de PROVEEDORES (ítem 9 del pedido de la
  // contadora), espejo de customer.account.*. Aprobado por el owner el
  // 2026-09-17: el catálogo es cerrado y agregar un nombre no es decisión del
  // que escribe el código.
  //
  // `settled` es plata que sale del cajón FUERA de una venta: si el arqueo no
  // cierra, es de los primeros movimientos a mirar. `adjusted` toca un saldo
  // a mano, que es justo lo que hay que poder auditar después.
  'supplier.account.settled',
  'supplier.account.adjusted',
  // v2.3.0 — adjuntar el comprobante (ítem 12 del pedido de la contadora).
  // Aprobado por el owner el 2026-09-19; el catálogo es cerrado.
  //
  // `removed` es el que importa: si la contadora confirma que la copia digital
  // ES el respaldo (A-31), borrar un adjunto destruye el respaldo de un gasto y
  // eso tiene que dejar huella. `added` va para poder contestar "quién lo
  // subió" sin abrir el archivo — que puede tener datos de un tercero (B-11).
  'expense.attachment_added',
  'expense.attachment_removed',

  // Domain: order (4) — v2.4.0, pedidos con seña (ADR-0029, 2026-11-18).
  // Agregados por la delegación de la misión del 2026-11-18 y RATIFICADOS por
  // el owner el mismo día. Un pedido
  // mueve plata real en la caja: sin estos cuatro, una seña cobrada no
  // dejaría huella auditable. order.payment.received es el que hay que mirar
  // si el arqueo no cierra.
  'order.created',
  'order.updated',
  'order.status_changed',
  'order.payment.received',

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
 * Total: 57 eventos auditables F0 = 43 hasta v2.0.3 + 6 de v2.1.0 (owner
 * 2026-09-14) + 2 de v2.2.0 (owner 2026-09-17) + 2 de v2.3.0 (owner
 * 2026-09-19) + 4 de v2.4.0 (pedidos, ratificados por el owner 2026-11-18).
 *
 * Este desglose decía "49" y ya se había sumado la v2.2.0: un total declarado
 * que no cerraba con su propia lista, justo debajo de ella. Al agregar un
 * evento, este comentario se actualiza en el mismo edit.
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
