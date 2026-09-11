/**
 * T-SALES-07 — el costo se congela en la línea, como el precio.
 *
 * **Por qué existe esta columna.** `products.cost` es UN valor: el de hoy.
 * Cuando el proveedor aumenta, se pisa. Calcular el margen de una venta de
 * marzo con el costo de septiembre no da el margen de marzo — da un número
 * inventado que encima parece confiable. Y no se puede arreglar después:
 * la historia del costo no existe en ningún lado.
 *
 * **Lo que estos tests protegen**, en orden de importancia:
 *   1. NULL sigue siendo NULL. `products.cost` es nullable y hoy 9 de 20.009
 *      productos activos lo tienen cargado, así que la mayoría de las líneas
 *      van a guardar NULL. "No había costo cargado" NO es "el costo era 0":
 *      con 0 el margen da 100%, un número alto y redondo del lado que nadie
 *      revisa. Ningún producto tiene costo 0 hoy, así que la confusión sería
 *      silenciosa.
 *   2. El snapshot no sigue al producto. Es toda la razón de ser de la
 *      columna; si el costo se re-leyera después, no habríamos ganado nada
 *      sobre hacer un JOIN a `products`.
 *   3. No se puede editar después del cobro. Un costo editable post-venta es
 *      PEOR que no tenerlo: parece evidencia.
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
  createDraftSale,
  addItemToSale,
  updateItemQuantity,
  finalizeSale,
} from '@/lib/services/sales/sale.service';

describe('T-SALES-07 — costo al momento de la venta', () => {
  let tenantId: string;
  let userId: string;
  let conCosto: string;
  let sinCosto: string;

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

  /**
   * El mensaje que escribe Postgres viene en `cause`: drizzle lo envuelve en
   * un "Failed query: ..." que no dice por qué falló. Asertar contra el
   * wrapper pasaría con CUALQUIER error de SQL, incluido un typo en el test.
   */
  async function rechazoDeLaBase(promesa: Promise<unknown>): Promise<string> {
    try {
      await promesa;
    } catch (e) {
      const err = e as { message?: string; cause?: { message?: string } };
      return `${err.cause?.message ?? ''} | ${err.message ?? ''}`;
    }
    throw new Error('se esperaba un rechazo de la base, y la operación pasó');
  }

  /** Las líneas de una venta, con su costo congelado. */
  const lineasDe = (saleId: string) =>
    db
      .select({
        product_id: sale_items.product_id,
        unit_price: sale_items.unit_price,
        unit_cost_snapshot: sale_items.unit_cost_snapshot,
      })
      .from(sale_items)
      .where(eq(sale_items.sale_id, saleId));

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    conCosto = crypto.randomUUID();
    sinCosto = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-SALES-07 Co',
      legal_name: 'T-SALES-07 Co SRL',
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
      email: `t-sales-07-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cajero T-SALES-07',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });
    await db.insert(products).values([
      {
        id: conCosto,
        tenant_id: tenantId,
        name: 'Coca 500 (con costo cargado)',
        unit_type: 'unidad',
        price: '100.0000',
        cost: '60.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        stock_current: '100.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
      {
        // El caso REAL de la base: producto sin costo cargado.
        id: sinCosto,
        tenant_id: tenantId,
        name: 'Caramelo suelto (sin costo cargado)',
        unit_type: 'unidad',
        price: '100.0000',
        cost: null,
        tax_rate: '21.00',
        tdf_exempt: false,
        stock_current: '100.0000',
        stock_tracking_enabled: true,
        is_active: true,
      },
    ]);
  });

  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(sale_payments).where(eq(sale_payments.tenant_id, tenantId));
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('agregar un producto congela su costo en la línea', async () => {
    const venta = await withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      return addItemToSale({
        sale_id: draft.id,
        product_id: conCosto,
        quantity: '2.0000',
      });
    });

    const [linea] = await lineasDe(venta.sale.id);
    expect(linea?.unit_cost_snapshot).toBe('60.0000');
    // Es el costo UNITARIO, no el de las dos unidades.
    expect(linea?.unit_price).toBe('100.0000');
  });

  it('un producto SIN costo cargado guarda NULL — no 0', async () => {
    const venta = await withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      return addItemToSale({
        sale_id: draft.id,
        product_id: sinCosto,
        quantity: '1.0000',
      });
    });

    const [linea] = await lineasDe(venta.sale.id);
    expect(linea?.unit_cost_snapshot).toBeNull();
    // Explícito: la confusión que este test existe para impedir.
    expect(linea?.unit_cost_snapshot).not.toBe('0.0000');
  });

  it('EL SNAPSHOT NO CAMBIA aunque el costo del producto cambie después', async () => {
    const venta = await withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      await addItemToSale({
        sale_id: draft.id,
        product_id: conCosto,
        quantity: '1.0000',
      });
      return finalizeSale({
        sale_id: draft.id,
        payments: [{ method: 'efectivo', amount: '121.0000' }],
        require_fiscal_invoice: false,
      });
    });

    // El proveedor aumenta: el costo de hoy pisa al de ayer, como siempre.
    await db
      .update(products)
      .set({ cost: '95.0000' })
      .where(eq(products.id, conCosto));

    const [linea] = await lineasDe(venta.sale.id);
    expect(linea?.unit_cost_snapshot).toBe('60.0000');

    const [producto] = await db
      .select({ cost: products.cost })
      .from(products)
      .where(eq(products.id, conCosto));
    expect(producto?.cost).toBe('95.0000');
  });

  it('cambiar la cantidad NO re-lee un costo más nuevo', async () => {
    // `updateItemQuantity` recalcula los totales de línea a partir de la fila
    // que ya está guardada. Si en vez de eso volviera a consultar el producto,
    // editar una cantidad traería el costo de HOY a una venta de antes.
    const draft = await withCtx(async () => {
      const d = await createDraftSale(userId, 1);
      await addItemToSale({
        sale_id: d.id,
        product_id: conCosto,
        quantity: '1.0000',
      });
      return d;
    });

    await db
      .update(products)
      .set({ cost: '95.0000' })
      .where(eq(products.id, conCosto));

    const [antes] = await db
      .select({ id: sale_items.id })
      .from(sale_items)
      .where(eq(sale_items.sale_id, draft.id));

    await withCtx(() =>
      updateItemQuantity({
        sale_id: draft.id,
        item_id: antes!.id,
        quantity: '3.0000',
      })
    );

    const [linea] = await lineasDe(draft.id);
    expect(linea?.unit_cost_snapshot).toBe('60.0000');
  });

  it('después del cobro el costo NO se puede editar', async () => {
    const venta = await withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      await addItemToSale({
        sale_id: draft.id,
        product_id: conCosto,
        quantity: '1.0000',
      });
      return finalizeSale({
        sale_id: draft.id,
        payments: [{ method: 'efectivo', amount: '121.0000' }],
        require_fiscal_invoice: false,
      });
    });

    // El trigger `sale_items_no_update_after_finalize` es por FILA, no por
    // columna, así que una columna nueva queda protegida sin tocarlo. Esto
    // lo verifica en vez de suponerlo.
    const rechazo = await rechazoDeLaBase(
      db
        .update(sale_items)
        .set({ unit_cost_snapshot: '1.0000' })
        .where(eq(sale_items.sale_id, venta.sale.id))
    );
    expect(rechazo).toMatch(/inmutables tras finalizacion/i);

    const [linea] = await lineasDe(venta.sale.id);
    expect(linea?.unit_cost_snapshot).toBe('60.0000');
  });

  it('un costo negativo es rechazado por la base', async () => {
    const draft = await withCtx(() => createDraftSale(userId, 1));

    const rechazo = await rechazoDeLaBase(
      db.insert(sale_items).values({
        sale_id: draft.id,
        tenant_id: tenantId,
        product_id: conCosto,
        product_name_snapshot: 'Coca 500',
        product_sku_snapshot: null,
        product_unit_type_snapshot: 'unidad',
        unit_price: '100.0000',
        quantity: '1.0000',
        unit_cost_snapshot: '-1.0000',
        tax_rate: '21.00',
        tdf_exempt: false,
        line_subtotal: '100.0000',
        line_tax: '21.0000',
        line_total: '121.0000',
      })
    );
    expect(rechazo).toMatch(/unit_cost_snapshot_no_negativo/);
  });
});
