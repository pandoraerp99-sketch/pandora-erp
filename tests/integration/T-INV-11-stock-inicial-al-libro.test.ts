/**
 * T-INV-11 — El stock de alta entra por el libro.
 *
 * Hasta la migration 0035, `createProduct` escribía `stock_current` directo en
 * el INSERT. Medido contra la base de dev: de 7 productos con movimientos,
 * **7 no reconstruían desde el libro**, y la diferencia de cada uno era su
 * stock de alta.
 *
 * ── QUÉ SE PRUEBA ─────────────────────────────────────────────────────────
 * Que después de cualquier alta, `stock_current` = Σ(movimientos con signo).
 * Esa es la invariante de la que depende el inventario valorizado al cierre:
 * si el libro no reconstruye el stock de hoy, tampoco puede decir cuánto había
 * al 31 de diciembre.
 *
 * Los casos borde no son decoración — cada uno rompe la invariante de una
 * forma distinta: sin tracking la abriría al revés (columna 0, libro N), y un
 * alta inactiva la rompería por excepción (el movimiento se rechaza sobre un
 * producto inactivo).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { createProduct, updateProduct } from '@/lib/services/products/product.service';
import { importProductsFromCsv } from '@/lib/services/products/csv-import';
import { MOTIVO_STOCK_INICIAL } from '@/lib/inventory';
import { ValidationError } from '@/lib/multi_tenant/errors';

describe('T-INV-11 — El stock de alta entra por el libro', () => {
  const tenant = crypto.randomUUID();
  const user = crypto.randomUUID();

  const conCtx = <T>(fn: () => Promise<T>) =>
    withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenant,
        actor_user_id: user,
        actor_type: 'user',
      },
      fn
    );

  /** El stock según el LIBRO: suma de los movimientos con su signo. */
  const segunElLibro = async (productId: string) => {
    const movs = await db
      .select()
      .from(stock_movements)
      .where(
        and(
          eq(stock_movements.tenant_id, tenant),
          eq(stock_movements.product_id, productId)
        )
      );
    return movs.reduce(
      (acc, m) => (m.direction === 'in' ? acc.plus(m.qty) : acc.minus(m.qty)),
      new Decimal(0)
    );
  };

  const guardado = async (productId: string) => {
    const [p] = await db
      .select()
      .from(products)
      .where(and(eq(products.tenant_id, tenant), eq(products.id, productId)))
      .limit(1);
    return p;
  };

  const base = { price: '1000.00', tax_rate: '21.00' };

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenant,
      name: 'T-INV-11 Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: user,
      email: `t-inv-11-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Quien da de alta',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenant,
      user_id: user,
      role: 'owner',
    });
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenant));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenant));
      await tx.delete(products).where(eq(products.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(eq(companies.id, tenant));
    });
  });

  it('🔴 un alta con stock deja el libro cuadrado', async () => {
    const p = await conCtx(() =>
      createProduct({ ...base, name: 'Fideos 500g', stock_current: '24' })
    );

    expect(p.stock_current).toBe('24.0000');
    expect((await segunElLibro(p.id)).toFixed(4)).toBe('24.0000');

    const movs = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.product_id, p.id));
    expect(movs).toHaveLength(1);
    // `adjustment`, no `purchase`: es una declaración del comerciante, sin
    // comprobante ni proveedor. El reporte de valuación tiene que poder
    // distinguirla de mercadería realmente comprada.
    expect(movs[0]?.type).toBe('adjustment');
    expect(movs[0]?.direction).toBe('in');
    expect(movs[0]?.reason).toBe(MOTIVO_STOCK_INICIAL);
    expect(movs[0]?.related_expense_id).toBeNull();
  });

  it('🔴 el alta NO se audita como ajuste manual, pero el audit dice con cuánto entró', async () => {
    const p = await conCtx(() =>
      createProduct({ ...base, name: 'Arroz 1kg', stock_current: '8' })
    );

    const eventos = await db
      .select()
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenant),
          eq(audit_log.event_name, 'stock.adjusted_manually')
        )
      );
    // Un alta no es un ajuste manual: son cosas distintas y se cuentan aparte.
    expect(eventos).toHaveLength(0);

    const creados = await db
      .select()
      .from(audit_log)
      .where(
        and(eq(audit_log.tenant_id, tenant), eq(audit_log.event_name, 'product.created'))
      );
    const suyo = creados.find(
      (e) => (e.payload as { product_id?: string }).product_id === p.id
    );
    // Sin este campo, el audit no diría con cuánta mercadería entró el producto.
    expect((suyo?.payload as { stock_inicial?: string }).stock_inicial).toBe('8.0000');
  });

  it('un alta en cero no ensucia el libro con un movimiento vacío', async () => {
    const p = await conCtx(() => createProduct({ ...base, name: 'Sal fina' }));

    expect(p.stock_current).toBe('0.0000');
    const movs = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.product_id, p.id));
    expect(movs).toHaveLength(0);
  });

  it('🔴 sin tracking de stock NO se abre libro (abrirlo dejaría el descuadre al revés)', async () => {
    // `recordStockMovement` registra el movimiento pero NO toca `stock_current`
    // cuando el producto no lleva tracking. Abrir el libro acá dejaría la
    // columna en 0 y el libro en 5: el mismo descuadre que esto vino a cerrar.
    const p = await conCtx(() =>
      createProduct({
        ...base,
        name: 'Bolsas (no se cuentan)',
        stock_current: '5',
        stock_tracking_enabled: false,
      })
    );

    expect(p.stock_current).toBe('5.0000');
    const movs = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.product_id, p.id));
    expect(movs).toHaveLength(0);
  });

  it('🔴 un alta inactiva con stock no explota y también cuadra', async () => {
    // El movimiento se rechaza sobre un producto inactivo, así que la baja se
    // aplica después de abrir el libro. Sin eso, esto tiraba
    // ProductInactiveError sobre un producto recién creado.
    const p = await conCtx(() =>
      createProduct({
        ...base,
        name: 'Discontinuado con saldo',
        stock_current: '3',
        is_active: false,
      })
    );

    expect(p.is_active).toBe(false);
    expect(p.stock_current).toBe('3.0000');
    expect((await segunElLibro(p.id)).toFixed(4)).toBe('3.0000');
  });

  it('🔴 la importación masiva también entra por el libro', async () => {
    // Es el mismo agujero en bulk, y es donde más unidades entran de golpe.
    // La pantalla todavía no existe: se prueba ahora para que no reabra el
    // agujero el día que se cablee.
    const csv = [
      'name,price,stock_current',
      'Lavandina 1L,900,6',
      'Esponja,300,0',
    ].join('\n');

    const res = await conCtx(() => importProductsFromCsv(csv));
    expect(res.ok_count).toBe(2);

    const [lavandina] = await db
      .select()
      .from(products)
      .where(and(eq(products.tenant_id, tenant), eq(products.name, 'Lavandina 1L')))
      .limit(1);
    expect(lavandina?.stock_current).toBe('6.0000');
    expect((await segunElLibro(lavandina!.id)).toFixed(4)).toBe('6.0000');

    const [esponja] = await db
      .select()
      .from(products)
      .where(and(eq(products.tenant_id, tenant), eq(products.name, 'Esponja')))
      .limit(1);
    expect(esponja?.stock_current).toBe('0.0000');
    const movsEsponja = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.product_id, esponja!.id));
    expect(movsEsponja).toHaveLength(0);
  });

  it('🔴 editar un producto no puede mover el stock', async () => {
    const p = await conCtx(() =>
      createProduct({ ...base, name: 'Azúcar 1kg', stock_current: '10' })
    );

    // La pantalla ya lo evita (el input está deshabilitado al editar), pero una
    // Server Action es un borde público: lo tiene que hacer cumplir el server.
    await expect(
      conCtx(() => updateProduct(p.id, { name: 'Azúcar 1kg', stock_current: '999' }))
    ).rejects.toThrow(ValidationError);

    // Y no movió nada: ni la columna ni el libro.
    expect((await guardado(p.id))?.stock_current).toBe('10.0000');
    expect((await segunElLibro(p.id)).toFixed(4)).toBe('10.0000');

    // Editar OTRA cosa sigue funcionando (el guard acepta el campo ausente).
    const renombrado = await conCtx(() =>
      updateProduct(p.id, { name: 'Azúcar refinada 1kg' })
    );
    expect(renombrado.name).toBe('Azúcar refinada 1kg');
    expect(renombrado.stock_current).toBe('10.0000');
  });
});
