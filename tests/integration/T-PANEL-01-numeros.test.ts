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
import { customers } from '@/lib/db/schema/customers';
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
  getPanelClientes,
  getSerieDiaria,
  getUltimasVentas,
  getVentasPorRubro,
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
      await tx.delete(customers).where(inArray(customers.tenant_id, ids));
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

  // ══════════════════════════════════════════════════════════════════════
  // VENTAS POR RUBRO
  // ══════════════════════════════════════════════════════════════════════
  describe('ventas por rubro', () => {
    /** Un producto con rubro, y una venta suya por el monto que se le pase. */
    const ventaDeRubro = async (
      rubro: string | null,
      total: string,
      cantidad = '1',
      diaLocal?: string
    ) => {
      const [prod] = await db
        .insert(products)
        .values({
          tenant_id: tenantId,
          name: `P-${rubro ?? 'nulo'}-${crypto.randomUUID().slice(0, 6)}`,
          category: rubro,
          price: total,
          tax_rate: '21',
          stock_current: '100',
        })
        .returning({ id: products.id });

      const dia = diaLocal ?? (await hoyLocal());
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
          payment_method: 'efectivo',
          created_at: sql`(${dia}::date + interval '12 hours') AT TIME ZONE ${TZ_COMERCIO}` as never,
        })
        .returning({ id: sales.id });

      await db.insert(sale_items).values({
        tenant_id: tenantId,
        sale_id: s!.id,
        product_id: prod!.id,
        product_name_snapshot: 'x',
        product_unit_type_snapshot: 'unit',
        unit_price: total,
        quantity: cantidad,
        tax_rate: '21',
        line_subtotal: total,
        line_tax: '0',
        line_total: total,
      });
      return prod!.id;
    };

    it('agrupa la facturación del mes por rubro, de mayor a menor', async () => {
      await ventaDeRubro('Bebidas', '3000');
      await ventaDeRubro('Almacén', '10000');
      await ventaDeRubro('Bebidas', '2000');

      const r = await withCtx(() => getVentasPorRubro());

      expect(r.map((x) => x.rubro)).toEqual(['Almacén', 'Bebidas']);
      expect(new Decimal(r[0]!.total).toNumber()).toBe(10000);
      expect(new Decimal(r[1]!.total).toNumber()).toBe(5000);
    });

    /**
     * La invariante del bloque: si los rubros no suman el total, el
     * comerciante está mirando una torta a la que le falta un pedazo y no hay
     * nada en pantalla que se lo diga.
     */
    it('los rubros suman EXACTAMENTE la facturación de ítems del mes', async () => {
      await ventaDeRubro('Bebidas', '3333.33');
      await ventaDeRubro('Almacén', '6666.67');
      await ventaDeRubro(null, '1000');

      const r = await withCtx(() => getVentasPorRubro());
      const suma = r.reduce((a, x) => a.plus(x.total), new Decimal(0));

      expect(suma.toFixed(2)).toBe('11000.00');
      // Y los porcentajes cierran en 100.
      const pct = r.reduce((a, x) => a.plus(x.porcentaje), new Decimal(0));
      expect(pct.toNumber()).toBeCloseTo(100, 1);
    });

    /**
     * Un producto sin rubro tiene que seguir sumando: si se cayera del listado,
     * los rubros dejarían de cerrar contra el total y nadie lo notaría.
     */
    it('un producto sin rubro no desaparece: cae en "(sin rubro)"', async () => {
      await ventaDeRubro(null, '5000');
      await ventaDeRubro('Bebidas', '1000');

      const r = await withCtx(() => getVentasPorRubro());

      expect(r.map((x) => x.rubro)).toEqual(['(sin rubro)', 'Bebidas']);
      expect(new Decimal(r[0]!.total).toNumber()).toBe(5000);
    });

    /**
     * El `nullif(trim(category), '')` de la consulta cubre un caso que la base
     * ya impide: `products_category_length` exige `length(btrim(category)) >= 1`
     * cuando la columna no es NULL. Se deja escrito acá para que quede claro que
     * el rubro en blanco NO es un estado alcanzable, y que el coalesce cubre el
     * NULL — que sí lo es.
     */
    it('la base no admite un rubro en blanco', async () => {
      const e = await ventaDeRubro('   ', '1000').then(
        () => null,
        (err: unknown) => err
      );
      expect(e).not.toBeNull();
      const causa = (e as { cause?: { constraint_name?: string } }).cause;
      expect(causa?.constraint_name).toBe('products_category_length');
    });

    it('no arrastra las ventas del mes pasado', async () => {
      const [ref] = await db.execute<{ ant: string }>(
        sql`SELECT (date_trunc('month', (now() AT TIME ZONE ${TZ_COMERCIO})::date)
                    - interval '3 days')::date::text AS ant`
      );
      await ventaDeRubro('Almacén', '99999', '1', ref!.ant);
      await ventaDeRubro('Bebidas', '1000');

      const r = await withCtx(() => getVentasPorRubro());

      expect(r.map((x) => x.rubro)).toEqual(['Bebidas']);
    });

    /**
     * La reconciliacion del bloque: los rubros tienen que sumar lo MISMO que
     * "Facturacion del mes" muestra dos tarjetas mas arriba. Si una venta cobra
     * mas de lo que explican sus lineas, ese faltante sale como fila propia en
     * vez de evaporarse — si no, el comerciante ve una torta a la que le falta
     * un pedazo y nada en pantalla se lo dice.
     */
    it('una venta sin items no se evapora: aparece como (sin detalle)', async () => {
      await ventaDeRubro('Almacén', '6000');
      // Una venta cobrada SIN una sola linea. Existe: hay 10 asi en la base de
      // desarrollo, y va a volver con el descuento global, que vive en la venta
      // y no en la linea.
      await db.insert(sales).values({
        tenant_id: tenantId,
        correlation_id: crypto.randomUUID(),
        cashier_user_id: userId,
        commercial_status: 'cobrada',
        fiscal_status: 'not_required',
        subtotal: '4000',
        tax_amount: '0',
        total: '4000',
        payment_method: 'efectivo',
        created_at: sql`((${await hoyLocal()})::date + interval '12 hours') AT TIME ZONE ${TZ_COMERCIO}` as never,
      });

      const r = await withCtx(() => getVentasPorRubro());
      const sinDetalle = r.find((x) => x.rubro === '(sin detalle de items)');

      expect(sinDetalle).toBeDefined();
      expect(new Decimal(sinDetalle!.total).toNumber()).toBe(4000);
      // Y el total sigue cerrando contra la facturacion del mes.
      const suma = r.reduce((a, x) => a.plus(x.total), new Decimal(0));
      const mes = await withCtx(() => getPanelMes());
      expect(suma.toFixed(2)).toBe(new Decimal(mes.total).toFixed(2));
      expect(r.reduce((a, x) => a.plus(x.porcentaje), new Decimal(0)).toNumber())
        .toBeCloseTo(100, 1);
    });

    /**
     * Una ferreteria puede tener treinta rubros y la tarjeta no scrollea. Se
     * agrupan, NO se recortan: un LIMIT dejaria la torta sin cerrar.
     */
    it('mas de seis rubros se agrupan en "Otros rubros", sin perder plata', async () => {
      for (let i = 0; i < 9; i++) {
        await ventaDeRubro(`Rubro ${i}`, String(1000 * (9 - i)));
      }

      const r = await withCtx(() => getVentasPorRubro());
      const otros = r.find((x) => x.rubro === 'Otros rubros');

      // 6 visibles + la fila de agrupados.
      expect(r).toHaveLength(7);
      expect(otros).toBeDefined();
      // Los tres mas chicos: 3000 + 2000 + 1000.
      expect(new Decimal(otros!.total).toNumber()).toBe(6000);
      const suma = r.reduce((a, x) => a.plus(x.total), new Decimal(0));
      expect(suma.toNumber()).toBe(45000); // 9000+8000+...+1000
    });

    it('no ve los rubros de otro comercio', async () => {
      await ventaDeRubro('Almacén', '5000');
      const r = await withCtx(() => getVentasPorRubro(), otroTenant);
      expect(r).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // CLIENTES DEL MES
  // ══════════════════════════════════════════════════════════════════════
  describe('clientes del mes', () => {
    const cliente = async (nombre: string) => {
      const [c] = await db
        .insert(customers)
        .values({ tenant_id: tenantId, name: nombre })
        .returning({ id: customers.id });
      return c!.id;
    };

    /** Venta atada (o no) a un cliente, en el día local que se indique. */
    const ventaDe = async (customerId: string | null, total: string, diaLocal?: string) => {
      const dia = diaLocal ?? (await hoyLocal());
      await db.insert(sales).values({
        tenant_id: tenantId,
        correlation_id: crypto.randomUUID(),
        cashier_user_id: userId,
        commercial_status: 'cobrada',
        fiscal_status: 'not_required',
        subtotal: total,
        tax_amount: '0',
        total,
        payment_method: 'efectivo',
        ...(customerId === null ? {} : { customer_id: customerId }),
        created_at: sql`(${dia}::date + interval '12 hours') AT TIME ZONE ${TZ_COMERCIO}` as never,
      });
    };

    /** Un día del mes PASADO, para fabricar historia previa. */
    const mesPasado = async (): Promise<string> => {
      const [r] = await db.execute<{ d: string }>(
        sql`SELECT (date_trunc('month', (now() AT TIME ZONE ${TZ_COMERCIO})::date)
                    - interval '5 days')::date::text AS d`
      );
      return r!.d;
    };

    it('cuenta clientes distintos, no ventas', async () => {
      const a = await cliente('Ana');
      await ventaDe(a, '1000');
      await ventaDe(a, '2000');
      await ventaDe(a, '3000');

      const r = await withCtx(() => getPanelClientes());
      expect(r.activos).toBe(1);
    });

    /**
     * "Nuevo" es el que compró por PRIMERA VEZ este mes, no el que tiene la
     * ficha recién cargada: `customers.created_at` es cuándo se cargó el dato.
     */
    it('nuevo es por primera COMPRA, no por cuándo se cargó la ficha', async () => {
      const viejo = await cliente('Cliente viejo');
      const nuevo = await cliente('Cliente nuevo');
      // Los dos tienen la ficha creada recién (ahora). Lo que los diferencia es
      // que uno ya compró el mes pasado.
      await ventaDe(viejo, '1000', await mesPasado());
      await ventaDe(viejo, '1000');
      await ventaDe(nuevo, '1000');

      const r = await withCtx(() => getPanelClientes());

      expect(r.activos).toBe(2);
      expect(r.nuevos).toBe(1);
      expect(r.vuelven).toBe(1);
    });

    /**
     * El número del bloque: qué porción de la facturación tiene nombre y
     * apellido. El resto es consumidor final — NO clientes perdidos.
     */
    it('el porcentaje identificado es sobre la facturación, no sobre los tickets', async () => {
      const a = await cliente('Ana');
      // Un ticket identificado grande y tres anónimos chicos: por tickets sería
      // 25%, por plata es 70%. El bloque muestra la plata.
      await ventaDe(a, '7000');
      await ventaDe(null, '1000');
      await ventaDe(null, '1000');
      await ventaDe(null, '1000');

      const r = await withCtx(() => getPanelClientes());

      expect(new Decimal(r.facturadoIdentificado).toNumber()).toBe(7000);
      expect(new Decimal(r.porcentajeIdentificado!).toNumber()).toBe(70);
    });

    it('sin ventas el porcentaje es null, NO cero', async () => {
      const r = await withCtx(() => getPanelClientes());
      expect(r.activos).toBe(0);
      expect(r.porcentajeIdentificado).toBeNull();
    });

    it('una venta anónima no rompe la cuenta de activos', async () => {
      await ventaDe(null, '5000');
      const r = await withCtx(() => getPanelClientes());
      expect(r.activos).toBe(0);
      expect(r.vuelven).toBe(0);
      expect(new Decimal(r.porcentajeIdentificado!).toNumber()).toBe(0);
    });

    it('no ve los clientes de otro comercio', async () => {
      const a = await cliente('Ana');
      await ventaDe(a, '5000');
      const r = await withCtx(() => getPanelClientes(), otroTenant);
      expect(r.activos).toBe(0);
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
