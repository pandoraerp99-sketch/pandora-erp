/**
 * T-CASH-10 — Reclasificación de medio de pago (ADR-0026, append-only).
 *
 * Valida empíricamente la corrección de un medio mal cargado:
 *   - débito → efectivo: INSERT fila corrección (corrects_id), NO muta la original,
 *     sales.payment_method se recomputa, audit payment.method_reclassified, y el
 *     cierre auto-computa el efectivo INCLUYENDO la corrección (descuadre cierra).
 *   - efectivo → débito: la fila efectivo original queda SUPERSEDED → el cierre la
 *     excluye (descuadre igual-y-opuesto cierra).
 *   - Re-editable: una corrección se puede volver a corregir (cadena).
 *   - Guards: same_method, multi_payment_unsupported, cross-tenant.
 *
 * Patrón: sigue T-SALES-04 (seed/cleanup por test, sin shared state).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { sales, sale_items } from '@/lib/db/schema/sales';
import { sale_payments } from '@/lib/db/schema/sale_payments';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { createDraftSale, addItemToSale, finalizeSale } from '@/lib/services/sales/sale.service';
import { openCashSession, closeCashSession } from '@/lib/cash/sessions';
import {
  reclassifySalePaymentMethod,
  ReclassifyValidationError,
} from '@/lib/cash/reclassify';

describe('T-CASH-10 — Reclasificación de medio de pago (ADR-0026)', () => {
  let tenantId: string;
  let userId: string;
  let productId: string;

  // `withTracingContext` devuelve `T | Promise<T>` (acepta fn sincronas), asi
  // que hay que envolverlo para tipar el await.
  const ctxFor = <T,>(tid: string, uid: string, fn: () => Promise<T>): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid,
          actor_user_id: uid,
          actor_type: 'user',
        },
        fn
      )
    );

  const withCtx = <T,>(fn: () => Promise<T>): Promise<T> => ctxFor(tenantId, userId, fn);

  /** Pagos ACTIVOS (no superseded) de una venta. */
  const activePayments = (saleId: string) =>
    db
      .select()
      .from(sale_payments)
      .where(
        and(
          eq(sale_payments.sale_id, saleId),
          sql`NOT EXISTS (SELECT 1 FROM sale_payments c WHERE c.corrects_id = ${sale_payments.id})`
        )
      );

  /** Crea una venta finalizada con los pagos dados (qty=3 → total 363). */
  const makeSale = (payments: Array<{ method: string; amount: string }>) =>
    withCtx(async () => {
      const sale = await createDraftSale(userId, 1);
      await addItemToSale({ sale_id: sale.id, product_id: productId, quantity: '3.0000' });
      return finalizeSale({ sale_id: sale.id, payments, require_fiscal_invoice: false });
    });

  const seedTenant = async (tid: string, uid: string) => {
    await db.insert(companies).values({
      id: tid,
      name: 'T-CASH-10 Co',
      legal_name: 'T-CASH-10 Co SRL',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: uid,
      email: `t-cash-10-${tid.slice(0, 8)}@test.local`,
      full_name: 'Cashier T-CASH-10',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tid,
      user_id: uid,
      role: 'cashier',
    });
  };

  const cleanupTenant = async (tid: string, uid: string) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(sale_payments).where(eq(sale_payments.tenant_id, tid));
      await tx
        .delete(cash_movements)
        .where(
          sql`${cash_movements.cash_session_id} IN (SELECT id FROM cash_sessions WHERE tenant_id = ${tid})`
        );
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tid));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tid));
      await tx.delete(sales).where(eq(sales.tenant_id, tid));
      await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tid));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tid));
      await tx.delete(products).where(eq(products.tenant_id, tid));
      await tx.delete(company_users).where(eq(company_users.company_id, tid));
      await tx.delete(users).where(eq(users.id, uid));
      await tx.delete(companies).where(eq(companies.id, tid));
    });
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    productId = crypto.randomUUID();
    await seedTenant(tenantId, userId);
    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Producto T-CASH-10',
      unit_type: 'unidad',
      price: '100.0000',
      cost: '60.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: '100.0000',
      stock_minimum: '5.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });
  });

  afterEach(async () => {
    await cleanupTenant(tenantId, userId);
  });

  it('débito → efectivo: INSERT corrección (no muta original), recomputa sales, audita, y el cierre suma el efectivo corregido', async () => {
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );
    const { sale } = await makeSale([{ method: 'debito', amount: '363.0000' }]);

    // Original: débito, sin cash_session_id (débito no linkea caja).
    const before = await db.select().from(sale_payments).where(eq(sale_payments.sale_id, sale.id));
    expect(before).toHaveLength(1);
    const originalId = before[0]!.id;
    expect(before[0]!.method).toBe('debito');
    expect(before[0]!.cash_session_id).toBeNull();

    const result = await withCtx(() =>
      reclassifySalePaymentMethod({
        sale_id: sale.id,
        new_method: 'efectivo',
        reason: 'la clienta abonó en efectivo, marqué débito por error',
      })
    );
    expect(result.from_method).toBe('debito');
    expect(result.to_method).toBe('efectivo');

    // Original INTACTA (append-only): sigue débito, sin session.
    const originalAfter = await db
      .select()
      .from(sale_payments)
      .where(eq(sale_payments.id, originalId));
    expect(originalAfter[0]!.method).toBe('debito');
    expect(originalAfter[0]!.cash_session_id).toBeNull();

    // Corrección: fila nueva efectivo, linkea la sesión abierta, corrects_id=original.
    expect(result.correction.method).toBe('efectivo');
    expect(result.correction.amount).toBe('363.0000');
    expect(result.correction.cash_session_id).toBe(session.id);
    expect(result.correction.corrects_id).toBe(originalId);

    // Activo = solo la corrección.
    const active = await activePayments(sale.id);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(result.correction.id);

    // Denormalizado recomputado.
    const saleRow = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(saleRow[0]!.payment_method).toBe('efectivo');
    expect(saleRow[0]!.cash_session_id).toBe(session.id);

    // Audit emitido.
    const audit = await db
      .select({ payload: audit_log.payload })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenantId),
          eq(audit_log.event_name, 'payment.method_reclassified')
        )
      );
    expect(audit).toHaveLength(1);
    const p = audit[0]!.payload as Record<string, unknown>;
    expect(p.from_method).toBe('debito');
    expect(p.to_method).toBe('efectivo');
    expect(p.original_payment_id).toBe(originalId);
    expect(p.correction_payment_id).toBe(result.correction.id);
    expect(p.reason).toContain('efectivo');

    // Cierre: expected = 1000 + 363 (efectivo corregido) = 1363 → descuadre 0.
    const close = await withCtx(() =>
      closeCashSession({ session_id: session.id, counted_amount: '1363.0000' })
    );
    expect(close.session.expected_amount).toBe('1363.0000');
    expect(close.descuadre).toBe('0.0000');
  });

  it('efectivo → débito: la fila efectivo original queda superseded y el cierre la excluye', async () => {
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );
    const { sale } = await makeSale([{ method: 'efectivo', amount: '363.0000' }]);

    await withCtx(() =>
      reclassifySalePaymentMethod({
        sale_id: sale.id,
        new_method: 'debito',
        reason: 'era pago con débito, lo marqué efectivo',
      })
    );

    const saleRow = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(saleRow[0]!.payment_method).toBe('debito');
    expect(saleRow[0]!.cash_session_id).toBeNull();

    // Cierre: el efectivo original superseded NO suma → expected = 1000.
    const close = await withCtx(() =>
      closeCashSession({ session_id: session.id, counted_amount: '1000.0000' })
    );
    expect(close.session.expected_amount).toBe('1000.0000');
    expect(close.descuadre).toBe('0.0000');
  });

  it('re-editable: una corrección se puede volver a corregir (cadena), queda 1 activo', async () => {
    await withCtx(() => openCashSession({ sale_point: 1, initial_amount: '1000.0000' }));
    const { sale } = await makeSale([{ method: 'debito', amount: '363.0000' }]);

    await withCtx(() =>
      reclassifySalePaymentMethod({ sale_id: sale.id, new_method: 'efectivo', reason: 'primera corrección' })
    );
    const second = await withCtx(() =>
      reclassifySalePaymentMethod({ sale_id: sale.id, new_method: 'credito', reason: 'me equivoqué, era crédito' })
    );
    expect(second.from_method).toBe('efectivo');
    expect(second.to_method).toBe('credito');

    const active = await activePayments(sale.id);
    expect(active).toHaveLength(1);
    expect(active[0]!.method).toBe('credito');

    const saleRow = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(saleRow[0]!.payment_method).toBe('credito');
  });

  it('guard same_method: reclasificar al mismo medio lanza ReclassifyValidationError', async () => {
    await withCtx(() => openCashSession({ sale_point: 1, initial_amount: '1000.0000' }));
    const { sale } = await makeSale([{ method: 'debito', amount: '363.0000' }]);

    await expect(
      withCtx(() =>
        reclassifySalePaymentMethod({ sale_id: sale.id, new_method: 'debito', reason: 'x' })
      )
    ).rejects.toMatchObject({ name: 'ReclassifyValidationError', code: 'same_method' });
  });

  it('guard multi_payment_unsupported: venta de pago múltiple (mixto) no se puede reclasificar en F0', async () => {
    await withCtx(() => openCashSession({ sale_point: 1, initial_amount: '1000.0000' }));
    const { sale } = await makeSale([
      { method: 'efectivo', amount: '163.0000' },
      { method: 'tarjeta', amount: '200.0000' },
    ]);

    await expect(
      withCtx(() =>
        reclassifySalePaymentMethod({ sale_id: sale.id, new_method: 'debito', reason: 'x' })
      )
    ).rejects.toBeInstanceOf(ReclassifyValidationError);
  });

  it('cross-tenant: no se puede reclasificar una venta de otro tenant (sale_not_found)', async () => {
    await withCtx(() => openCashSession({ sale_point: 1, initial_amount: '1000.0000' }));
    const { sale } = await makeSale([{ method: 'debito', amount: '363.0000' }]);

    const otherTenant = crypto.randomUUID();
    const otherUser = crypto.randomUUID();
    await seedTenant(otherTenant, otherUser);
    try {
      await expect(
        ctxFor(otherTenant, otherUser, () =>
          reclassifySalePaymentMethod({ sale_id: sale.id, new_method: 'efectivo', reason: 'x' })
        )
      ).rejects.toMatchObject({ code: 'sale_not_found' });
    } finally {
      await cleanupTenant(otherTenant, otherUser);
    }
  });
});
