/**
 * T-COMPRAS-01 — La compra de mercadería entra al stock con su costo.
 *
 * Slice 2 de `RESEARCH-BRIEF-compras-y-lotes.md`. Cierra la mitad que faltaba
 * del ítem 8 del pedido de la contadora: el lote (fecha de adquisición +
 * importe de compra), que `products.cost` por sí solo no puede dar porque es
 * un valor único que se pisa cada vez que el proveedor aumenta.
 *
 * ── LA INVARIANTE QUE IMPORTA ─────────────────────────────────────────────
 * No alcanza con contar filas. Lo que el inventario valorizado al cierre
 * necesita es que **el stock reconstruido desde el ledger sea igual al stock
 * guardado**, después de comprar, vender e intentar anular. Esa es la cuenta
 * que la columna `direction` (migration 0032) vino a hacer posible, y es la
 * que se verifica acá de punta a punta.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { expenses } from '@/lib/db/schema/expenses';
import { expense_items } from '@/lib/db/schema/expense_items';
import { terceros } from '@/lib/db/schema/terceros';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  registerExpense,
  annulExpense,
  getExpenseItems,
  ExpenseError,
} from '@/lib/services/expenses/expense.service';
import { recordStockMovement } from '@/lib/inventory';

describe('T-COMPRAS-01 — Compra de mercadería', () => {
  const tenant = crypto.randomUUID();
  const user = crypto.randomUUID();
  const proveedor = crypto.randomUUID();
  const yerba = crypto.randomUUID();
  const azucar = crypto.randomUUID();

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

  const stockDe = async (id: string) => {
    const [p] = await db
      .select()
      .from(products)
      .where(and(eq(products.tenant_id, tenant), eq(products.id, id)))
      .limit(1);
    return p;
  };

  /** El stock según el LIBRO: suma los movimientos con su signo. */
  const stockSegunElLedger = async (id: string, inicial: string) => {
    const movs = await db
      .select()
      .from(stock_movements)
      .where(
        and(eq(stock_movements.tenant_id, tenant), eq(stock_movements.product_id, id))
      );
    return movs.reduce(
      (acc, m) => (m.direction === 'in' ? acc.plus(m.qty) : acc.minus(m.qty)),
      new Decimal(inicial)
    );
  };

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenant,
      name: 'T-COMPRAS-01 Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: user,
      email: `t-compras-01-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Quien compra',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenant,
      user_id: user,
      role: 'owner',
    });
    await db.insert(terceros).values({
      id: proveedor,
      tenant_id: tenant,
      type: 'proveedor',
      name: 'Distribuidora del Sur',
      doc: '30712345678',
    });
    const base = {
      tenant_id: tenant,
      unit_type: 'unidad' as const,
      price: '1000.0000',
      tax_rate: '21.00',
      stock_current: '0.0000',
      stock_tracking_enabled: true,
      is_active: true,
    };
    await db.insert(products).values([
      { ...base, id: yerba, name: 'Yerba 1kg', cost: null },
      { ...base, id: azucar, name: 'Azúcar 1kg', cost: null },
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
      await tx.delete(terceros).where(eq(terceros.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(eq(companies.id, tenant));
    });
  });

  it('🔴 comprar: entra al stock, deja el lote y fija el costo', async () => {
    // Comprobante con IVA discriminado: las líneas reconcilian contra el NETO.
    // 10 × 800 + 5 × 400 = 10.000 neto; IVA 2.100; total 12.100.
    const gasto = await conCtx(() =>
      registerExpense({
        fecha: '2026-03-10',
        categoria: 'mercaderia',
        neto: '10000',
        iva: '2100',
        total: '12100',
        tercero_id: proveedor,
        comprobante_tipo: 'A',
        comprobante_numero: '0001-00012345',
        en_iva_compras: true,
        medio_pago: 'transferencia',
        items: [
          { product_id: yerba, qty: '10', unit_cost: '800' },
          { product_id: azucar, qty: '5', unit_cost: '400' },
        ],
      })
    );

    // (1) El stock se movió
    expect((await stockDe(yerba))?.stock_current).toBe('10.0000');
    expect((await stockDe(azucar))?.stock_current).toBe('5.0000');

    // (2) Quedó el LOTE: cantidad, costo y a qué comprobante pertenece
    const lotes = await db
      .select()
      .from(expense_items)
      .where(eq(expense_items.expense_id, gasto.id));
    expect(lotes).toHaveLength(2);
    const loteYerba = lotes.find((l) => l.product_id === yerba);
    expect(loteYerba?.qty).toBe('10.0000');
    expect(loteYerba?.unit_cost).toBe('800.0000');
    expect(loteYerba?.product_name_snapshot).toBe('Yerba 1kg');

    // (3) El movimiento apunta al comprobante y suma
    const movs = await db
      .select()
      .from(stock_movements)
      .where(
        and(eq(stock_movements.tenant_id, tenant), eq(stock_movements.product_id, yerba))
      );
    expect(movs).toHaveLength(1);
    expect(movs[0]?.type).toBe('purchase');
    expect(movs[0]?.direction).toBe('in');
    expect(movs[0]?.related_expense_id).toBe(gasto.id);

    // (4) 🔴 El costo quedó NETO, no en bruto. Con el bruto (968 = 800×1,21)
    //     todos los márgenes de ahí en adelante quedarían subestimados con un
    //     número que parece perfectamente razonable.
    expect((await stockDe(yerba))?.cost).toBe('800.0000');
  });

  it('🔴 el stock reconstruido desde el ledger coincide con el guardado', async () => {
    // Se vende parte de lo comprado.
    await conCtx(() =>
      recordStockMovement({
        product_id: yerba,
        type: 'adjustment',
        direction: 'out',
        qty: '3',
        reason: 'venta simulada para el test',
      })
    );

    const guardado = new Decimal((await stockDe(yerba))!.stock_current);
    const segunLibro = await stockSegunElLedger(yerba, '0');

    // Esta es LA invariante del ítem 8: si el libro no puede reconstruir el
    // stock, no puede valorizar el inventario a una fecha pasada.
    expect(segunLibro.toFixed(4)).toBe(guardado.toFixed(4));
    expect(guardado.toFixed(4)).toBe('7.0000');
  });

  it('🔴 no se puede anular una compra cuya mercadería ya se vendió', async () => {
    // Quedan 7 de yerba y la compra fue de 10: sacar 10 dejaría el stock en
    // negativo, o sea cantidades negativas valorizadas al costo en el
    // inventario que va al estudio.
    const [gasto] = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.tenant_id, tenant), eq(expenses.categoria, 'mercaderia')))
      .limit(1);

    let error: unknown;
    try {
      await conCtx(() =>
        annulExpense({ expense_id: gasto!.id, motivo: 'intento sobre mercaderia vendida' })
      );
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ExpenseError);
    // El mensaje nombra el producto y los números: sin eso, el comerciante no
    // sabe cuál de las 2 líneas es el problema.
    expect((error as ExpenseError).message).toContain('Yerba 1kg');
    expect((error as ExpenseError).message).toContain('7.00');

    // Y no dejó nada a medias.
    expect((await stockDe(yerba))?.stock_current).toBe('7.0000');
    const anulaciones = await db
      .select()
      .from(expenses)
      .where(eq(expenses.corrects_id, gasto!.id));
    expect(anulaciones).toHaveLength(0);
  });

  it('anular una compra intacta devuelve la mercadería y deja el libro cuadrado', async () => {
    const gasto = await conCtx(() =>
      registerExpense({
        fecha: '2026-03-20',
        categoria: 'mercaderia',
        total: '6000',
        tercero_id: proveedor,
        medio_pago: 'transferencia',
        items: [{ product_id: azucar, qty: '10', unit_cost: '600' }],
      })
    );
    expect((await stockDe(azucar))?.stock_current).toBe('15.0000');

    await conCtx(() =>
      annulExpense({ expense_id: gasto.id, motivo: 'era de otro comercio' })
    );

    // Vuelve a lo que había antes...
    expect((await stockDe(azucar))?.stock_current).toBe('5.0000');
    // ...y el libro sigue reconstruyendo ese mismo número.
    expect((await stockSegunElLedger(azucar, '0')).toFixed(4)).toBe('5.0000');

    // La reversión NO se audita como ajuste manual: no la hizo el comerciante
    // a mano, es la contracara de una anulación.
    const auditados = await db
      .select()
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenant),
          eq(audit_log.event_name, 'stock.adjusted_manually')
        )
      );
    // El único ajuste manual del test es la "venta simulada" de yerba.
    expect(auditados).toHaveLength(1);
  });

  it('🔴 `cost` es el de la última COMPRA, no el de la última línea', async () => {
    const bizcochos = crypto.randomUUID();
    await db.insert(products).values({
      id: bizcochos,
      tenant_id: tenant,
      name: 'Bizcochos',
      unit_type: 'unidad',
      price: '500.0000',
      tax_rate: '21.00',
      stock_current: '0.0000',
      stock_tracking_enabled: true,
      is_active: true,
      cost: null,
    });

    // (a) Dos líneas del MISMO producto en un comprobante, a distinto costo:
    //     es el caso real de la bonificación por cantidad. Si ganara "la
    //     última línea insertada", el costo quedaría en 90.
    await conCtx(() =>
      registerExpense({
        fecha: '2026-04-10',
        categoria: 'mercaderia',
        total: '1900',
        medio_pago: 'transferencia',
        items: [
          { product_id: bizcochos, qty: '10', unit_cost: '100' },
          { product_id: bizcochos, qty: '10', unit_cost: '90' },
        ],
      })
    );
    // La compra MÁS RECIENTE es este comprobante; dentro de él, la última
    // línea. 90 es correcto acá — lo que se prueba abajo es que la fecha manda.
    expect((await stockDe(bizcochos))?.cost).toBe('90.0000');
    expect((await stockDe(bizcochos))?.stock_current).toBe('20.0000');

    // (b) Ahora se carga una factura VIEJA (marzo) después de la de abril.
    //     "Última compra" es por FECHA DEL COMPROBANTE, no por orden de carga:
    //     el costo NO tiene que moverse a 50.
    await conCtx(() =>
      registerExpense({
        fecha: '2026-03-01',
        categoria: 'mercaderia',
        total: '250',
        medio_pago: 'transferencia',
        items: [{ product_id: bizcochos, qty: '5', unit_cost: '50' }],
      })
    );
    expect((await stockDe(bizcochos))?.cost).toBe('90.0000');
    // El stock sí entra igual: la mercadería llegó, sin importar la fecha.
    expect((await stockDe(bizcochos))?.stock_current).toBe('25.0000');
  });

  it('🔴 anular la última compra devuelve el costo al de la compra anterior', async () => {
    const te = crypto.randomUUID();
    await db.insert(products).values({
      id: te,
      tenant_id: tenant,
      name: 'Té en saquitos',
      unit_type: 'unidad',
      price: '400.0000',
      tax_rate: '21.00',
      stock_current: '0.0000',
      stock_tracking_enabled: true,
      is_active: true,
      cost: null,
    });

    const vieja = await conCtx(() =>
      registerExpense({
        fecha: '2026-02-01',
        categoria: 'mercaderia',
        total: '1000',
        medio_pago: 'transferencia',
        items: [{ product_id: te, qty: '10', unit_cost: '100' }],
      })
    );
    const nueva = await conCtx(() =>
      registerExpense({
        fecha: '2026-05-01',
        categoria: 'mercaderia',
        total: '1300',
        medio_pago: 'transferencia',
        items: [{ product_id: te, qty: '10', unit_cost: '130' }],
      })
    );
    expect((await stockDe(te))?.cost).toBe('130.0000');

    // Se anula la de mayo: la última compra que queda es la de febrero.
    await conCtx(() =>
      annulExpense({ expense_id: nueva.id, motivo: 'la cargué dos veces' })
    );
    // Dejar 130 sería afirmar el costo de un comprobante anulado, y el margen
    // de cada venta siguiente se calcularía contra él sin que nada avise.
    expect((await stockDe(te))?.cost).toBe('100.0000');
    expect((await stockDe(te))?.stock_current).toBe('10.0000');

    // Y si se anula TAMBIÉN la única que quedaba, el costo pasa a NULL: la
    // única fuente de costo que el sistema tiene es una compra, y ya no hay.
    // NULL es "no sé", que Rentabilidad muestra como hueco; un número viejo
    // sería una afirmación desmentida.
    await conCtx(() =>
      annulExpense({ expense_id: vieja.id, motivo: 'era de otro comercio' })
    );
    expect((await stockDe(te))?.cost).toBeNull();
    expect((await stockDe(te))?.stock_current).toBe('0.0000');
  });

  it('🔴 el detalle se relee en el orden en que se cargó', async () => {
    const galletitas = crypto.randomUUID();
    const fideos = crypto.randomUUID();
    const aceite = crypto.randomUUID();
    const comun = {
      tenant_id: tenant,
      unit_type: 'unidad' as const,
      price: '900.0000',
      tax_rate: '21.00',
      stock_current: '0.0000',
      stock_tracking_enabled: true,
      is_active: true,
    };
    await db.insert(products).values([
      { ...comun, id: galletitas, name: 'Galletitas' },
      { ...comun, id: fideos, name: 'Fideos' },
      { ...comun, id: aceite, name: 'Aceite' },
    ]);

    const gasto = await conCtx(() =>
      registerExpense({
        fecha: '2026-06-01',
        categoria: 'mercaderia',
        total: '3000',
        medio_pago: 'transferencia',
        items: [
          { product_id: galletitas, qty: '10', unit_cost: '100' },
          { product_id: fideos, qty: '10', unit_cost: '100' },
          { product_id: aceite, qty: '10', unit_cost: '100' },
        ],
      })
    );

    // Las 3 filas se insertan en la MISMA transacción y comparten `created_at`
    // al milisegundo: sin `linea` (migration 0036) este orden sería azar, y una
    // factura de 8 renglones no se podría cotejar contra el papel.
    const detalle = await conCtx(() => getExpenseItems(gasto.id));
    expect(detalle.map((d) => d.linea)).toEqual([1, 2, 3]);
    expect(detalle.map((d) => d.product_name_snapshot)).toEqual([
      'Galletitas',
      'Fideos',
      'Aceite',
    ]);
  });

  it('el detalle tiene que cerrar contra el comprobante', async () => {
    await expect(
      conCtx(() =>
        registerExpense({
          fecha: '2026-03-25',
          categoria: 'mercaderia',
          total: '5000',
          medio_pago: 'transferencia',
          items: [{ product_id: yerba, qty: '2', unit_cost: '900' }], // 1.800 ≠ 5.000
        })
      )
    ).rejects.toThrow(ExpenseError);
  });

  it('sólo mercadería lleva detalle', async () => {
    await expect(
      conCtx(() =>
        registerExpense({
          fecha: '2026-03-25',
          categoria: 'servicios',
          total: '1600',
          medio_pago: 'transferencia',
          items: [{ product_id: yerba, qty: '2', unit_cost: '800' }],
        })
      )
    ).rejects.toThrow(ExpenseError);
  });

  it('las líneas de una compra no se pueden editar ni borrar', async () => {
    const [lote] = await db
      .select()
      .from(expense_items)
      .where(eq(expense_items.tenant_id, tenant))
      .limit(1);

    // Drizzle envuelve los errores de Postgres: el mensaje del trigger vive en
    // `cause`, no en el error de arriba. Un `toThrow()` pelado pasaría con
    // CUALQUIER error de SQL, incluido un typo en la query.
    const mensajeDe = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return null;
      } catch (e) {
        const causa = (e as { cause?: { message?: string } }).cause;
        return causa?.message ?? (e as Error).message;
      }
    };

    expect(
      await mensajeDe(() =>
        db.update(expense_items).set({ qty: '999.0000' }).where(eq(expense_items.id, lote!.id))
      )
    ).toContain('INSERT-only');

    expect(
      await mensajeDe(() => db.delete(expense_items).where(eq(expense_items.id, lote!.id)))
    ).toContain('INSERT-only');
  });
});
