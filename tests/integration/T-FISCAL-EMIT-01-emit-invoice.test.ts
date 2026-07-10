/**
 * T-FISCAL-EMIT-01 — emitInvoice (Sprint 6 slice 4).
 *
 * Valida el servicio de emisión del CAE de punta a punta contra DB real, con el
 * Wsfev1Client FAKE (sin cert ni red). Cubre los 5 outcomes + numeración
 * correlativa + snapshot inmutable solo en éxito + guard idempotente.
 *
 *   EMIT-01 issued        → fiscal_status=issued, snapshot con CAE, número +1, audit cae_received
 *   EMIT-02 observed      → issued (CAE válido) + observaciones persistidas, número +1
 *   EMIT-03 rejected      → manual_resolution_required, SIN snapshot, número NO avanza
 *   EMIT-04 error request → manual_resolution_required, SIN snapshot, número NO avanza
 *   EMIT-05 timeout/red   → requires_reconciliation, SIN snapshot, número NO avanza
 *   EMIT-06 already_issued→ 2da emisión = no-op (idempotente), NO doble snapshot
 *
 * Correlatividad AFIP (§8.5): el número solo avanza cuando AFIP autoriza.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { sales, sale_items } from '@/lib/db/schema/sales';
import { sale_payments } from '@/lib/db/schema/sale_payments';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { invoice_sequences } from '@/lib/db/schema/invoice_sequences';
import { fiscal_snapshots } from '@/lib/db/schema/fiscal_snapshots';
import { audit_log } from '@/lib/db/schema/audit';
import { idempotency_log } from '@/lib/db/schema/idempotency_log';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  createDraftSale,
  addItemToSale,
  finalizeSale,
} from '@/lib/services/sales/sale.service';
import { emitInvoice, type CaeRequester } from '@/lib/fiscal/emit-invoice';
import type { RequestCaeResult } from '@/lib/integrations/afip/wsfev1-client';

// ── Fakes del cliente WSFEv1 (RequestCaeResult por outcome) ──────────────────
const base = { cbteDesde: null, observaciones: [], errors: [], raw: '<resp/>' };
const fakeIssued: CaeRequester = {
  requestCae: async () =>
    ({ ...base, outcome: 'issued', resultado: 'A', cae: '75123456789012', caeVto: '20260720' }) as RequestCaeResult,
};
const fakeObserved: CaeRequester = {
  requestCae: async () =>
    ({
      ...base,
      outcome: 'observed',
      resultado: 'A',
      cae: '75123456789099',
      caeVto: '20260720',
      observaciones: [{ code: '10063', msg: 'Dato observado' }],
    }) as RequestCaeResult,
};
const fakeRejected: CaeRequester = {
  requestCae: async () =>
    ({
      ...base,
      outcome: 'rejected',
      resultado: 'R',
      cae: null,
      caeVto: null,
      observaciones: [{ code: '10016', msg: 'no correlativo' }],
    }) as RequestCaeResult,
};
const fakeError: CaeRequester = {
  requestCae: async () =>
    ({ ...base, outcome: 'error', resultado: null, cae: null, caeVto: null, errors: [{ code: '600', msg: 'no auth' }] }) as RequestCaeResult,
};
const fakeTimeout: CaeRequester = {
  requestCae: async () => {
    throw new Error('ETIMEDOUT');
  },
};

describe('T-FISCAL-EMIT-01 — emitInvoice', () => {
  let tenantId: string;
  let userId: string;
  let productId: string;

  const withCtx = async <T,>(fn: () => Promise<T>): Promise<T> =>
    withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      fn
    );

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    productId = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-FISCAL-EMIT-01 Co',
      legal_name: 'T-FISCAL-EMIT-01 Co SRL',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userId,
      email: `t-fiscal-emit-01-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cashier',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });
    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Producto fiscal',
      unit_type: 'unidad',
      price: '100.0000',
      cost: '60.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: '1000.0000',
      stock_minimum: '1.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });
  });

  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(fiscal_snapshots).where(eq(fiscal_snapshots.tenant_id, tenantId));
      await tx.delete(invoice_sequences).where(eq(invoice_sequences.tenant_id, tenantId));
      await tx.delete(idempotency_log).where(eq(idempotency_log.tenant_id, tenantId));
      await tx.delete(sale_payments).where(eq(sale_payments.tenant_id, tenantId));
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tenantId));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  /** draft → addItem → finalize(require_fiscal=true) → sale cobrada + pending. */
  const cobradaPendingSale = async (): Promise<string> =>
    withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      await addItemToSale({ sale_id: draft.id, product_id: productId, quantity: '1' });
      await finalizeSale({
        sale_id: draft.id,
        require_fiscal_invoice: true,
        payments: [{ method: 'tarjeta', amount: '121.00' }],
      });
      return draft.id;
    });

  const fiscalStatusOf = async (saleId: string): Promise<string> => {
    const r = await db
      .select({ fs: sales.fiscal_status })
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);
    return r[0]!.fs;
  };
  const snapshotCountOf = async (saleId: string): Promise<number> => {
    const r = await db
      .select({ id: fiscal_snapshots.id })
      .from(fiscal_snapshots)
      .where(eq(fiscal_snapshots.sale_id, saleId));
    return r.length;
  };
  const nextNumberOf = async (): Promise<number | null> => {
    const r = await db
      .select({ n: invoice_sequences.next_number })
      .from(invoice_sequences)
      .where(
        and(
          eq(invoice_sequences.tenant_id, tenantId),
          eq(invoice_sequences.sale_point, 1),
          eq(invoice_sequences.invoice_type, 'B')
        )
      )
      .limit(1);
    return r[0]?.n ?? null;
  };

  it('EMIT-01 issued: fiscal_status=issued, snapshot con CAE, número avanza a 2', async () => {
    const saleId = await cobradaPendingSale();
    const result = await withCtx(() => emitInvoice(saleId, { client: fakeIssued }));

    expect(result.outcome).toBe('issued');
    expect(result.invoice_type).toBe('B'); // RI → consumidor final
    expect(result.invoice_number).toBe(1);
    expect(result.cae).toBe('75123456789012');
    expect(await fiscalStatusOf(saleId)).toBe('issued');
    expect(await snapshotCountOf(saleId)).toBe(1);
    expect(await nextNumberOf()).toBe(2);

    const audits = await db
      .select({ e: audit_log.event_name })
      .from(audit_log)
      .where(eq(audit_log.tenant_id, tenantId));
    expect(audits.map((a) => a.e)).toContain('fiscal.invoice.cae_received');
  });

  it('EMIT-02 observed: issued con CAE + observaciones persistidas, número avanza', async () => {
    const saleId = await cobradaPendingSale();
    const result = await withCtx(() => emitInvoice(saleId, { client: fakeObserved }));

    expect(result.outcome).toBe('issued');
    expect(result.observaciones).toEqual([{ code: '10063', msg: 'Dato observado' }]);
    expect(await fiscalStatusOf(saleId)).toBe('issued');
    expect(await snapshotCountOf(saleId)).toBe(1);
    expect(await nextNumberOf()).toBe(2);
  });

  it('EMIT-03 rejected: manual_resolution_required, SIN snapshot, número NO avanza', async () => {
    const saleId = await cobradaPendingSale();
    const result = await withCtx(() => emitInvoice(saleId, { client: fakeRejected }));

    expect(result.outcome).toBe('rejected');
    expect(await fiscalStatusOf(saleId)).toBe('manual_resolution_required');
    expect(await snapshotCountOf(saleId)).toBe(0);
    expect(await nextNumberOf()).toBe(1); // reusable — correlatividad AFIP
  });

  it('EMIT-04 error de request: manual_resolution_required, SIN snapshot, número NO avanza', async () => {
    const saleId = await cobradaPendingSale();
    const result = await withCtx(() => emitInvoice(saleId, { client: fakeError }));

    expect(result.outcome).toBe('rejected');
    expect(result.errors).toEqual([{ code: '600', msg: 'no auth' }]);
    expect(await fiscalStatusOf(saleId)).toBe('manual_resolution_required');
    expect(await snapshotCountOf(saleId)).toBe(0);
    expect(await nextNumberOf()).toBe(1);
  });

  it('EMIT-05 timeout/red: requires_reconciliation, SIN snapshot, número NO avanza', async () => {
    const saleId = await cobradaPendingSale();
    const result = await withCtx(() => emitInvoice(saleId, { client: fakeTimeout }));

    expect(result.outcome).toBe('reconciliation_pending');
    expect(await fiscalStatusOf(saleId)).toBe('requires_reconciliation');
    expect(await snapshotCountOf(saleId)).toBe(0);
    expect(await nextNumberOf()).toBe(1);
  });

  it('EMIT-06 already_issued: 2da emisión es no-op idempotente (sin doble snapshot)', async () => {
    const saleId = await cobradaPendingSale();
    await withCtx(() => emitInvoice(saleId, { client: fakeIssued }));
    const second = await withCtx(() => emitInvoice(saleId, { client: fakeIssued }));

    expect(second.outcome).toBe('already_issued');
    expect(await snapshotCountOf(saleId)).toBe(1); // NO doble
    expect(await nextNumberOf()).toBe(2); // NO avanzó de nuevo
  });
});
