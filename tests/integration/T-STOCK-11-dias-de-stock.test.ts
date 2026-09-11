/**
 * T-STOCK-11 — días de stock contra la base.
 *
 * La clasificación se prueba sin base en `tests/unit/dias-de-stock.test.ts`.
 * Acá se prueba lo que sólo puede fallar contra Postgres:
 *
 *   1. que la división por cero salga como `NULL` y no como `Infinity` ni
 *      como un error;
 *   2. que la ventana se acorte de verdad cuando hay poca historia — dividir
 *      3 días de ventas por 30 exagera para arriba los días que quedan;
 *   3. que un producto que no lleva stock no entre como "sin stock";
 *   4. que la historia se mida desde la PRIMERA VENTA y no desde el alta;
 *   5. aislamiento entre comercios.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { sales, sale_items } from '@/lib/db/schema/sales';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  getDiasDeHistoria,
  getDiasDeStock,
} from '@/lib/services/reporting/stock.report';
import { clasificar, ventanaEfectiva, VENTANA_DIAS } from '@/lib/stock/dias-de-stock';

const TZ = 'America/Argentina/Ushuaia';

describe('T-STOCK-11 — días de stock', () => {
  let tenantId: string;
  let otroTenant: string;
  let userId: string;

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

  const crearCompany = async (id: string, n: number) => {
    await db.insert(companies).values({
      id,
      name: `T-STOCK Co ${n}`,
      legal_name: `T-STOCK Co ${n} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
  };

  /** Un producto. `sigueStock=false` simula el que no lleva inventario. */
  const crearProducto = async (
    tid: string,
    nombre: string,
    stock: string,
    minimo: string | null,
    sigueStock = true
  ): Promise<string> => {
    const id = crypto.randomUUID();
    await db.insert(products).values({
      id,
      tenant_id: tid,
      sku: `SKU-${id.slice(0, 8)}`,
      name: nombre,
      price: '1000.0000',
      tax_rate: '21.00',
      stock_current: stock,
      stock_minimum: minimo,
      stock_tracking_enabled: sigueStock,
      is_active: true,
    });
    return id;
  };

  /**
   * Una venta hace N días, con `unidades` de `productoId`.
   *
   * La fecha se arma con `AT TIME ZONE` en la base y no con `new Date()` en
   * JS: el servidor corre en UTC y a las 21:30 de Ushuaia ya está en el día
   * siguiente, así que una venta "de hace 3 días" caería fuera de la ventana
   * la mitad de las veces según la hora a la que corra el test.
   */
  const venderHaceDias = async (
    tid: string,
    productoId: string,
    unidades: number,
    haceDias: number
  ) => {
    const saleId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO sales (id, tenant_id, correlation_id, cashier_user_id,
                         commercial_status, created_at)
      VALUES (${saleId}, ${tid}, gen_random_uuid(), ${userId}, 'cobrada',
              -- Mediodia del dia LOCAL, convertido a timestamptz por la base.
              -- Con new Date() en JS esto caeria en el dia equivocado segun
              -- la hora a la que corra el test, que es el bug que se evita.
              ((now() AT TIME ZONE ${TZ})::date - ${haceDias}::int + time '12:00')
                AT TIME ZONE ${TZ})
    `);
    await db.insert(sale_items).values({
      id: crypto.randomUUID(),
      tenant_id: tid,
      sale_id: saleId,
      product_id: productoId,
      product_name_snapshot: 'x',
      quantity: String(unidades),
      unit_price: '1000.0000',
      tax_rate: '21.00',
      line_subtotal: '1000.0000',
      line_tax: '210.0000',
      line_total: '1210.0000',
    });
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    otroTenant = crypto.randomUUID();
    userId = crypto.randomUUID();
    await crearCompany(tenantId, 1);
    await crearCompany(otroTenant, 2);
    await db.insert(users).values({
      id: userId,
      email: `t-stock-${userId.slice(0, 8)}@test.local`,
      full_name: 'Dueño',
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
    const ids = [tenantId, otroTenant];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(sale_items).where(inArray(sale_items.tenant_id, ids));
      await tx.delete(sales).where(inArray(sales.tenant_id, ids));
      await tx.delete(products).where(inArray(products.tenant_id, ids));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  const buscar = <T extends { nombre: string }>(filas: T[], nombre: string) =>
    filas.find((f) => f.nombre === nombre);

  // ── La compuerta de historia ────────────────────────────────────────────

  it('sin una sola venta, la historia es CERO (no explota ni da 1)', async () => {
    await crearProducto(tenantId, 'Coca 600', '10', '3');
    expect(await withCtx(() => getDiasDeHistoria())).toBe(0);
  });

  it('la historia se mide desde la primera VENTA, no desde el alta', async () => {
    const p = await crearProducto(tenantId, 'Coca 600', '10', '3');
    await venderHaceDias(tenantId, p, 1, 9);
    // El producto y la empresa se crearon recién; la venta más vieja es de
    // hace 9 días. Hoy incluido, son 10.
    expect(await withCtx(() => getDiasDeHistoria())).toBe(10);
  });

  it('una venta de otro comercio no le da historia a éste', async () => {
    const ajeno = await crearProducto(otroTenant, 'Ajeno', '10', null);
    await venderHaceDias(otroTenant, ajeno, 5, 40);
    expect(await withCtx(() => getDiasDeHistoria())).toBe(0);
  });

  // ── Las dos trampas, contra la base ─────────────────────────────────────

  it('un producto SIN VENTAS no da infinito: da NULL', async () => {
    const p = await crearProducto(tenantId, 'Lámpara', '20', '5');
    await venderHaceDias(tenantId, p, 0.0001, 400); // fuera de la ventana
    const filas = await withCtx(() => getDiasDeStock(400));
    const f = buscar(filas, 'Lámpara')!;
    expect(f.vendido).toBe('0.0000');
    // Lo que importa: NULL, no 'Infinity' ni un número gigante.
    expect(f.dias_restantes).toBeNull();
    expect(clasificar(Number(f.stock), null)).toBe('sin_rotacion');
  });

  it('un producto EN CERO con ventas se clasifica sin stock, no "0 días"', async () => {
    const p = await crearProducto(tenantId, 'Agua', '0', '5');
    await venderHaceDias(tenantId, p, 30, 5);
    const filas = await withCtx(() => getDiasDeStock(30));
    const f = buscar(filas, 'Agua')!;
    expect(Number(f.dias_restantes)).toBe(0);
    // La consulta dice 0 porque 0/velocidad ES 0. Es la clasificación la que
    // tiene que decir que el quiebre ya pasó.
    expect(clasificar(Number(f.stock), Number(f.dias_restantes))).toBe('sin_stock');
  });

  it('lo que ya se acabó va PRIMERO en la lista', async () => {
    const a = await crearProducto(tenantId, 'Agua', '0', '5');
    const b = await crearProducto(tenantId, 'Coca 600', '100', '5');
    await venderHaceDias(tenantId, a, 10, 3);
    await venderHaceDias(tenantId, b, 10, 3);
    const filas = await withCtx(() => getDiasDeStock(30));
    expect(filas[0]?.nombre).toBe('Agua');
  });

  // ── La ventana ──────────────────────────────────────────────────────────

  it('con poca historia la ventana se acorta, y la velocidad NO se diluye', async () => {
    const p = await crearProducto(tenantId, 'Coca 600', '30', '5');
    // 30 unidades vendidas ayer, y el comercio tiene 3 días de historia.
    await venderHaceDias(tenantId, p, 30, 1);

    const conVentanaReal = await withCtx(() => getDiasDeStock(3));
    const f = buscar(conVentanaReal, 'Coca 600')!;
    // 30 unidades / 3 días = 10 por día → 30 de stock duran 3 días.
    expect(Number(f.velocidad)).toBeCloseTo(10, 4);
    expect(Number(f.dias_restantes)).toBeCloseTo(3, 4);

    // Y así se vería si la ventana se hubiera quedado fija en 30: la velocidad
    // cae a 1/día y el stock parece durar 30 días. Diez veces más.
    const comoSiNoSeAcortara = await withCtx(() => getDiasDeStock(VENTANA_DIAS));
    const g = buscar(comoSiNoSeAcortara, 'Coca 600')!;
    expect(Number(g.velocidad)).toBeCloseTo(1, 4);
    expect(Number(g.dias_restantes)).toBeCloseTo(30, 4);
  });

  it('el BORDE exacto de la ventana: el día más viejo cuenta, el anterior no', async () => {
    // El predicado es `dia > hoy - ventana`. Con ventana=30 eso cubre
    // hoy-29..hoy, o sea 30 días. Sin esta prueba, un `>` cambiado por `>=`
    // (o al revés) pasaba desapercibido: ninguna otra venta de este archivo
    // cae justo en el borde.
    const p = await crearProducto(tenantId, 'Coca 600', '100', null);
    await venderHaceDias(tenantId, p, 7, 29); // último día ADENTRO
    await venderHaceDias(tenantId, p, 500, 30); // primer día AFUERA

    const f = buscar(await withCtx(() => getDiasDeStock(365)), 'Coca 600')!;
    // Si el de 30 entrara, esto daría 507 y el producto parecería durar horas.
    expect(Number(f.vendido)).toBe(7);
  });

  it('las ventas más viejas que la ventana no cuentan', async () => {
    const p = await crearProducto(tenantId, 'Coca 600', '50', '5');
    await venderHaceDias(tenantId, p, 100, 60); // vieja
    await venderHaceDias(tenantId, p, 30, 2); // adentro
    const filas = await withCtx(() => getDiasDeStock(365));
    expect(Number(buscar(filas, 'Coca 600')!.vendido)).toBe(30);
  });

  it('ventanaEfectiva y la consulta usan el MISMO número', async () => {
    const p = await crearProducto(tenantId, 'Coca 600', '30', null);
    await venderHaceDias(tenantId, p, 15, 1);
    const historia = 5;
    const filas = await withCtx(() => getDiasDeStock(historia));
    const f = buscar(filas, 'Coca 600')!;
    expect(Number(f.velocidad)).toBeCloseTo(15 / ventanaEfectiva(historia), 4);
  });

  // ── Filtros ─────────────────────────────────────────────────────────────

  it('un producto que NO lleva stock queda afuera (si no, sería "sin stock")', async () => {
    await crearProducto(tenantId, 'Servicio de flete', '0', null, false);
    await crearProducto(tenantId, 'Coca 600', '10', '3');
    const filas = await withCtx(() => getDiasDeStock(30));
    expect(buscar(filas, 'Servicio de flete')).toBeUndefined();
    expect(buscar(filas, 'Coca 600')).toBeDefined();
  });

  it('un producto SIN MINIMO igual entra: tiene velocidad igual', async () => {
    // Es la diferencia con la tarjeta Reponer, y no es menor: 20.001 de los
    // 20.009 productos de la base no tienen mínimo cargado.
    const p = await crearProducto(tenantId, 'Repuesto raro', '4', null);
    await venderHaceDias(tenantId, p, 30, 2);
    const f = buscar(await withCtx(() => getDiasDeStock(30)), 'Repuesto raro')!;
    expect(f.minimo).toBeNull();
    expect(Number(f.dias_restantes)).toBeCloseTo(4, 4);
  });

  it('un producto inactivo no entra', async () => {
    const id = await crearProducto(tenantId, 'Discontinuado', '5', '2');
    await db.execute(sql`UPDATE products SET is_active = false WHERE id = ${id}`);
    expect(buscar(await withCtx(() => getDiasDeStock(30)), 'Discontinuado')).toBeUndefined();
  });

  // ── Aislamiento ─────────────────────────────────────────────────────────

  it('no se ven productos de otro comercio', async () => {
    await crearProducto(otroTenant, 'Del otro', '10', '3');
    await crearProducto(tenantId, 'Mío', '10', '3');
    const filas = await withCtx(() => getDiasDeStock(30));
    expect(buscar(filas, 'Del otro')).toBeUndefined();
    expect(buscar(filas, 'Mío')).toBeDefined();
  });

  it('las ventas de otro comercio no inflan la velocidad de éste', async () => {
    const mio = await crearProducto(tenantId, 'Coca 600', '30', '5');
    const suyo = await crearProducto(otroTenant, 'Coca 600', '30', '5');
    await venderHaceDias(tenantId, mio, 3, 2);
    await venderHaceDias(otroTenant, suyo, 300, 2);
    const f = buscar(await withCtx(() => getDiasDeStock(30)), 'Coca 600')!;
    expect(Number(f.vendido)).toBe(3);
  });

  it('sin tenant en el context no se lee nada', async () => {
    await expect(
      Promise.resolve(
        withTracingContext(
          {
            correlation_id: generateCorrelationId(),
            request_id: generateRequestId(),
            tenant_id: null,
            actor_user_id: userId,
            actor_type: 'user',
          },
          () => getDiasDeStock(30)
        )
      )
    ).rejects.toThrow();
  });
});
