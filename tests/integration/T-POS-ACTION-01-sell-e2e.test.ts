/**
 * T-POS-ACTION-01 — la cadena de Server Actions VENDE de verdad (Slice 5).
 *
 * Cierra el gap "typecheck verde ≠ funciona" de Slices 3+4: verifica que
 * el chain completo session → withServerActionTracing (bridge) → tracing
 * context (tenant_id) → service de ventas → DB funciona end-to-end, invocando
 * las MISMAS Server Actions que llama el POS cliente.
 *
 * Mockeamos solo el borde de Next (next/headers) + la sesión (getCurrentSession)
 * — como haría el proxy + Supabase Auth en runtime. Todo lo demás es real
 * (bridge, tracing, service, DB). Es lo que tracing.test.ts declaró que NO
 * cubría ("requiere mockear next/headers + auth/session").
 *
 * Cubre:
 *   1. Flujo feliz: startSale → addItem → finalize → 'cobrada' en la DB, con
 *      el tenant correcto inyectado por el bridge desde la sesión.
 *   2. Idempotency a nivel action: finalize 2x misma idempotency_key → replay,
 *      SIN doble cobro (ata el cableado de idempotency del cobro).
 *   3. El tenant sale de la SESIÓN, no del input (aislamiento multi-tenant).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { sales, sale_items } from '@/lib/db/schema/sales';
import { sale_payments } from '@/lib/db/schema/sale_payments';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { idempotency_log } from '@/lib/db/schema/idempotency_log';

// ── Mock del borde Next + sesión (lo que en runtime hacen proxy + Supabase) ──
const mocks = vi.hoisted(() => ({
  session: null as null | {
    user_id: string;
    email: string;
    active_company_id: string | null;
    available_company_ids: string[];
    app_role: string | null;
    is_support: boolean;
    access_token: string;
    expires_at: number;
  },
}));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Map([
      ['x-correlation-id', crypto.randomUUID()],
      ['x-request-id', crypto.randomUUID()],
    ]),
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: async () => mocks.session,
}));

// Importar las actions DESPUÉS de declarar los mocks.
import {
  startSaleAction,
  addItemAction,
  finalizeSaleAction,
} from '@/app/pos/actions';

describe('T-POS-ACTION-01 — Server Actions venden e2e', () => {
  let tenantId: string;
  let userId: string;
  let productId: string;

  const seed = async (stock: string): Promise<void> => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    productId = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-POS-ACTION Co',
      legal_name: 'T-POS-ACTION Co SRL',
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
      email: `t-pos-action-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cajero POS',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });
    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Producto POS action',
      unit_type: 'unidad',
      price: '100.0000',
      cost: '60.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: stock,
      stock_minimum: '1.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });

    // La sesión que "devolvería" Supabase Auth para este operador.
    mocks.session = {
      user_id: userId,
      email: 'op@test.local',
      active_company_id: tenantId,
      available_company_ids: [tenantId],
      app_role: 'owner',
      is_support: false,
      access_token: 'test',
      expires_at: 0,
    };
  };

  const cleanup = async (): Promise<void> => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(idempotency_log).where(eq(idempotency_log.tenant_id, tenantId));
      await tx.delete(sale_payments).where(eq(sale_payments.tenant_id, tenantId));
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
    mocks.session = null;
  };

  beforeEach(() => seed('10.0000'));
  afterEach(() => cleanup());

  it('flujo feliz: startSale → addItem → finalize → cobrada, tenant desde la sesión', async () => {
    const start = await startSaleAction();
    if (!start.ok) throw new Error(`startSale falló: ${start.error}`);
    expect(start.data.tenant_id).toBe(tenantId); // ← tenant vino de la sesión
    expect(start.data.commercial_status).toBe('draft');
    const saleId = start.data.id;

    const added = await addItemAction({
      sale_id: saleId,
      product_id: productId,
      quantity: '2.0000',
    });
    if (!added.ok) throw new Error(`addItem falló: ${added.error}`);
    expect(added.data.items).toHaveLength(1);

    // 2 * 100 * 1.21 = 242
    const key = crypto.randomUUID();
    const done = await finalizeSaleAction({
      sale_id: saleId,
      payments: [{ method: 'efectivo', amount: '242.0000' }],
      require_fiscal_invoice: false,
      idempotency_key: key,
    });
    if (!done.ok) throw new Error(`finalize falló: ${done.error}`);
    expect(done.data.sale.commercial_status).toBe('cobrada');

    // ── DB: stock 10 - 2 = 8, 1 sale.completed audit, 1 payment ──
    const prod = await db
      .select({ stock: products.stock_current })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(prod[0]?.stock).toBe('8.0000');

    const completed = await db
      .select({ id: audit_log.id })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'sale.completed')
        )
      );
    expect(completed).toHaveLength(1);

    const pays = await db
      .select({ id: sale_payments.id })
      .from(sale_payments)
      .where(eq(sale_payments.sale_id, saleId));
    expect(pays).toHaveLength(1);
  });

  it('idempotency a nivel action: finalize 2x misma key → replay, sin doble cobro', async () => {
    const start = await startSaleAction();
    if (!start.ok) throw new Error(start.error);
    const saleId = start.data.id;
    await addItemAction({ sale_id: saleId, product_id: productId, quantity: '2.0000' });

    const key = crypto.randomUUID();
    const input = {
      sale_id: saleId,
      payments: [{ method: 'efectivo' as const, amount: '242.0000' }],
      require_fiscal_invoice: false,
      idempotency_key: key,
    };

    const r1 = await finalizeSaleAction(input);
    const r2 = await finalizeSaleAction(input); // retry misma key
    if (!r1.ok) throw new Error(r1.error);
    if (!r2.ok) throw new Error(r2.error);
    expect(r1.data.sale.commercial_status).toBe('cobrada');
    expect(r2.data.sale.commercial_status).toBe('cobrada');

    // Efecto exactamente 1 vez: stock 10 - 2 = 8 (NO 6), 1 movimiento.
    const prod = await db
      .select({ stock: products.stock_current })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(prod[0]?.stock).toBe('8.0000');

    const movs = await db
      .select({ id: stock_movements.id })
      .from(stock_movements)
      .where(eq(stock_movements.related_sale_id, saleId));
    expect(movs).toHaveLength(1);
  });
});
