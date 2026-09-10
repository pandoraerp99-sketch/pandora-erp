/**
 * T-PANEL-01 — los números del Panel.
 *
 * ── LO QUE SE PROTEGE ─────────────────────────────────────────────────────
 * El Panel es lo primero que ve el comerciante y se mira DE REOJO. Un número
 * mal ahí no se audita: se cree. Y los dos errores más fáciles de cometer son
 * invisibles en pantalla:
 *
 *   1. **La zona horaria.** La base corre en UTC; el comercio, en Ushuaia. A
 *      las 21:00 locales ya es el día siguiente en UTC, así que un
 *      `created_at::date = current_date` le vaciaría el día al comerciante con
 *      el local abierto. Se ve como "hoy no vendí nada", no como un bug.
 *   2. **Los huecos de la serie.** Un domingo cerrado no produce fila, y el
 *      gráfico uniría el sábado con el lunes: una recta donde hubo un cero.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { sales, sale_items } from '@/lib/db/schema/sales';
import { sale_payments } from '@/lib/db/schema/sale_payments';
import { expenses } from '@/lib/db/schema/expenses';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  TZ_COMERCIO,
  getIngresosVsGastos,
  getMasVendidosHoy,
  getMediosDePagoHoy,
  getPanelHoy,
  getPanelMes,
  getSerieDiaria,
  getUltimasVentas,
} from '@/lib/services/reporting/panel.report';

describe('T-PANEL-01 — números del Panel', () => {
  let tenantId: string;
  let otroTenant: string;
  let userId: string;
  let productoId: string;

  const withCtx = <T,>(fn: () => Promise<T>, tid?: string): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid ?? tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        fn
      )
    );

  /** El día de HOY según el comercio, que es lo que el Panel tiene que usar. */
  const hoyLocal = async (): Promise<string> => {
    const [r] = await db.execute<{ d: string }>(
      sql`SELECT (now() AT TIME ZONE ${TZ_COMERCIO})::date::text AS d`
    );
    return r!.d;
  };

  /** Una venta a una hora LOCAL puntual del día que se le indique. */
  const venta = async (
    diaLocal: string,
    horaLocal: number,
    total: string,
    opts: { medio?: string; conItem?: boolean; cliente?: string } = {}
  ) => {
    const [s] = await db
      .insert(sales)
      .values({
        tenant_id: tenantId,
        correlation_id: crypto.randomUUID(),
        cashier_user_id: userId,
        commercial_status: 'cobrada',
        fiscal_status: 'not_required',
        subtotal: total,
        tax_amount: '0',
        total,
        payment_method: opts.medio ?? 'efectivo',
        ...(opts.cliente !== undefined ? { customer_name_snapshot: opts.cliente } : {}),
        created_at: sql`(${diaLocal}::date + ${`${horaLocal} hours`}::interval) AT TIME ZONE ${TZ_COMERCIO}` as never,
      })
      .returning({ id: sales.id });

    if (opts.conItem !== false) {
      await db.insert(sale_items).values({
        tenant_id: tenantId,
        sale_id: s!.id,
        product_id: productoId,
        product_name_snapshot: 'Coca 500',
        product_unit_type_snapshot: 'unit',
        unit_price: total,
        quantity: '1',
        tax_rate: '21',
        line_subtotal: total,
        line_tax: '0',
        line_total: total,
      });
    }
    await db.insert(sale_payments).values({
      tenant_id: tenantId,
      sale_id: s!.id,
      method: opts.medio ?? 'efectivo',
      amount: total,
      created_at: sql`(${diaLocal}::date + ${`${horaLocal} hours`}::interval) AT TIME ZONE ${TZ_COMERCIO}` as never,
    });
    return s!.id;
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    otroTenant = crypto.randomUUID();
    userId = crypto.randomUUID();
    for (const [i, id] of [tenantId, otroTenant].entries()) {
      await db.insert(companies).values({
        id,
        name: `T-PANEL Co ${i}`,
        legal_name: `T-PANEL Co ${i} SRL`,
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      });
    }
    await db.insert(users).values({
      id: userId,
      email: `t-panel-${userId.slice(0, 8)}@test.local`,
      full_name: 'Cajero',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });
    const [p] = await db
      .insert(products)
      .values({
        tenant_id: tenantId,
        name: 'Coca 500',
        price: '1000',
        tax_rate: '21',
        stock_current: '100',
      })
      .returning({ id: products.id });
    productoId = p!.id;
  });

  afterEach(async () => {
    const ids = [tenantId, otroTenant];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(sale_payments).where(inArray(sale_payments.tenant_id, ids));
      await tx.delete(sale_items).where(inArray(sale_items.tenant_id, ids));
      await tx.delete(sales).where(inArray(sales.tenant_id, ids));
      await tx.delete(expenses).where(inArray(expenses.tenant_id, ids));
      await tx.delete(products).where(inArray(products.tenant_id, ids));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, ids));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  describe('el día es el del COMERCIO, no el de la base', () => {
    it('una venta de las 23:00 locales cuenta HOY, no mañana', async () => {
      // A las 23:00 de Ushuaia son las 02:00 UTC del día siguiente. Con
      // `created_at::date` esta venta caería en mañana y el comerciante vería
      // su día en cero con el local todavía abierto.
      const hoy = await hoyLocal();
      await venta(hoy, 23, '5000.00');

      const r = await withCtx(getPanelHoy);
      expect(new Decimal(r.total).eq('5000.00')).toBe(true);
      expect(r.tickets).toBe(1);
    });

    it('una venta de las 00:30 locales NO cuenta como del día anterior', async () => {
      const hoy = await hoyLocal();
      await venta(hoy, 0, '3000.00');
      const r = await withCtx(getPanelHoy);
      expect(new Decimal(r.total).eq('3000.00')).toBe(true);
    });

    it('la hora pico se calcula en hora LOCAL', async () => {
      // Dos ventas a las 19 locales pesan más que una a las 10. Si la consulta
      // usara la hora UTC, el pico saldría a las 22.
      const hoy = await hoyLocal();
      await venta(hoy, 19, '9000.00');
      await venta(hoy, 19, '9000.00');
      await venta(hoy, 10, '1000.00');

      const r = await withCtx(getPanelHoy);
      expect(r.mejorHora).toBe(19);
    });
  });

  describe('comparaciones', () => {
    it('compara contra el MISMO DIA de la semana pasada', async () => {
      // Contra "ayer" un lunes se compararía con un domingo. El día de la
      // semana manda más que la fecha en un comercio.
      const hoy = await hoyLocal();
      const haceUnaSemana = new Date(`${hoy}T12:00:00Z`);
      haceUnaSemana.setUTCDate(haceUnaSemana.getUTCDate() - 7);
      const iso = haceUnaSemana.toISOString().slice(0, 10);

      await venta(hoy, 12, '1500.00');
      await venta(iso, 12, '1000.00');

      const r = await withCtx(getPanelHoy);
      expect(new Decimal(r.totalSemanaPasada).eq('1000.00')).toBe(true);
      expect(r.variacion).toBeCloseTo(50, 5);
    });

    it('sin base de comparación la variación es null, NO cero', async () => {
      // Un 0% diría "igual que la semana pasada". No es lo mismo que "no hay
      // con qué comparar", y en un panel esa diferencia se cree.
      const hoy = await hoyLocal();
      await venta(hoy, 12, '1500.00');
      const r = await withCtx(getPanelHoy);
      expect(r.variacion).toBeNull();
    });

    it('el ticket promedio es el total sobre los tickets', async () => {
      const hoy = await hoyLocal();
      await venta(hoy, 11, '1000.00');
      await venta(hoy, 12, '3000.00');
      const r = await withCtx(getPanelHoy);
      expect(new Decimal(r.ticketPromedio).eq('2000.00')).toBe(true);
    });

    it('sin ventas no divide por cero', async () => {
      const r = await withCtx(getPanelHoy);
      expect(r.tickets).toBe(0);
      expect(new Decimal(r.ticketPromedio).eq(0)).toBe(true);
      expect(r.mejorHora).toBeNull();
    });
  });

  describe('serie diaria', () => {
    it('devuelve TODOS los días, incluidos los que no vendieron', async () => {
      // Sin los ceros, el gráfico une el día anterior con el siguiente y dibuja
      // una recta donde hubo un día cerrado.
      const hoy = await hoyLocal();
      await venta(hoy, 12, '1000.00');

      const serie = await withCtx(() => getSerieDiaria(7));
      expect(serie.length).toBe(7);
      expect(serie[serie.length - 1]?.dia).toBe(hoy);
      expect(serie.filter((d) => d.total === '0').length).toBe(6);
    });

    it('viene ordenada de la más vieja a la más nueva', async () => {
      const serie = await withCtx(() => getSerieDiaria(5));
      const dias = serie.map((d) => d.dia);
      expect([...dias].sort()).toEqual(dias);
    });
  });

  describe('ingresos vs gastos', () => {
    it('cruza ventas con gastos en el mismo mes', async () => {
      // Éste es el bloque que la maqueta sólo podía inventar: la línea de
      // gastos no existía hasta que se construyó el módulo.
      const hoy = await hoyLocal();
      await venta(hoy, 12, '10000.00');
      await db.insert(expenses).values({
        tenant_id: tenantId,
        fecha: hoy,
        categoria: 'servicios',
        total: '4000.00',
        medio_pago: 'transferencia',
      });

      const meses = await withCtx(() => getIngresosVsGastos(3));
      expect(meses.length).toBe(3);
      const mesActual = meses[meses.length - 1]!;
      expect(new Decimal(mesActual.ingresos).eq('10000.00')).toBe(true);
      expect(new Decimal(mesActual.gastos).eq('4000.00')).toBe(true);
    });

    it('un mes sin nada devuelve ceros, no se saltea', async () => {
      const meses = await withCtx(() => getIngresosVsGastos(4));
      expect(meses.length).toBe(4);
      expect(meses.every((m) => m.ingresos === '0' && m.gastos === '0')).toBe(true);
    });
  });

  describe('medios de pago', () => {
    it('sale de los PAGOS y no del campo denormalizado de la venta', async () => {
      // `sales.payment_method` dice 'mixto' cuando hubo dos medios: con ese
      // campo, una venta mitad efectivo mitad débito no aparecería en ninguno.
      const hoy = await hoyLocal();
      const id = await venta(hoy, 12, '1000.00', { medio: 'efectivo' });
      await db.insert(sale_payments).values({
        tenant_id: tenantId,
        sale_id: id,
        method: 'debito',
        amount: '500.00',
      });
      await db.update(sales).set({ payment_method: 'mixto' }).where(eq(sales.id, id));

      const medios = await withCtx(getMediosDePagoHoy);
      const nombres = medios.map((m) => m.medio).sort();
      expect(nombres).toEqual(['debito', 'efectivo']);
      expect(medios.find((m) => m.medio === 'mixto')).toBeUndefined();
    });
  });

  describe('aislamiento', () => {
    it('no ve las ventas de otro comercio', async () => {
      const hoy = await hoyLocal();
      await db.insert(sales).values({
        tenant_id: otroTenant,
        correlation_id: crypto.randomUUID(),
        cashier_user_id: userId,
        commercial_status: 'cobrada',
        fiscal_status: 'not_required',
        subtotal: '99999',
        tax_amount: '0',
        total: '99999',
      });
      await venta(hoy, 12, '100.00');

      const r = await withCtx(getPanelHoy);
      expect(new Decimal(r.total).eq('100.00')).toBe(true);
      expect((await withCtx(getUltimasVentas)).length).toBe(1);
    });
  });

  describe('sólo cuentan las ventas CERRADAS', () => {
    it('un carrito abandonado no es una venta', async () => {
      await db.insert(sales).values({
        tenant_id: tenantId,
        correlation_id: crypto.randomUUID(),
        cashier_user_id: userId,
        commercial_status: 'draft',
        fiscal_status: 'not_required',
        subtotal: '7777',
        tax_amount: '0',
        total: '7777',
      });
      const r = await withCtx(getPanelHoy);
      expect(r.tickets).toBe(0);
      expect((await withCtx(getMasVendidosHoy)).length).toBe(0);
      const mes = await withCtx(getPanelMes);
      expect(new Decimal(mes.total).eq(0)).toBe(true);
    });
  });
});
