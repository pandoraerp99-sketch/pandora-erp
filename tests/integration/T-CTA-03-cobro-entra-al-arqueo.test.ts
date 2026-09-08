/**
 * T-CTA-03 — el cobro de una cuenta corriente llega al arqueo (y sólo el
 * efectivo).
 *
 * `computeExpectedAmountFromActivity` suma los `customer_payment`, pero es una
 * función privada y NINGÚN test la ejercía con ese tipo: el código estaba
 * escrito y sin verificar. Este test entra por el camino real —
 * `settleAccount` → `closeCashSession`— y no por la función.
 *
 * Las dos mitades importan igual:
 *   - si el efectivo NO sumara, el cajero contaría plata de más y el cierre
 *     daría un sobrante que nadie puede explicar;
 *   - si la transferencia SÍ sumara, el arqueo esperaría plata que nunca
 *     estuvo en el cajón y daría un faltante falso.
 * Las dos terminan en la misma consecuencia: un descuadre inventado, que es
 * exactamente lo que hace que un comerciante deje de confiar en el cierre.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { customers } from '@/lib/db/schema/customers';
import { sales } from '@/lib/db/schema/sales';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { customer_account_movements } from '@/lib/db/schema/customer_account';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { createCustomer } from '@/lib/services/customers/customer.service';
import { settleAccount } from '@/lib/services/customers/account.service';
import { closeCashSession, openCashSession } from '@/lib/cash/sessions';

const INICIAL = '10000.00';
const DEUDA = '4500.00';

describe('T-CTA-03 — el cobro de cuenta y el arqueo', () => {
  let tenantId: string;
  let userId: string;

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

  /** Cliente con una deuda de `DEUDA`. */
  const clienteQueDebe = async () => {
    const cli = await withCtx(() =>
      createCustomer({ name: 'Fiado', tax_condition: 'consumidor_final' })
    );
    const [venta] = await db
      .insert(sales)
      .values({
        tenant_id: tenantId,
        correlation_id: generateCorrelationId(),
        cashier_user_id: userId,
        customer_id: cli.id,
        commercial_status: 'terminada',
        total: DEUDA,
        subtotal: DEUDA,
      })
      .returning({ id: sales.id });
    await db.insert(customer_account_movements).values({
      tenant_id: tenantId,
      customer_id: cli.id,
      type: 'charge',
      amount: DEUDA,
      sale_id: venta!.id,
      created_by: userId,
    });
    return cli;
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-CTA-03 Co',
      legal_name: 'T-CTA-03 Co SRL',
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
      email: `t-cta03-${userId.slice(0, 8)}@test.local`,
      full_name: 'Owner T-CTA-03',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });
  });

  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx
        .delete(customer_account_movements)
        .where(eq(customer_account_movements.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.execute(
        sql`DELETE FROM cash_movements WHERE cash_session_id IN (
              SELECT id FROM cash_sessions WHERE tenant_id = ${tenantId})`
      );
      await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tenantId));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(customers).where(eq(customers.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('EN EFECTIVO: suma al esperado del cierre', async () => {
    const cli = await clienteQueDebe();
    const sesion = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: INICIAL })
    );

    await withCtx(() =>
      settleAccount({
        customer_id: cli.id,
        amount: DEUDA,
        method: 'efectivo',
        cash_session_id: sesion.id,
      })
    );

    // El cajero cuenta inicial + lo que cobró. Si la fórmula no sumara el
    // cobro, esto daría un SOBRANTE de $4.500 que nadie sabría explicar.
    const contado = (Number(INICIAL) + Number(DEUDA)).toFixed(2);
    const cierre = await withCtx(() =>
      closeCashSession({ session_id: sesion.id, counted_amount: contado })
    );

    expect(Number(cierre.descuadre)).toBe(0);
    expect(Number(cierre.session.expected_amount)).toBe(14500);
  });

  it('POR TRANSFERENCIA: NO toca la caja', async () => {
    const cli = await clienteQueDebe();
    const sesion = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: INICIAL })
    );

    await withCtx(() =>
      settleAccount({
        customer_id: cli.id,
        amount: DEUDA,
        method: 'transferencia',
      })
    );

    // No hay movimiento de caja...
    const movs = await db
      .select()
      .from(cash_movements)
      .where(eq(cash_movements.cash_session_id, sesion.id));
    expect(movs.length).toBe(0);

    // ...y el cajón sigue teniendo lo mismo que al abrir.
    const cierre = await withCtx(() =>
      closeCashSession({ session_id: sesion.id, counted_amount: INICIAL })
    );
    expect(Number(cierre.descuadre)).toBe(0);
    expect(Number(cierre.session.expected_amount)).toBe(10000);
  });

  it('un cobro en efectivo SIN caja abierta no se registra', async () => {
    // Sin caja no hay dónde imputar la plata. Registrar el pago igual dejaría
    // el libro del cliente al día y el cajón con plata que no figura.
    const cli = await clienteQueDebe();
    await expect(
      withCtx(() =>
        settleAccount({ customer_id: cli.id, amount: DEUDA, method: 'efectivo' })
      )
    ).rejects.toThrow(/caja/i);
  });

  it('no se puede imputar un cobro a una caja YA CERRADA', async () => {
    // Sería reescribir un arqueo que alguien ya firmó.
    const cli = await clienteQueDebe();
    const sesion = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: INICIAL })
    );
    await withCtx(() =>
      closeCashSession({ session_id: sesion.id, counted_amount: INICIAL })
    );

    await expect(
      withCtx(() =>
        settleAccount({
          customer_id: cli.id,
          amount: DEUDA,
          method: 'efectivo',
          cash_session_id: sesion.id,
        })
      )
    ).rejects.toThrow(/cerrada/i);
  });
});
