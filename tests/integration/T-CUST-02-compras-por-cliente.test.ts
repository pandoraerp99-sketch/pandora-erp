/**
 * T-CUST-02 — el resumen de compras por cliente cuenta SOLO compras.
 *
 * Esto existe porque la primera version no filtraba por estado y contaba
 * carritos: en pantalla se veia "TICKETS 2 / COMPRAS $ 0" — dos ventas en
 * `draft` con el cliente ya elegido, contadas como visitas al comercio.
 *
 * Por que importa mas de lo que parece: este numero es el que el comerciante
 * va a mirar para decidir a quien le hace precio y a quien le ofrece fiado. Un
 * cliente que abandono cinco carritos apareceria como su mejor cliente, y una
 * venta anulada le dejaria plata que nunca gasto.
 *
 * La regla: una compra es `cobrada` o `terminada`. `cancelada` se dio de baja;
 * `draft` / `in_progress` / `cobrando` todavia no pasaron
 * (ver src/lib/domain/state-machines.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { customers } from '@/lib/db/schema/customers';
import { sales } from '@/lib/db/schema/sales';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  createCustomer,
  getMonthlyPurchasesByCustomer,
  getPurchaseStatsByCustomer,
  MESES_SERIE,
} from '@/lib/services/customers/customer.service';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';

describe('T-CUST-02 — compras por cliente', () => {
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

  /** Una venta con el estado y el total que pida el caso. */
  const venta = async (
    customerId: string,
    commercial_status: string,
    total: string
  ) => {
    await db.insert(sales).values({
      tenant_id: tenantId,
      correlation_id: generateCorrelationId(),
      cashier_user_id: userId,
      customer_id: customerId,
      commercial_status,
      total,
      subtotal: total,
    });
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-CUST-02 Co',
      legal_name: 'T-CUST-02 Co SRL',
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
      email: `t-cust02-${userId.slice(0, 8)}@test.local`,
      full_name: 'Owner T-CUST-02',
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
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(customers).where(eq(customers.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('NO cuenta carritos abandonados ni ventas canceladas', async () => {
    const cliente = await withCtx(() =>
      createCustomer({ name: 'Kiosco El Faro', tax_condition: 'monotributo' })
    );

    // Lo que SI compro.
    await venta(cliente.id, 'cobrada', '10000.0000');
    await venta(cliente.id, 'terminada', '5000.0000');
    // Lo que NO: dos carritos que dejo por la mitad y una venta anulada.
    await venta(cliente.id, 'draft', '99999.0000');
    await venta(cliente.id, 'in_progress', '88888.0000');
    await venta(cliente.id, 'cancelada', '77777.0000');

    const stats = await withCtx(() => getPurchaseStatsByCustomer());
    const suyo = stats.get(cliente.id);

    expect(suyo?.cantidad).toBe(2);
    expect(Number(suyo?.monto)).toBe(15000);
  });

  it('un cliente que nunca cerro una compra NO aparece en el mapa', async () => {
    // Ausente, no cero: el que consulta decide como mostrar "sin compras". Si
    // apareciera con cantidad 0 seria indistinguible de un bug de suma.
    const cliente = await withCtx(() =>
      createCustomer({ name: 'Solo mira', tax_condition: 'consumidor_final' })
    );
    await venta(cliente.id, 'draft', '1000.0000');

    const stats = await withCtx(() => getPurchaseStatsByCustomer());
    expect(stats.has(cliente.id)).toBe(false);
  });

  it('no mezcla las compras de dos clientes', async () => {
    const a = await withCtx(() =>
      createCustomer({ name: 'Cliente A', tax_condition: 'consumidor_final' })
    );
    const b = await withCtx(() =>
      createCustomer({ name: 'Cliente B', tax_condition: 'consumidor_final' })
    );
    await venta(a.id, 'cobrada', '1000.0000');
    await venta(b.id, 'cobrada', '2000.0000');
    await venta(b.id, 'cobrada', '3000.0000');

    const stats = await withCtx(() => getPurchaseStatsByCustomer());
    expect(Number(stats.get(a.id)?.monto)).toBe(1000);
    expect(Number(stats.get(b.id)?.monto)).toBe(5000);
    expect(stats.get(b.id)?.cantidad).toBe(2);
  });

  it('NO ve las compras de otro comercio', async () => {
    const cliente = await withCtx(() =>
      createCustomer({ name: 'Propio', tax_condition: 'consumidor_final' })
    );
    await venta(cliente.id, 'cobrada', '4000.0000');

    // El mismo agregado, pero pidiendolo desde OTRO tenant.
    const otro = crypto.randomUUID();
    const stats = await Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: otro,
          actor_user_id: userId,
          actor_type: 'user',
        },
        () => getPurchaseStatsByCustomer()
      )
    );
    expect(stats.has(cliente.id)).toBe(false);
  });

  describe('serie mensual — el mes es el del comercio, no el de UTC', () => {
    /** 'AAAA-MM-01' del mes local desplazado `delta` meses. */
    const primeroDelMes = (delta: number) => {
      const [y, m] = diaDelComercio().split('-').map(Number) as [number, number];
      const d = new Date(Date.UTC(y, m - 1 + delta, 1));
      return d.toISOString().slice(0, 10);
    };
    // 01:30 UTC del día 1 = 22:30 del último día del mes ANTERIOR en Ushuaia.
    const ultimoDelMesAnteriorALas2230 = (delta: number) =>
      new Date(`${primeroDelMes(delta)}T01:30:00Z`);

    const ventaEn = (customerId: string, created_at: Date, total: string) =>
      db.insert(sales).values({
        tenant_id: tenantId,
        correlation_id: generateCorrelationId(),
        cashier_user_id: userId,
        customer_id: customerId,
        commercial_status: 'cobrada',
        total,
        subtotal: total,
        created_at,
      });

    it('🔴 una compra del último día del mes a las 22:30 cuenta en ESE mes', async () => {
      const cliente = await withCtx(() =>
        createCustomer({ name: 'Cierre de mes', tax_condition: 'consumidor_final' })
      );
      // 22:30 del último día del mes pasado: en UTC ya es el día 1 de este mes.
      await ventaEn(cliente.id, ultimoDelMesAnteriorALas2230(0), '1000.0000');

      const series = await withCtx(() => getMonthlyPurchasesByCustomer());
      const serie = series.get(cliente.id)!;
      expect(serie).toHaveLength(MESES_SERIE);
      expect(serie[MESES_SERIE - 2]).toBe(1000);
      expect(serie[MESES_SERIE - 1]).toBe(0);
    });

    it('🔴 una compra de ANTES de la ventana no se cuela en el primer mes', async () => {
      const cliente = await withCtx(() =>
        createCustomer({ name: 'Hace un año', tax_condition: 'consumidor_final' })
      );
      // 22:30 del último día del mes previo al primero de la serie: en UTC cae
      // adentro de la ventana; en Ushuaia, un mes afuera. (Lo que lo deja
      // afuera es agrupar por el mes local: ese mes no está entre las etiquetas.)
      await ventaEn(cliente.id, ultimoDelMesAnteriorALas2230(-(MESES_SERIE - 1)), '500.0000');
      // Y una adentro, para que el cliente aparezca en el mapa.
      await ventaEn(cliente.id, new Date(`${primeroDelMes(0)}T12:00:00Z`), '1.0000');

      const series = await withCtx(() => getMonthlyPurchasesByCustomer());
      const serie = series.get(cliente.id)!;
      expect(serie[0]).toBe(0);
      expect(serie[MESES_SERIE - 1]).toBe(1);
    });
  });

  it('devuelve el monto como string, no como number', async () => {
    // Es plata. Si el driver lo entregara como number, un total con centavos
    // ya vendria redondeado desde la base y nadie se enteraria (CLAUDE.md §9).
    const cliente = await withCtx(() =>
      createCustomer({ name: 'Centavos', tax_condition: 'consumidor_final' })
    );
    await venta(cliente.id, 'cobrada', '1234.5600');

    const stats = await withCtx(() => getPurchaseStatsByCustomer());
    const monto = stats.get(cliente.id)?.monto;
    expect(typeof monto).toBe('string');
    expect(Number(monto)).toBeCloseTo(1234.56, 4);
  });
});
