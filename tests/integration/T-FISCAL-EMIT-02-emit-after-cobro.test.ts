/**
 * T-FISCAL-EMIT-02 — emitAfterCobro (cableado post-cobro, Sprint 6 slice 5).
 *
 * Valida la orquestación resiliente que el POS llama tras finalizeSale:
 *
 *   AFTER-01 con factura + cliente disponible → emite (issued), venta issued
 *   AFTER-02 con factura + SIN cliente (sin cert) → skip, venta queda pending,
 *            el COBRO sigue intacto (cobrada) — fail-closed A-2
 *   AFTER-03 sin factura (not_required) → no-op
 *   AFTER-04 emitAfterCobro NUNCA lanza (best-effort) aunque el factory falle
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
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
import { emitAfterCobro } from '@/lib/fiscal/emit-after-cobro';
import type { CaeRequester } from '@/lib/fiscal/emit-invoice';
import type { RequestCaeResult } from '@/lib/integrations/afip/wsfev1-client';

const fakeIssuedClient: CaeRequester = {
  requestCae: async () =>
    ({
      outcome: 'issued',
      resultado: 'A',
      cae: '75123456789012',
      caeVto: '20260720',
      cbteDesde: 1,
      observaciones: [],
      errors: [],
      raw: '<resp/>',
    }) as RequestCaeResult,
};

describe('T-FISCAL-EMIT-02 — emitAfterCobro', () => {
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
      name: 'T-FISCAL-EMIT-02 Co',
      legal_name: 'T-FISCAL-EMIT-02 Co SRL',
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
      email: `t-fiscal-emit-02-${tenantId.slice(0, 8)}@test.local`,
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
      name: 'Producto',
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

  const cobrar = async (requireFiscal: boolean): Promise<string> =>
    withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      await addItemToSale({ sale_id: draft.id, product_id: productId, quantity: '1' });
      await finalizeSale({
        sale_id: draft.id,
        require_fiscal_invoice: requireFiscal,
        payments: [{ method: 'tarjeta', amount: '121.00' }],
      });
      return draft.id;
    });

  const statusOf = async (saleId: string) => {
    const r = await db
      .select({ c: sales.commercial_status, f: sales.fiscal_status })
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);
    return r[0]!;
  };

  it('AFTER-01 con factura + cliente disponible → emite (issued)', async () => {
    const saleId = await cobrar(true);
    const res = await withCtx(() =>
      emitAfterCobro(saleId, { getClient: async () => fakeIssuedClient })
    );
    expect(res.emitted).toBe(true);
    expect(res.outcome).toBe('issued');
    expect(res.cae).toBe('75123456789012');
    expect((await statusOf(saleId)).f).toBe('issued');
  });

  it('AFTER-02 con factura + SIN cliente (default sin cert) → pending, cobro intacto', async () => {
    const saleId = await cobrar(true);
    const res = await withCtx(() => emitAfterCobro(saleId)); // factory real → null

    expect(res.emitted).toBe(false);
    expect(res.reason).toBe('fiscal_client_unavailable');
    const st = await statusOf(saleId);
    expect(st.f).toBe('pending'); // factura diferida
    expect(st.c).toBe('cobrada'); // el COBRO no se rompió
  });

  it('AFTER-03 sin factura (not_required) → no-op', async () => {
    const saleId = await cobrar(false);
    const res = await withCtx(() =>
      emitAfterCobro(saleId, { getClient: async () => fakeIssuedClient })
    );
    expect(res.emitted).toBe(false);
    expect(res.reason).toBe('not_pending');
    expect((await statusOf(saleId)).f).toBe('not_required');
  });

  it('AFTER-04 best-effort: si el factory falla, NO lanza y deja la venta pending', async () => {
    const saleId = await cobrar(true);
    const res = await withCtx(() =>
      emitAfterCobro(saleId, {
        getClient: async () => {
          throw new Error('factory boom');
        },
      })
    );
    expect(res.emitted).toBe(false);
    expect(res.reason).toBe('fiscal_client_unavailable');
    expect((await statusOf(saleId)).f).toBe('pending');
  });
});
