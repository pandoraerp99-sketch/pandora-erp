/**
 * T-CTA-02 — antigüedad de la deuda (FIFO).
 *
 * El panel de Clientes y la tarjeta "Deudores" muestran "hace N días". Ese
 * número decide a quién sale a cobrarle el comerciante, así que tiene que
 * significar algo preciso: **días desde el cargo más viejo que TODAVÍA no está
 * pagado**, imputando los pagos del más viejo al más nuevo.
 *
 * La forma fácil y equivocada sería "días desde el último movimiento". Con esa
 * cuenta, alguien que debe de hace medio año y hoy paga $100 aparece como
 * deuda "de hoy" — justo el cliente al que hay que ir a ver desaparece de la
 * lista. Este test fija la diferencia.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { customers } from '@/lib/db/schema/customers';
import { sales } from '@/lib/db/schema/sales';
import { customer_account_movements } from '@/lib/db/schema/customer_account';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { createCustomer } from '@/lib/services/customers/customer.service';
import { getDebtorsWithAge } from '@/lib/services/customers/account.service';

describe('T-CTA-02 — antigüedad de la deuda', () => {
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

  const haceDias = (n: number) => new Date(Date.now() - n * 86400000);

  /** Un cargo de `monto` fechado hace `dias`. Cada cargo necesita su venta. */
  const cargo = async (customerId: string, monto: string, dias: number) => {
    const [venta] = await db
      .insert(sales)
      .values({
        tenant_id: tenantId,
        correlation_id: generateCorrelationId(),
        cashier_user_id: userId,
        customer_id: customerId,
        commercial_status: 'terminada',
        total: monto,
        subtotal: monto,
        created_at: haceDias(dias),
      })
      .returning({ id: sales.id });
    await db.insert(customer_account_movements).values({
      tenant_id: tenantId,
      customer_id: customerId,
      type: 'charge',
      amount: monto,
      sale_id: venta!.id,
      created_by: userId,
      created_at: haceDias(dias),
    });
  };

  const pago = async (customerId: string, monto: string, dias: number) => {
    await db.insert(customer_account_movements).values({
      tenant_id: tenantId,
      customer_id: customerId,
      type: 'payment',
      amount: monto,
      payment_method: 'transferencia',
      created_by: userId,
      created_at: haceDias(dias),
    });
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-CTA-02 Co',
      legal_name: 'T-CTA-02 Co SRL',
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
      email: `t-cta02-${userId.slice(0, 8)}@test.local`,
      full_name: 'Owner T-CTA-02',
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
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(customers).where(eq(customers.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('un pago que cubre el cargo viejo mueve la antigüedad al siguiente', async () => {
    const cli = await withCtx(() =>
      createCustomer({ name: 'Fiado viejo', tax_condition: 'consumidor_final' })
    );
    await cargo(cli.id, '10000.0000', 180);
    await cargo(cli.id, '5000.0000', 10);
    // Paga exactamente el primero.
    await pago(cli.id, '10000.0000', 1);

    const d = (await withCtx(() => getDebtorsWithAge())).get(cli.id);
    expect(Number(d?.saldo)).toBe(5000);
    // 10, no 180 (el viejo quedó saldado) ni 1 (fecha del pago).
    expect(d?.dias).toBe(10);
  });

  it('un pago PARCIAL no rejuvenece la deuda', async () => {
    // El caso que motiva el test: paga poquito y el cargo viejo sigue abierto.
    const cli = await withCtx(() =>
      createCustomer({ name: 'Paga poco', tax_condition: 'consumidor_final' })
    );
    await cargo(cli.id, '10000.0000', 180);
    await cargo(cli.id, '5000.0000', 10);
    await pago(cli.id, '100.0000', 0);

    const d = (await withCtx(() => getDebtorsWithAge())).get(cli.id);
    expect(Number(d?.saldo)).toBe(14900);
    expect(d?.dias).toBe(180);
  });

  it('sin deuda no hay antigüedad', async () => {
    const cli = await withCtx(() =>
      createCustomer({ name: 'Al día', tax_condition: 'consumidor_final' })
    );
    await cargo(cli.id, '7000.0000', 30);
    await pago(cli.id, '7000.0000', 2);

    const d = (await withCtx(() => getDebtorsWithAge())).get(cli.id);
    expect(Number(d?.saldo)).toBe(0);
    expect(d?.dias).toBeNull();
  });

  it('pagar de más deja saldo a favor y tampoco tiene antigüedad', async () => {
    const cli = await withCtx(() =>
      createCustomer({ name: 'Adelantó', tax_condition: 'consumidor_final' })
    );
    await cargo(cli.id, '3000.0000', 20);
    await pago(cli.id, '5000.0000', 1);

    const d = (await withCtx(() => getDebtorsWithAge())).get(cli.id);
    expect(Number(d?.saldo)).toBe(-2000);
    expect(d?.dias).toBeNull();
  });

  it('un ajuste cuenta como cargo, con SU fecha', async () => {
    const cli = await withCtx(() =>
      createCustomer({ name: 'Ajustado', tax_condition: 'consumidor_final' })
    );
    await db.insert(customer_account_movements).values({
      tenant_id: tenantId,
      customer_id: cli.id,
      type: 'adjustment',
      amount: '900.0000',
      reason: 'Diferencia de un cierre viejo',
      created_by: userId,
      created_at: haceDias(45),
    });

    const d = (await withCtx(() => getDebtorsWithAge())).get(cli.id);
    expect(Number(d?.saldo)).toBe(900);
    expect(d?.dias).toBe(45);
  });

  it('NO ve la deuda de otro comercio', async () => {
    const cli = await withCtx(() =>
      createCustomer({ name: 'Propio', tax_condition: 'consumidor_final' })
    );
    await cargo(cli.id, '1000.0000', 5);

    const otro = crypto.randomUUID();
    const mapa = await Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: otro,
          actor_user_id: userId,
          actor_type: 'user',
        },
        () => getDebtorsWithAge()
      )
    );
    expect(mapa.has(cli.id)).toBe(false);
  });
});
