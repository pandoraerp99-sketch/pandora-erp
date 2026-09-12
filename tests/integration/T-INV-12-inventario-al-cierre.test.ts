/**
 * T-INV-12 — El inventario valorizado al cierre, contra la DB.
 *
 * La aritmética ya está probada en `tests/unit/inventario-valorizado.test.ts`.
 * Lo que se prueba acá es lo que sólo se rompe con la base de por medio:
 *
 *  1. La cantidad sale del LIBRO a una fecha pasada, no de `stock_current`.
 *     Es la razón de ser de las migrations 0032 y 0035.
 *  2. Una compra ANULADA deja de respaldar unidades — pasan a "sin compra".
 *  3. Una compra POSTERIOR al cierre no entra, aunque sea la más reciente.
 *  4. Los productos sin control de stock quedan afuera, y se dice cuántos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { expenses } from '@/lib/db/schema/expenses';
import { expense_items } from '@/lib/db/schema/expense_items';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  registerExpense,
  annulExpense,
} from '@/lib/services/expenses/expense.service';
import { recordStockMovement } from '@/lib/inventory';
import {
  armarCsvInventario,
  getInventarioAlCierre,
} from '@/lib/services/reporting/inventario.report';

describe('T-INV-12 — Inventario valorizado al cierre', () => {
  const tenant = crypto.randomUUID();
  const user = crypto.randomUUID();
  const yerba = crypto.randomUUID();
  const azucar = crypto.randomUUID();
  const bolsas = crypto.randomUUID();
  const fideos = crypto.randomUUID();
  const CIERRE = '2026-07-31';

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

  // Acá había un helper que reescribía `created_at` de los movimientos para
  // "moverlos en el tiempo". Forzaba a que la fecha de carga coincidiera con la
  // del comprobante, y por eso ningún test vio que la cantidad y los lotes
  // miraban relojes distintos. Desde la migration 0037 la fecha de un
  // movimiento es un DATO (`fecha`) y los tests la pasan como tal.

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenant,
      name: 'T-INV-12 Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: user,
      email: `t-inv-12-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Quien cierra',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenant,
      user_id: user,
      role: 'owner',
    });
    const base = {
      tenant_id: tenant,
      unit_type: 'unidad' as const,
      price: '3000.0000',
      tax_rate: '21.00',
      stock_current: '0.0000',
      stock_tracking_enabled: true,
      is_active: true,
    };
    await db.insert(products).values([
      { ...base, id: yerba, name: 'Yerba 1kg', cost: '2000.0000' },
      { ...base, id: azucar, name: 'Azúcar 1kg', cost: null },
      // Para el comprobante cargado tarde: sin ningún otro movimiento que
      // pueda tapar la diferencia entre los dos relojes.
      { ...base, id: fideos, name: 'Fideos 500g', cost: '900.0000' },
      // Sin control de stock: no tiene libro que reconstruir.
      {
        ...base,
        id: bolsas,
        name: 'Bolsas',
        stock_tracking_enabled: false,
        stock_current: '500.0000',
        cost: '10.0000',
      },
    ]);
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenant));
      await tx.delete(expense_items).where(eq(expense_items.tenant_id, tenant));
      await tx.delete(expenses).where(eq(expenses.tenant_id, tenant));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenant));
      await tx.delete(products).where(eq(products.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(eq(companies.id, tenant));
    });
  });

  it('🔴 la cantidad sale del libro A LA FECHA, no del stock de hoy', async () => {
    // Stock inicial de 10 (declarado, sin compra) + compra de 5 con lote, las
    // dos ANTES del cierre.
    await conCtx(() =>
      recordStockMovement({
        product_id: yerba,
        type: 'adjustment',
        direction: 'in',
        qty: '10',
        reason: 'stock inicial del test',
        fecha: '2026-06-10',
      })
    );
    // La compra NO lleva fecha del movimiento a mano: la toma del comprobante.
    await conCtx(() =>
      registerExpense({
        fecha: '2026-06-10',
        categoria: 'mercaderia',
        total: '11000',
        medio_pago: 'transferencia',
        items: [{ product_id: yerba, qty: '5', unit_cost: '2200' }],
      })
    );

    // Y DESPUÉS del cierre entran 100 más: el stock de hoy es 115, pero al
    // 31/07 había 15. Si el reporte leyera `stock_current`, diría 115.
    await conCtx(() =>
      recordStockMovement({
        product_id: yerba,
        type: 'adjustment',
        direction: 'in',
        qty: '100',
        reason: 'compra posterior al cierre',
      })
    );

    const inv = await conCtx(() => getInventarioAlCierre(CIERRE));
    const fila = inv.filas.find((f) => f.product_id === yerba);

    expect(fila?.cantidad).toBe('15.0000');
    expect(fila?.lotes).toHaveLength(1);
    expect(fila?.lotes[0]?.qty).toBe('5.0000');
    expect(fila?.lotes[0]?.fecha).toBe('2026-06-10');
    expect(fila?.con_compra_total).toBe('11000.0000');
    expect(fila?.sin_compra_qty).toBe('10.0000');

    // Las 10 sin respaldo se valorizan a **2200**, no a los 2000 con los que se
    // dio de alta el producto: registrar la compra movió `products.cost` al
    // costo de la última compra, que es lo que esa columna significa desde la
    // slice 2. O sea que el costo declarado de las unidades viejas es siempre
    // el más reciente que el sistema conoce — la mejor estimación disponible,
    // y por eso el reporte la marca como DECLARADA y no la mezcla con los
    // lotes que sí tienen comprobante.
    expect(fila?.sin_compra_total).toBe('22000.0000');
    expect(fila?.total).toBe('33000.0000');
  });

  it('el método de valuación viaja con el número', async () => {
    const inv = await conCtx(() => getInventarioAlCierre(CIERRE));
    // Un total sin método no se puede auditar, y el método es decisión del
    // estudio: Pandora implementa uno y lo declara.
    expect(inv.metodo).toBe('PEPS');
    expect(inv.fecha).toBe(CIERRE);
  });

  it('🔴 sin costo declarado, el total del inventario es desconocido (no menor)', async () => {
    // Azúcar entra con stock sin compra y SIN costo: no se puede valorizar.
    await conCtx(() =>
      recordStockMovement({
        product_id: azucar,
        type: 'adjustment',
        direction: 'in',
        qty: '7',
        reason: 'stock inicial sin costo',
        fecha: '2026-05-02',
      })
    );

    const inv = await conCtx(() => getInventarioAlCierre(CIERRE));
    const fila = inv.filas.find((f) => f.product_id === azucar);

    expect(fila?.sin_costo).toBe(true);
    // Las 7 unidades NO entran al total, y el reporte dice cuántas son. El
    // total queda corto a propósito; mostrarlo sin la exclusión al lado es lo
    // que lo haría mentir por omisión.
    expect(fila?.total).toBe('0.0000');
    expect(fila?.sin_valorizar_qty).toBe('7.0000');
    expect(inv.sin_valorizar_qty).toBe('7.0000');
    expect(inv.sin_valorizar_productos).toBe(1);
    // La pantalla dice "los otros $X son unidades sin compra asociada en N
    // productos". N tiene que ser de los productos que están EN ese $X: la
    // yerba sí, el azúcar no — sus unidades no tienen costo y ya las declara
    // el aviso de "no incluidas en el total". Contarlo dos veces infla N.
    expect(inv.con_unidades_sin_compra).toBe(1);
    // Y lo que sí se puede afirmar sigue estando, completo.
    expect(inv.con_compra_total).toBe('11000.0000');
    expect(inv.total).toBe('33000.0000');
  });

  it('🔴 una compra ANULADA deja de respaldar unidades', async () => {
    const [gasto] = await db
      .select()
      .from(expenses)
      .where(eq(expenses.tenant_id, tenant))
      .limit(1);

    // Se anula la compra de yerba. La mercadería vuelve, así que la cantidad
    // al cierre baja a 10 — y ninguna queda respaldada por comprobante.
    await conCtx(() =>
      annulExpense({ expense_id: gasto!.id, motivo: 'era de otro comercio' })
    );

    const inv = await conCtx(() => getInventarioAlCierre(CIERRE));
    const fila = inv.filas.find((f) => f.product_id === yerba);

    // El comentario de arriba siempre lo dijo y ningún expect lo miraba: la
    // reversa hereda la fecha del comprobante (10/06), así que al 31/07 quedan
    // las 10 del stock inicial. Las 100 de después del cierre siguen afuera.
    expect(fila?.cantidad).toBe('10.0000');

    expect(fila?.lotes).toHaveLength(0);
    expect(fila?.con_compra_total).toBe('0.0000');
    expect(inv.con_compra_total).toBe('0.0000');
    // Y el costo del producto volvió a NULL al anular la única compra, así que
    // ahora tampoco se puede valorizar al declarado.
    expect(fila?.sin_costo).toBe(true);
  });

  it('🔴 el CSV trae una fila por LOTE, con su fecha de adquisición', async () => {
    // Es lo que el ítem 8 pide textualmente. Una fila por producto con el
    // total no sirve: no dice cuándo se compró ni a cuánto.
    const inv = await conCtx(() => getInventarioAlCierre(CIERRE));
    const csv = armarCsvInventario(inv);
    const lineas = csv.split('\r\n').filter((l) => l.trim() !== '');

    // La primera columna se llama "Producto": es la que la contadora ordena y
    // filtra en Excel. Una oración ahí vuelve incómoda la planilla entera.
    // (`lineas[0]` arranca con el BOM, por eso se le saca antes de comparar.)
    expect(lineas[0]?.replace(/^﻿/, '').split(';')[0]).toBe('Producto');

    // El método y la fecha viajan en una nota AL PIE del archivo, como en el
    // CSV de proveedores: un inventario valorizado sin decir con qué criterio
    // no se puede auditar, y el archivo es lo que llega al estudio.
    const pie = lineas[lineas.length - 1];
    expect(pie).toContain('PEPS');
    expect(pie).toContain(CIERRE);

    // Yerba tiene 10 unidades sin compra (la compra se anuló en el test
    // anterior) y ninguna con lote, así que va una sola fila marcada.
    const deYerba = lineas.filter((l) => l.startsWith('Yerba'));
    expect(deYerba).toHaveLength(1);
    expect(deYerba[0]).toContain('sin compra asociada');

    // Azúcar no tiene costo: la fila va igual, con el importe VACÍO y dicho.
    // Un 0 ahí bajaría el inventario del estudio sin que nada avise.
    const deAzucar = lineas.find((l) => l.startsWith('Azúcar'));
    expect(deAzucar).toContain('SIN COSTO');
    expect(deAzucar?.split(';')[6]).toBe('');

    // Y ninguna fila sin comprobante inventa una fecha de adquisición.
    for (const l of lineas.slice(1)) {
      const [, , fecha, , , , , origen] = l.split(';');
      if (origen?.startsWith('sin compra')) expect(fecha).toBe('');
    }
  });

  it('los productos sin control de stock quedan afuera, y se dice cuántos', async () => {
    const inv = await conCtx(() => getInventarioAlCierre(CIERRE));
    expect(inv.filas.some((f) => f.product_id === bolsas)).toBe(false);
    // No se esconden: el reporte declara que hay 1 producto que no entra.
    expect(inv.sin_tracking).toBe(1);
  });

  // ── Un solo reloj ──────────────────────────────────────────────────────────
  //
  // Los tests de arriba se escribieron reescribiendo `created_at` para que
  // coincidiera con la fecha del comprobante, y por eso nunca vieron que la
  // cantidad y los lotes miraban relojes distintos. Estos dos NO tocan ninguna
  // fecha: cargan hoy un comprobante de julio, que es el caso de todos los días.

  it('🔴 un comprobante anterior al cierre cargado DESPUÉS cuenta en la cantidad', async () => {
    await conCtx(() =>
      registerExpense({
        fecha: '2026-07-20',
        categoria: 'mercaderia',
        total: '7200',
        medio_pago: 'transferencia',
        items: [{ product_id: fideos, qty: '8', unit_cost: '900' }],
      })
    );

    const inv = await conCtx(() => getInventarioAlCierre(CIERRE));
    const fila = inv.filas.find((f) => f.product_id === fideos);

    // La mercadería de ese comprobante estaba en el local el 31/07. Si la
    // cantidad mirara cuándo se cargó, la fila no existiría al cierre y el lote
    // respaldaría unidades que no están.
    expect(fila?.cantidad).toBe('8.0000');
    expect(fila?.lotes).toHaveLength(1);
    expect(fila?.lotes[0]?.qty).toBe('8.0000');
    expect(fila?.sin_compra_qty).toBe('0.0000');
  });

  it('🔴 anularlo hoy también lo saca de la cantidad al cierre, no sólo del lote', async () => {
    const [gasto] = await db
      .select()
      .from(expenses)
      .where(eq(expenses.tenant_id, tenant))
      .orderBy(sql`created_at DESC`)
      .limit(1);
    expect(gasto?.fecha).toBe('2026-07-20');

    await conCtx(() =>
      annulExpense({ expense_id: gasto!.id, motivo: 'se cargó dos veces' })
    );

    // La anulación del gasto hereda la fecha del original; la reversa de la
    // mercadería tiene que heredarla también. Si llevara la de hoy, julio se
    // quedaría con 8 fideos sin ningún comprobante que los respalde.
    const inv = await conCtx(() => getInventarioAlCierre(CIERRE));
    expect(inv.filas.find((f) => f.product_id === fideos)).toBeUndefined();
  });
});
