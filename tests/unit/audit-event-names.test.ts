import { describe, expect, it } from 'vitest';
import {
  AUDIT_EVENT_NAMES,
  TOTAL_AUDIT_EVENTS_F0,
  isAuditEventName,
} from '@/lib/audit/event-names';

describe('Catalogo canonico audit event names (EVENT-TAXONOMY §5 v2.3.0)', () => {
  it('total 53 eventos auditables F0', () => {
    // 51 + los dos de ADJUNTOS del comprobante (v2.3.0, ítem 12 del pedido de
    // la contadora, aprobados por el owner el 2026-09-19).
    //
    // El que obliga a pasar por EVENT-TAXONOMY.md (regla J1) es el LITERAL de
    // acá: `TOTAL_AUDIT_EVENTS_F0` es `AUDIT_EVENT_NAMES.length`, o sea
    // derivado, y por sí solo acompañaría cualquier agregado en silencio. El
    // comentario anterior decía que ese número iba "a mano"; de la constante
    // no era cierto.
    expect(TOTAL_AUDIT_EVENTS_F0).toBe(53);
    expect(AUDIT_EVENT_NAMES).toHaveLength(53);
  });

  it('v2.3.0: adjuntos del comprobante (aprobados por el owner 2026-09-19)', () => {
    // `removed` es el que importa: si la copia digital resulta ser el respaldo
    // (A-31, pendiente de la contadora), borrar un adjunto destruye el respaldo
    // de un gasto y no puede pasar sin huella.
    expect(isAuditEventName('expense.attachment_added')).toBe(true);
    expect(isAuditEventName('expense.attachment_removed')).toBe(true);
  });

  it('v2.2.0: el otro lado del mostrador (aprobados por el owner 2026-09-17)', () => {
    // Espejo de customer.account.*: pagarle a un proveedor en efectivo saca
    // plata del cajón FUERA de una venta, y tocar un saldo a mano es
    // justamente lo que hay que poder auditar después.
    expect(isAuditEventName('supplier.account.settled')).toBe(true);
    expect(isAuditEventName('supplier.account.adjusted')).toBe(true);
    // Excluido por el mismo motivo que `customer.account.charged`: la deuda
    // nace del gasto, y ese ya emite `expense.registered`.
    expect(isAuditEventName('supplier.account.charged')).toBe(false);
  });

  it('v2.1.0: plata y acceso (aprobados por el owner 2026-09-14)', () => {
    for (const nombre of [
      'expense.registered',
      'expense.annulled',
      'customer.account.settled',
      'customer.account.adjusted',
      'auth.accountant.granted',
      'auth.accountant.revoked',
    ]) {
      expect(isAuditEventName(nombre)).toBe(true);
    }
    // Excluidos a propósito (PROPUESTA-EVENTOS-AUDITORIA §3): un pendiente es
    // intención, y el fiado ya viaja en sale.completed.
    expect(isAuditEventName('task.created')).toBe(false);
    expect(isAuditEventName('customer.account.charged')).toBe(false);
  });

  it('isAuditEventName acepta eventos canonicos', () => {
    expect(isAuditEventName('sale.completed')).toBe(true);
    expect(isAuditEventName('sale.cancelled')).toBe(true);
    expect(isAuditEventName('product.created')).toBe(true);
    expect(isAuditEventName('product.price_changed')).toBe(true);
    expect(isAuditEventName('product.tax_rate_changed')).toBe(true);
    expect(isAuditEventName('product.tdf_exempt_changed')).toBe(true);
    expect(isAuditEventName('product.deactivated')).toBe(true);
    expect(isAuditEventName('product.bulk_imported')).toBe(true);
    expect(isAuditEventName('stock.adjusted_manually')).toBe(true);
    expect(isAuditEventName('fiscal.invoice.cae_received')).toBe(true);
    expect(isAuditEventName('system.cross_tenant_attempt_blocked')).toBe(true);
  });

  it('isAuditEventName rechaza eventos viejos (drift detectado en auditoria 2026-05-30)', () => {
    // Estos eran los nombres "informales" que tenia mi codigo antes del refactor.
    // EVENT-TAXONOMY §5 los rechaza explicitamente: van a Pino log, NO a audit.
    expect(isAuditEventName('product.updated')).toBe(false);
    expect(isAuditEventName('sale.draft_created')).toBe(false);
    expect(isAuditEventName('sale.item_added')).toBe(false);
    expect(isAuditEventName('sale.item_quantity_updated')).toBe(false);
    expect(isAuditEventName('sale.item_removed')).toBe(false);
    expect(isAuditEventName('sale.customer_set')).toBe(false);
    expect(isAuditEventName('sale.finalized')).toBe(false);
    expect(isAuditEventName('stock.adjusted')).toBe(false);
  });

  it('isAuditEventName rechaza strings arbitrarios', () => {
    expect(isAuditEventName('')).toBe(false);
    expect(isAuditEventName('foo.bar')).toBe(false);
    expect(isAuditEventName('SALE.COMPLETED')).toBe(false);
    expect(isAuditEventName('sale_completed')).toBe(false);
    expect(isAuditEventName('sale')).toBe(false);
  });

  it('todos los eventos siguen naming convention {domain}.{action}', () => {
    // Domain puede tener underscore (ej: 'cash_session') segun EVENT-TAXONOMY §6.
    // Cada segmento es [a-z_]+ separado por puntos. Minimo 2 segmentos.
    for (const name of AUDIT_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
      expect(name).toBe(name.toLowerCase());
    }
  });

  it('dominios permitidos F0 cubren todos los eventos', () => {
    const allowedDomains = new Set([
      'auth',
      'sale',
      'fiscal',
      'payment',
      'stock',
      'product',
      'cash_session',
      'customer',
      'expense',
      // v2.2.0. Dominio propio y no `expense.supplier_*` por simetría con
      // `customer.account.*`: es la misma cuenta corriente del otro lado del
      // mostrador, y leer los dos pares juntos es lo que hace obvio que uno
      // sea el espejo del otro.
      'supplier',
      'subscription',
      'system',
      'security',
    ]);

    for (const name of AUDIT_EVENT_NAMES) {
      const domain = name.split('.')[0]!;
      expect(allowedDomains.has(domain)).toBe(true);
    }
  });

  it('no hay duplicados', () => {
    const set = new Set(AUDIT_EVENT_NAMES);
    expect(set.size).toBe(AUDIT_EVENT_NAMES.length);
  });

  it('dominio product tiene los 6 eventos esperados v2.0.2', () => {
    const productEvents = AUDIT_EVENT_NAMES.filter((n) =>
      n.startsWith('product.')
    );
    expect(productEvents).toHaveLength(6);
    expect(productEvents).toEqual(
      expect.arrayContaining([
        'product.created',
        'product.deactivated',
        'product.price_changed',
        'product.tax_rate_changed',
        'product.tdf_exempt_changed',
        'product.bulk_imported',
      ])
    );
  });
});
