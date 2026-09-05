/**
 * T-CTA-01 — cuenta corriente de clientes (ADR-0027).
 *
 * **El caso que importa** (y el que habría fallado en silencio antes):
 * venta fiada → el cliente paga una parte en efectivo → se cierra la caja.
 * El monto esperado TIENE que incluir ese cobro. Antes de este trabajo, el
 * cálculo del esperado descartaba los tipos de movimiento que no conocía con
 * un `continue` mudo: la plata entraba al cajón y el arqueo no la contaba.
 *
 * Los demás casos protegen las invariantes del libro: append-only, saldo
 * calculado (no guardado), y que sólo el efectivo toque la caja.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { customers } from '@/lib/db/schema/customers';
import { customer_account_movements } from '@/lib/db/schema/customer_account';
import { sales, sale_items } from '@/lib/db/schema/sales';
import { sale_payments } from '@/lib/db/schema/sale_payments';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  createDraftSale,
  addItemToSale,
  setSaleCustomer,
  finalizeSale,
} from '@/lib/services/sales/sale.service';
import { createCustomer } from '@/lib/services/customers/customer.service';
import {
  settleAccount,
  getAccountBalance,
  listAccountMovements,
  AccountError,
} from '@/lib/services/customers/account.service';
import { openCashSession, closeCashSession } from '@/lib/cash/sessions';

describe('T-CTA-01 — cuenta corriente', () => {
  let tenantId: string;
  let userId: string;
  let productId: string;

  const withCtx = <T,>(fn: () => Promise<T>): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        fn
      )
    );

  /** Venta de 3 × $100 + IVA 21% = $363, toda fiada. */
  const ventaFiada = (customerId: string) =>
    withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      await addItemToSale({
        sale_id: draft.id,
        product_id: productId,
        quantity: '3.0000',
      });
      await setSaleCustomer({ sale_id: draft.id, customer_id: customerId });
      return finalizeSale({
        sale_id: draft.id,
        payments: [{ method: 'cuenta_corriente', amount: '363.0000' }],
        require_fiscal_invoice: false,
      });
    });

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    productId = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-CTA-01 Co',
      legal_name: 'T-CTA-01 Co SRL',
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
      email: `t-cta-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cajero T-CTA-01',
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
      name: 'Producto T-CTA-01',
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
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.execute(
        sql`DELETE FROM customer_account_movements WHERE tenant_id = ${tenantId}`
      );
      await tx.delete(sale_payments).where(eq(sale_payments.tenant_id, tenantId));
      await tx.execute(
        sql`DELETE FROM cash_movements WHERE cash_session_id IN
            (SELECT id FROM cash_sessions WHERE tenant_id = ${tenantId})`
      );
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tenantId));
      await tx.delete(customers).where(eq(customers.tenant_id, tenantId));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('EL CASO QUE IMPORTA: venta fiada + cobro parcial en efectivo → el cierre lo cuenta', async () => {
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '1000.0000' })
    );
    const cliente = await withCtx(() => createCustomer({ name: 'Doña Rosa' }));

    await ventaFiada(cliente.id);

    // La venta fiada NO es plata del cajón: hasta acá el esperado sigue en 1000.
    const saldoInicial = await withCtx(() => getAccountBalance(cliente.id));
    expect(saldoInicial.toNumber()).toBe(363);

    // Paga $200 de los $363, en efectivo.
    await withCtx(() =>
      settleAccount({
        customer_id: cliente.id,
        amount: '200.0000',
        method: 'efectivo',
        cash_session_id: session.id,
      })
    );

    const cierre = await withCtx(() =>
      closeCashSession({
        session_id: session.id,
        counted_amount: '1200.0000', // apertura 1000 + los 200 cobrados
      })
    );

    // Si el cierre ignorara el movimiento nuevo, esperaría 1000 y marcaría
    // un descuadre de $200 que nadie podría explicar.
    expect(new Decimal(cierre.session.expected_amount!).toNumber()).toBe(1200);
    expect(new Decimal(cierre.session.descuadre!).toNumber()).toBe(0);
  });

  it('el saldo se CALCULA: queda la diferencia después del pago parcial', async () => {
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '0.0000' })
    );
    const cliente = await withCtx(() => createCustomer({ name: 'Cliente parcial' }));
    await ventaFiada(cliente.id);

    await withCtx(() =>
      settleAccount({
        customer_id: cliente.id,
        amount: '100.0000',
        method: 'efectivo',
        cash_session_id: session.id,
      })
    );

    const saldo = await withCtx(() => getAccountBalance(cliente.id));
    expect(saldo.toNumber()).toBe(263); // 363 − 100

    // Y el libro tiene los DOS movimientos, no un saldo pisado.
    const movs = await withCtx(() => listAccountMovements(cliente.id));
    expect(movs).toHaveLength(2);
    expect(movs.map((m) => m.type).sort()).toEqual(['charge', 'payment']);
  });

  it('un cobro por transferencia NO entra a la caja', async () => {
    // Si todo cobro fuera al cajón, el arqueo contaría plata que nunca entró.
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '500.0000' })
    );
    const cliente = await withCtx(() => createCustomer({ name: 'Paga por transf' }));
    await ventaFiada(cliente.id);

    await withCtx(() =>
      settleAccount({
        customer_id: cliente.id,
        amount: '363.0000',
        method: 'transferencia',
      })
    );

    // La deuda se cancela...
    const saldo = await withCtx(() => getAccountBalance(cliente.id));
    expect(saldo.toNumber()).toBe(0);

    // ...pero la caja NO se toca: sigue esperando sólo la apertura.
    const cierre = await withCtx(() =>
      closeCashSession({ session_id: session.id, counted_amount: '500.0000' })
    );
    expect(new Decimal(cierre.session.expected_amount!).toNumber()).toBe(500);

    const movsCaja = await db
      .select()
      .from(cash_movements)
      .where(eq(cash_movements.cash_session_id, session.id));
    expect(movsCaja).toHaveLength(0);
  });

  it('un cobro en efectivo SIN caja abierta se rechaza', async () => {
    const cliente = await withCtx(() => createCustomer({ name: 'Sin caja' }));
    await ventaFiada(cliente.id);

    await expect(
      withCtx(() =>
        settleAccount({
          customer_id: cliente.id,
          amount: '100.0000',
          method: 'efectivo',
        })
      )
    ).rejects.toBeInstanceOf(AccountError);
  });

  it('no se puede fiar sin elegir cliente', async () => {
    await expect(
      withCtx(async () => {
        const draft = await createDraftSale(userId, 1);
        await addItemToSale({
          sale_id: draft.id,
          product_id: productId,
          quantity: '1.0000',
        });
        return finalizeSale({
          sale_id: draft.id,
          payments: [{ method: 'cuenta_corriente', amount: '121.0000' }],
          require_fiscal_invoice: false,
        });
      })
    ).rejects.toThrow();
  });

  it('no se puede cobrar a quien no debe nada', async () => {
    const cliente = await withCtx(() => createCustomer({ name: 'Sin deuda' }));
    await expect(
      withCtx(() =>
        settleAccount({
          customer_id: cliente.id,
          amount: '100.0000',
          method: 'transferencia',
        })
      )
    ).rejects.toBeInstanceOf(AccountError);
  });

  it('el libro es APPEND-ONLY: no se puede editar ni borrar', async () => {
    const cliente = await withCtx(() => createCustomer({ name: 'Inmutable' }));
    await ventaFiada(cliente.id);
    const [mov] = await db
      .select()
      .from(customer_account_movements)
      .where(eq(customer_account_movements.tenant_id, tenantId));

    // Drizzle envuelve el error de Postgres ("Failed query: ..."), asi que el
    // mensaje del trigger viaja en la CAUSA, no en el mensaje de arriba.
    const causa = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return null;
      } catch (e) {
        return String((e as { cause?: unknown }).cause ?? e);
      }
    };

    expect(
      await causa(() =>
        db
          .update(customer_account_movements)
          .set({ amount: '1.0000' })
          .where(eq(customer_account_movements.id, mov!.id))
      )
    ).toMatch(/INSERT-only/);

    expect(
      await causa(() =>
        db
          .delete(customer_account_movements)
          .where(eq(customer_account_movements.id, mov!.id))
      )
    ).toMatch(/INSERT-only/);
  });

  it('mixto: mitad efectivo, mitad fiado', async () => {
    // El caso real: "te dejo algo ahora y el resto la semana que viene".
    const session = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '0.0000' })
    );
    const cliente = await withCtx(() => createCustomer({ name: 'Mitad y mitad' }));

    await withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      await addItemToSale({
        sale_id: draft.id,
        product_id: productId,
        quantity: '3.0000',
      });
      await setSaleCustomer({ sale_id: draft.id, customer_id: cliente.id });
      return finalizeSale({
        sale_id: draft.id,
        payments: [
          { method: 'efectivo', amount: '163.0000' },
          { method: 'cuenta_corriente', amount: '200.0000' },
        ],
        require_fiscal_invoice: false,
      });
    });

    // La deuda es SOLO la parte fiada.
    const saldo = await withCtx(() => getAccountBalance(cliente.id));
    expect(saldo.toNumber()).toBe(200);

    // Y la caja espera SOLO la parte en efectivo.
    const cierre = await withCtx(() =>
      closeCashSession({ session_id: session.id, counted_amount: '163.0000' })
    );
    expect(new Decimal(cierre.session.expected_amount!).toNumber()).toBe(163);
  });
});
