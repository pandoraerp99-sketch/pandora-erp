/**
 * T-INV-06 — CHECK constraints SQL en stock_movements.
 * Sprint 3 ROADMAP Inventory + CLAUDE.md §16.6 (defense-in-depth).
 *
 * **Filosofía defense-in-depth (capa 1 = service, capa 2 = DB):**
 * El service `recordStockMovement` valida input ANTES de INSERT. Pero si
 * alguien bypassa el service (cliente Drizzle directo, psql, migration mal
 * escrita, bug), los CHECK constraints DB son la red de seguridad final.
 *
 * **5 CHECK constraints en migration `0000_workaround_drizzle_kit_bigint_bug.sql`
 * (idénticos a los del schema TS, ver _common.ts STOCK_MOVEMENT_TYPES):**
 * 1. `stock_movements_type_check` — type ∈ {sale, purchase, adjustment, return, loss}
 * 2. `stock_movements_qty_positive` — qty > 0 (siempre positiva, signo deriva de type)
 * 3. `stock_movements_adjustment_reason` — adjustment requiere reason no vacío
 * 4. `stock_movements_related_exclusive` — sale_id Y purchase_id NO ambos seteados
 * 5. `stock_movements_sale_requires_related` — type='sale' requiere related_sale_id
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { sales } from '@/lib/db/schema/sales';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { generateCorrelationId } from '@/lib/tracing/ids';

function unwrapPgError(e: unknown): { code?: string; message: string; constraint?: string } {
  if (e && typeof e === 'object') {
    const err = e as { message?: string; code?: string; cause?: unknown };
    const cause = err.cause as { code?: string; message?: string; constraint_name?: string } | undefined;
    return {
      code: cause?.code ?? err.code,
      message: cause?.message ?? err.message ?? String(e),
      constraint: cause?.constraint_name,
    };
  }
  return { message: String(e) };
}

describe('T-INV-06 — CHECK constraints SQL stock_movements (defense layered)', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const saleId = crypto.randomUUID();

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-INV-06 Test Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userId,
      email: `t-inv-06-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Test',
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
      name: 'T-INV-06 Producto',
      unit_type: 'unidad',
      price: '100.0000',
      tax_rate: '21.00',
      stock_current: '100.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });
    await db.insert(sales).values({
      id: saleId,
      tenant_id: tenantId,
      correlation_id: generateCorrelationId(),
      cashier_user_id: userId,
      commercial_status: 'cobrando',
      fiscal_status: 'not_required',
    });
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  // Helper: INSERT raw bypassing Drizzle's runtime type-checks.
  async function rawInsert(values: {
    tenant_id?: string;
    product_id?: string;
    type: string;
    qty: string;
    reason?: string | null;
    related_sale_id?: string | null;
    related_purchase_id?: string | null;
  }): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof unwrapPgError> }> {
    try {
      await db.execute(sql`
        INSERT INTO stock_movements (
          tenant_id, product_id, type, qty, reason,
          related_sale_id, related_purchase_id
        ) VALUES (
          ${values.tenant_id ?? tenantId}::uuid,
          ${values.product_id ?? productId}::uuid,
          ${values.type},
          ${values.qty}::numeric,
          ${values.reason ?? null},
          ${values.related_sale_id ?? null}::uuid,
          ${values.related_purchase_id ?? null}::uuid
        )
      `);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: unwrapPgError(e) };
    }
  }

  it('type fuera del catálogo cerrado → stock_movements_type_check', async () => {
    // 'cucharada' NO está en STOCK_MOVEMENT_TYPES enum.
    const result = await rawInsert({
      type: 'cucharada',
      qty: '5',
      reason: 'test invalid type',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('23514');
      expect(result.error.constraint).toBe('stock_movements_type_check');
    }
  });

  it('qty = 0 → stock_movements_qty_positive', async () => {
    const result = await rawInsert({
      type: 'adjustment',
      qty: '0',
      reason: 'cero invalid',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.constraint).toBe('stock_movements_qty_positive');
    }
  });

  it('qty negativa → stock_movements_qty_positive', async () => {
    const result = await rawInsert({
      type: 'adjustment',
      qty: '-1',
      reason: 'negativa invalid',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.constraint).toBe('stock_movements_qty_positive');
    }
  });

  it('adjustment + reason=NULL → stock_movements_adjustment_reason', async () => {
    const result = await rawInsert({
      type: 'adjustment',
      qty: '5',
      reason: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.constraint).toBe('stock_movements_adjustment_reason');
    }
  });

  it('adjustment + reason="" → stock_movements_adjustment_reason', async () => {
    const result = await rawInsert({
      type: 'adjustment',
      qty: '5',
      reason: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.constraint).toBe('stock_movements_adjustment_reason');
    }
  });

  it('sale + related_sale_id=NULL → stock_movements_sale_requires_related', async () => {
    const result = await rawInsert({
      type: 'sale',
      qty: '1',
      related_sale_id: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.constraint).toBe('stock_movements_sale_requires_related');
    }
  });

  it('related_sale_id + related_purchase_id ambos seteados → stock_movements_related_exclusive', async () => {
    const result = await rawInsert({
      type: 'adjustment',
      qty: '1',
      reason: 'transfer cross-domain inválido',
      related_sale_id: saleId,
      related_purchase_id: crypto.randomUUID(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.constraint).toBe('stock_movements_related_exclusive');
    }
  });

  it('INSERT válido (sale con related_sale_id + qty positiva) → OK', async () => {
    // Confirmación positiva: con todos los CHECK satisfechos, el INSERT pasa.
    const result = await rawInsert({
      type: 'sale',
      qty: '2',
      related_sale_id: saleId,
    });
    expect(result.ok).toBe(true);
  });
});
