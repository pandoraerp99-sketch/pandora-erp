/**
 * T-MARGEN-01 — margen bruto histórico del mes.
 *
 * **Por qué estos casos y no "devuelve un número".** En la base de desarrollo
 * el tenant demo tiene cobertura casi total de costos, así que una captura de
 * pantalla saldría verde igual si el código estuviera mal. Los dos estados que
 * de verdad importan —no hay ni una línea con costo, y hay algunas sin— sólo
 * se pueden forzar desde acá, con filas armadas a mano.
 *
 * Lo que se protege:
 *   1. La compuerta: sin ninguna línea con costo NO hay número.
 *   2. Cobertura parcial: hay número, y se sabe qué porción cubre.
 *   3. Las líneas sin costo NO se descartan del `facturado_total`; si se
 *      descartaran, el número parecería completo sin serlo.
 *   4. El borde del mes, el carrito abandonado y el otro comercio.
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
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  getMargenDelMes,
  getRentabilidadPorProducto,
} from '@/lib/services/reporting/margen.report';
import { calcularMargen, rentabilidadDe } from '@/lib/reporting/margen';

const TZ = 'America/Argentina/Ushuaia';

describe('T-MARGEN-01 — margen del mes', () => {
  let tenantId: string;
  let otroTenant: string;
  let userId: string;
  let prodA: string;
  let prodB: string;

  const withCtx = <T,>(fn: () => Promise<T>, tid = tenantId): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid,
          actor_user_id: userId,
          actor_type: 'user',
        },
        fn
      )
    );

  /** Día del mes corriente, en la zona del comercio. Por defecto: hoy. */
  async function dentroDelMes(offsetDias = 0): Promise<Date> {
    const [r] = await db.execute<{ t: string }>(
      sql`SELECT (date_trunc('month', (now() AT TIME ZONE ${TZ}))
                  + ${offsetDias}::int * interval '1 day'
                  + interval '12 hours') AT TIME ZONE ${TZ} AS t`
    );
    return new Date(r!.t);
  }

  /** El último instante del mes ANTERIOR: el borde que suele fallar. */
  async function mesPasado(): Promise<Date> {
    const [r] = await db.execute<{ t: string }>(
      sql`SELECT (date_trunc('month', (now() AT TIME ZONE ${TZ}))
                  - interval '1 second') AT TIME ZONE ${TZ} AS t`
    );
    return new Date(r!.t);
  }

  /**
   * Una venta con sus líneas. `costo: null` es una línea sin costo cargado —
   * el caso que la base de desarrollo casi no tiene y que hay que forzar.
   */
  async function venta(opts: {
    cuando: Date;
    estado?: string;
    tenant?: string;
    lineas: Array<{ producto: string; neto: string; costo: string | null; cant?: string }>;
  }) {
    const tid = opts.tenant ?? tenantId;
    const [v] = await db
      .insert(sales)
      .values({
        tenant_id: tid,
        correlation_id: generateCorrelationId(),
        cashier_user_id: userId,
        commercial_status: opts.estado ?? 'terminada',
        created_at: opts.cuando,
      })
      .returning({ id: sales.id });

    for (const l of opts.lineas) {
      const cant = l.cant ?? '1.0000';
      await db.insert(sale_items).values({
        sale_id: v!.id,
        tenant_id: tid,
        product_id: l.producto,
        product_name_snapshot: l.producto === prodA ? 'Producto A' : 'Producto B',
        product_unit_type_snapshot: 'unidad',
        unit_price: l.neto,
        quantity: cant,
        unit_cost_snapshot: l.costo,
        tax_rate: '21.00',
        tdf_exempt: false,
        line_subtotal: l.neto,
        line_tax: '0.0000',
        line_total: l.neto,
      });
    }
    return v!.id;
  }

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    otroTenant = crypto.randomUUID();
    userId = crypto.randomUUID();
    prodA = crypto.randomUUID();
    prodB = crypto.randomUUID();

    for (const [id, n] of [
      [tenantId, 1],
      [otroTenant, 2],
    ] as const) {
      await db.insert(companies).values({
        id,
        name: `T-MARGEN-01 Co ${n}`,
        legal_name: `T-MARGEN-01 Co ${n} SRL`,
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
      email: `t-margen-01-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cajero',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });
    for (const [id, tid] of [
      [prodA, tenantId],
      [prodB, tenantId],
    ] as const) {
      await db.insert(products).values({
        id,
        tenant_id: tid,
        name: id === prodA ? 'Producto A' : 'Producto B',
        unit_type: 'unidad',
        price: '1000.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        stock_current: '100.0000',
        stock_tracking_enabled: true,
        is_active: true,
      });
    }
  });

  afterEach(async () => {
    const ids = [tenantId, otroTenant];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      for (const t of ids) {
        await tx.delete(sale_payments).where(eq(sale_payments.tenant_id, t));
        await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, t));
        await tx.delete(sale_items).where(eq(sale_items.tenant_id, t));
        await tx.delete(sales).where(eq(sales.tenant_id, t));
        await tx.delete(audit_log).where(eq(audit_log.tenant_id, t));
        await tx.delete(products).where(eq(products.tenant_id, t));
        await tx.delete(company_users).where(eq(company_users.company_id, t));
        await tx.delete(companies).where(eq(companies.id, t));
      }
      await tx.delete(users).where(eq(users.id, userId));
    });
  });

  it('LA COMPUERTA: con ventas pero sin ningún costo, NO hay número', async () => {
    await venta({
      cuando: await dentroDelMes(),
      lineas: [
        { producto: prodA, neto: '1000.0000', costo: null },
        { producto: prodB, neto: '500.0000', costo: null },
      ],
    });

    const m = calcularMargen(await withCtx(getMargenDelMes));
    expect(m.estado).toBe('sin_datos');
    expect(m.margen).toBeNull();
    expect(m.margenPct).toBeNull();
    // Pero lo facturado SÍ se sabe, y se dice.
    expect(m.facturadoTotal).toBe('1500.0000');
    expect(m.lineasSinCosto).toBe(2);
  });

  it('COBERTURA PARCIAL: hay número y se sabe qué porción cubre', async () => {
    await venta({
      cuando: await dentroDelMes(),
      lineas: [
        { producto: prodA, neto: '1000.0000', costo: '600.0000' },
        { producto: prodB, neto: '1000.0000', costo: null },
      ],
    });

    const m = calcularMargen(await withCtx(getMargenDelMes));
    expect(m.estado).toBe('parcial');
    expect(m.margen).toBe('400.0000');
    expect(m.margenPct?.toFixed(1)).toBe('40.0');
    // El % es sobre los 1000 que tienen costo, NO sobre los 2000 facturados.
    expect(m.facturadoConCosto).toBe('1000.0000');
    expect(m.facturadoTotal).toBe('2000.0000');
    expect(m.coberturaPct?.toFixed(1)).toBe('50.0');
  });

  it('la línea sin costo NO desaparece del facturado total', async () => {
    // Si el WHERE filtrara las líneas sin costo, `facturado_total` daría 1000
    // y la cobertura 100%: un número que parece completo y no lo es.
    await venta({
      cuando: await dentroDelMes(),
      lineas: [
        { producto: prodA, neto: '1000.0000', costo: '600.0000' },
        { producto: prodB, neto: '7000.0000', costo: null },
      ],
    });

    const m = calcularMargen(await withCtx(getMargenDelMes));
    expect(m.facturadoTotal).toBe('8000.0000');
    expect(m.coberturaPct?.toFixed(1)).toBe('12.5');
    expect(m.lineasTotal).toBe(2);
  });

  it('COMPLETO cuando todas las líneas tienen costo', async () => {
    await venta({
      cuando: await dentroDelMes(),
      lineas: [
        { producto: prodA, neto: '1000.0000', costo: '600.0000' },
        { producto: prodB, neto: '1000.0000', costo: '400.0000' },
      ],
    });

    const m = calcularMargen(await withCtx(getMargenDelMes));
    expect(m.estado).toBe('completo');
    expect(m.margen).toBe('1000.0000');
    expect(m.coberturaPct?.toFixed(1)).toBe('100.0');
  });

  it('el costo se multiplica por la CANTIDAD, no se suma una vez', async () => {
    await venta({
      cuando: await dentroDelMes(),
      lineas: [
        { producto: prodA, neto: '3000.0000', costo: '600.0000', cant: '3.0000' },
      ],
    });

    const m = calcularMargen(await withCtx(getMargenDelMes));
    // 3000 facturado − (600 × 3) = 1200. Si no multiplicara daría 2400.
    expect(m.margen).toBe('1200.0000');
  });

  it('el mes pasado NO entra', async () => {
    await venta({
      cuando: await mesPasado(),
      lineas: [{ producto: prodA, neto: '9999.0000', costo: '1.0000' }],
    });
    await venta({
      cuando: await dentroDelMes(),
      lineas: [{ producto: prodA, neto: '1000.0000', costo: '600.0000' }],
    });

    const m = calcularMargen(await withCtx(getMargenDelMes));
    expect(m.facturadoTotal).toBe('1000.0000');
    expect(m.margen).toBe('400.0000');
  });

  it('un carrito abandonado no es una venta', async () => {
    await venta({
      cuando: await dentroDelMes(),
      estado: 'in_progress',
      lineas: [{ producto: prodA, neto: '5000.0000', costo: '100.0000' }],
    });

    const m = calcularMargen(await withCtx(getMargenDelMes));
    expect(m.estado).toBe('sin_datos');
    expect(m.facturadoTotal).toBe('0.0000');
  });

  it('NO ve las ventas de otro comercio', async () => {
    await venta({
      cuando: await dentroDelMes(),
      tenant: otroTenant,
      lineas: [{ producto: prodA, neto: '50000.0000', costo: '1.0000' }],
    });

    const m = calcularMargen(await withCtx(getMargenDelMes));
    expect(m.facturadoTotal).toBe('0.0000');
    expect(m.lineasTotal).toBe(0);
  });

  it('vender bajo costo da margen NEGATIVO, no cero', async () => {
    await venta({
      cuando: await dentroDelMes(),
      lineas: [{ producto: prodA, neto: '1000.0000', costo: '1300.0000' }],
    });

    const m = calcularMargen(await withCtx(getMargenDelMes));
    expect(m.margen).toBe('-300.0000');
    expect(m.margenPct?.toFixed(1)).toBe('-30.0');
  });

  describe('rentabilidad por producto', () => {
    it('un producto con costo en SOLO ALGUNAS líneas no afirma margen', async () => {
      // Mezclar daría un porcentaje que no se corresponde con los pesos de la
      // misma fila. Se prefiere decir "no sé" antes que un número plausible.
      await venta({
        cuando: await dentroDelMes(),
        lineas: [{ producto: prodA, neto: '1000.0000', costo: '600.0000' }],
      });
      await venta({
        cuando: await dentroDelMes(),
        lineas: [{ producto: prodA, neto: '1000.0000', costo: null }],
      });

      const filas = await withCtx(() => getRentabilidadPorProducto(10));
      const a = filas.find((f) => f.product_id === prodA)!;
      expect(a.facturado).toBe('2000.0000');
      expect(a.costo).toBeNull();

      const r = rentabilidadDe(a);
      expect(r.margenPct).toBeNull();
      // Pero la fila EXISTE: es justo la que hay que ir a completar.
      expect(r.facturado).toBe('2000.0000');
    });

    it('ordena por lo facturado y calcula el margen de cada uno', async () => {
      await venta({
        cuando: await dentroDelMes(),
        lineas: [
          { producto: prodA, neto: '1000.0000', costo: '580.0000' },
          { producto: prodB, neto: '5000.0000', costo: '2500.0000' },
        ],
      });

      const filas = (await withCtx(() => getRentabilidadPorProducto(10))).map(
        rentabilidadDe
      );
      expect(filas[0]?.product_id).toBe(prodB);
      expect(filas[0]?.margenPct?.toFixed(1)).toBe('50.0');
      expect(filas[1]?.margenPct?.toFixed(1)).toBe('42.0');
    });
  });
});
