/**
 * T-PROV-01 — cuenta corriente de PROVEEDORES (ítem 9 del pedido de la contadora).
 *
 * **Los casos que importan**, que son los que se rompen sin que nadie avise:
 *
 *  1. Una compra de mercadería a 30 días tiene que entrar al stock CON su lote.
 *     Si la deuda se registrara recién al pagar, el inventario valorizado al
 *     cierre (ítem 8, ya entregado) informaría "sin compra asociada" en toda
 *     compra a crédito — y en un comercio que compra a 30 días, eso es casi
 *     todo. Un ✅ degradado a su tercer estado en silencio.
 *
 *  2. El corte al cierre usa la fecha DEL HECHO, no la de la carga. Es la
 *     trampa que el ítem 5 (deudores) tuvo que declarar como caveat porque su
 *     libro no guarda la fecha de la operación: acá se guarda desde el día uno.
 *
 *  3. Un gasto impago NO es plata que salió: no puede aparecer en el total de
 *     gastos del período ni en el gráfico de ingresos vs gastos.
 *
 *  4. Anular un gasto que ya tiene plata aplicada está BLOQUEADO (fail-closed,
 *     decisión del owner), y anular uno que no la tiene hace desaparecer la
 *     deuda del saldo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { terceros } from '@/lib/db/schema/terceros';
import { supplier_account_movements } from '@/lib/db/schema/supplier_account';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  registerExpense,
  annulExpense,
  getExpenseSummary,
  ExpenseError,
} from '@/lib/services/expenses/expense.service';
import {
  getSupplierBalance,
  getBalancesBySupplier,
  settleSupplier,
  adjustSupplier,
  SupplierAccountError,
} from '@/lib/services/expenses/supplier-account.service';
import { getInventarioAlCierre } from '@/lib/services/reporting/inventario.report';
import {
  getAcreedoresAlCierre,
  armarCsvAcreedores,
} from '@/lib/services/reporting/cierre.report';
import { openCashSession } from '@/lib/cash/sessions';

describe('T-PROV-01 — cuenta corriente de proveedores', () => {
  let tenantId: string;
  let userId: string;
  let productId: string;
  let proveedorId: string;

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

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    productId = crypto.randomUUID();
    proveedorId = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-PROV-01 Co',
      legal_name: 'T-PROV-01 Co SRL',
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
      email: `t-prov-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Dueño T-PROV-01',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });
    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Producto T-PROV-01',
      unit_type: 'unidad',
      price: '100.0000',
      cost: '60.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: '0.0000',
      stock_minimum: '5.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });
    await db.insert(terceros).values({
      id: proveedorId,
      tenant_id: tenantId,
      type: 'proveedor',
      name: 'Distribuidora del Fin del Mundo',
      doc: '30712345678',
      is_active: true,
    });
  });

  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.execute(
        sql`DELETE FROM supplier_account_movements WHERE tenant_id = ${tenantId}`
      );
      await tx.execute(sql`DELETE FROM expense_items WHERE tenant_id = ${tenantId}`);
      await tx.execute(sql`DELETE FROM expenses WHERE tenant_id = ${tenantId}`);
      await tx.execute(sql`DELETE FROM stock_movements WHERE tenant_id = ${tenantId}`);
      await tx.execute(sql`DELETE FROM cash_movements WHERE cash_session_id IN
        (SELECT id FROM cash_sessions WHERE tenant_id = ${tenantId})`);
      await tx.execute(sql`DELETE FROM cash_sessions WHERE tenant_id = ${tenantId}`);
      await tx.execute(sql`DELETE FROM audit_log WHERE tenant_id = ${tenantId}`);
      await tx.execute(sql`DELETE FROM terceros WHERE tenant_id = ${tenantId}`);
      await tx.execute(sql`DELETE FROM products WHERE tenant_id = ${tenantId}`);
      await tx.execute(sql`DELETE FROM company_users WHERE company_id = ${tenantId}`);
      await tx.execute(sql`DELETE FROM users WHERE id = ${userId}`);
      await tx.execute(sql`DELETE FROM companies WHERE id = ${tenantId}`);
    });
  });

  /**
   * Compra de mercadería a cuenta corriente.
   *
   * El detalle tiene que cerrar contra el comprobante (lo valida
   * `registerExpense`), así que las unidades salen del total: 10 unidades al
   * costo que corresponda. Fijar el detalle y mover sólo el total dejaba el
   * helper mintiendo — y el error lo dio el servicio, no el test.
   */
  const compraACredito = (fecha: string, total = '500.0000') =>
    withCtx(() =>
      registerExpense({
        fecha,
        categoria: 'mercaderia',
        total,
        medio_pago: 'cuenta_corriente',
        tercero_id: proveedorId,
        comprobante_tipo: 'FA',
        comprobante_numero: `A-0001-${Math.floor(Math.random() * 100000)}`,
        items: [
          {
            product_id: productId,
            qty: '10.0000',
            unit_cost: (Number(total) / 10).toFixed(4),
          },
        ],
      })
    );

  /** El mensaje del trigger viaja en `cause`, no en el error que envuelve. */
  const causa = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return String((e as { cause?: unknown }).cause ?? e);
    }
  };

  it('la compra a crédito genera la deuda y entra al stock CON su lote', async () => {
    const gasto = await compraACredito('2026-07-15');

    const saldo = await withCtx(() => getSupplierBalance(proveedorId));
    expect(saldo.toFixed(2)).toBe('500.00');

    // El lote existe: es lo que el ítem 8 necesita. Si la deuda se registrara
    // recién al pagar, acá no habría nada.
    const inv = await withCtx(() => getInventarioAlCierre('2026-07-31'));
    const linea = inv.filas.find((f) => f.name === 'Producto T-PROV-01');
    expect(linea).toBeDefined();
    // Las 10 unidades están respaldadas por el comprobante de compra. Si la
    // deuda naciera recién al pagar, no habría lote y estas unidades caerían
    // en `sin_compra_qty` — el tercer estado del ítem 8.
    expect(Number(linea!.con_compra_qty)).toBe(10);
    expect(Number(linea!.sin_compra_qty)).toBe(0);
    expect(Number(linea!.con_compra_total)).toBe(500);

    // Y el cargo quedó atado al gasto, no suelto.
    const [mov] = await db.execute<{ expense_id: string; fecha: string }>(
      sql`SELECT expense_id::text, fecha::text FROM supplier_account_movements
          WHERE tenant_id = ${tenantId} AND type = 'charge'`
    );
    expect(mov?.expense_id).toBe(gasto.id);
    expect(mov?.fecha).toBe('2026-07-15');
  });

  it('el corte al cierre usa la fecha del HECHO, no la de la carga', async () => {
    // Compra del 30/07 — dentro del ejercicio que cierra el 31/07. Se carga
    // hoy (septiembre), que es como pasa en la vida real.
    await compraACredito('2026-07-30', '800.0000');
    // Y una del 02/08, que YA es del ejercicio siguiente.
    await compraACredito('2026-08-02', '300.0000');

    const alCierre = await withCtx(() => getSupplierBalance(proveedorId, '2026-07-31'));
    const hoy = await withCtx(() => getSupplierBalance(proveedorId));

    // Si el corte usara `created_at` (ambas cargadas hoy), daría 1100 en las
    // dos. Ese es exactamente el caveat que el ítem 5 tuvo que declarar.
    expect(alCierre.toFixed(2)).toBe('800.00');
    expect(hoy.toFixed(2)).toBe('1100.00');
  });

  it('un gasto impago NO cuenta como plata que salió', async () => {
    await compraACredito('2026-07-15', '500.0000');
    await withCtx(() =>
      registerExpense({
        fecha: '2026-07-16',
        categoria: 'servicios',
        total: '200.0000',
        medio_pago: 'transferencia',
      })
    );

    const resumen = await withCtx(() => getExpenseSummary('2026-07-01', '2026-08-01'));

    // El número grande es lo que salió: sólo la transferencia.
    expect(resumen.total).toBe('200.0000');
    expect(resumen.cantidad).toBe('1');
    // Y lo comprometido se ve, aparte y con su nombre.
    expect(resumen.impago_total).toBe('500.0000');
    expect(resumen.impago_cantidad).toBe('1');
  });

  it('el pago en efectivo sale de la caja; la transferencia no', async () => {
    await compraACredito('2026-07-15', '500.0000');
    const sesion = await withCtx(() =>
      openCashSession({ sale_point: 1, initial_amount: '10000.0000' })
    );

    await withCtx(() =>
      settleSupplier({
        tercero_id: proveedorId,
        amount: '300.0000',
        method: 'efectivo',
        fecha: '2026-07-20',
        cash_session_id: sesion.id,
      })
    );
    await withCtx(() =>
      settleSupplier({
        tercero_id: proveedorId,
        amount: '100.0000',
        method: 'transferencia',
        fecha: '2026-07-21',
      })
    );

    const saldo = await withCtx(() => getSupplierBalance(proveedorId));
    expect(saldo.toFixed(2)).toBe('100.00');

    // UN solo movimiento de caja: el de efectivo. Si la transferencia también
    // tocara el cajón, el arqueo descontaría plata que nunca estuvo ahí.
    const movs = await db.execute<{ type: string; amount: string }>(
      sql`SELECT type, amount::text FROM cash_movements
          WHERE cash_session_id = ${sesion.id}`
    );
    expect(movs).toHaveLength(1);
    expect(movs[0]?.type).toBe('provider_payment');
    expect(Number(movs[0]?.amount)).toBe(300);
  });

  it('pagar en efectivo sin caja abierta falla, y no deja el libro a medias', async () => {
    await compraACredito('2026-07-15', '500.0000');

    await expect(
      withCtx(() =>
        settleSupplier({
          tercero_id: proveedorId,
          amount: '300.0000',
          method: 'efectivo',
          fecha: '2026-07-20',
        })
      )
    ).rejects.toBeInstanceOf(SupplierAccountError);

    const saldo = await withCtx(() => getSupplierBalance(proveedorId));
    expect(saldo.toFixed(2)).toBe('500.00');
  });

  it('no se le paga a quien no se le debe', async () => {
    await expect(
      withCtx(() =>
        settleSupplier({
          tercero_id: proveedorId,
          amount: '100.0000',
          method: 'transferencia',
          fecha: '2026-07-20',
        })
      )
    ).rejects.toThrow(/no se le debe nada/i);
  });

  it('anular un gasto que ya tiene pagos está BLOQUEADO', async () => {
    const gasto = await compraACredito('2026-07-15', '500.0000');
    await withCtx(() =>
      settleSupplier({
        tercero_id: proveedorId,
        amount: '200.0000',
        method: 'transferencia',
        fecha: '2026-07-20',
      })
    );

    // Fail-closed: primero se revierte la plata, después se anula. Dejar anular
    // arrastrando los pagos deja movimientos apuntando a un comprobante que ya
    // no cuenta.
    await expect(
      withCtx(() =>
        annulExpense({ expense_id: gasto.id, motivo: 'cargado por duplicado' })
      )
    ).rejects.toThrow(/ya hubo pagos/i);

    const saldo = await withCtx(() => getSupplierBalance(proveedorId));
    expect(saldo.toFixed(2)).toBe('300.00');
  });

  it('anular un gasto SIN pagos hace desaparecer la deuda', async () => {
    const gasto = await compraACredito('2026-07-15', '500.0000');
    expect((await withCtx(() => getSupplierBalance(proveedorId))).toFixed(2)).toBe(
      '500.00'
    );

    await withCtx(() =>
      annulExpense({ expense_id: gasto.id, motivo: 'la factura era de otro comercio' })
    );

    // El libro es append-only: el cargo SIGUE ahí. Lo que cambia es que deja de
    // contar, porque su comprobante dejó de estar vigente.
    const filas = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM supplier_account_movements
          WHERE tenant_id = ${tenantId} AND type = 'charge'`
    );
    expect(filas[0]?.n).toBe('1');

    const saldo = await withCtx(() => getSupplierBalance(proveedorId));
    expect(saldo.toFixed(2)).toBe('0.00');
  });

  it('un gasto a cuenta corriente sin proveedor elegido se rechaza', async () => {
    await expect(
      withCtx(() =>
        registerExpense({
          fecha: '2026-07-15',
          categoria: 'servicios',
          total: '500.0000',
          medio_pago: 'cuenta_corriente',
          payee_name: 'Un nombre escrito a mano',
        })
      )
    ).rejects.toBeInstanceOf(ExpenseError);
  });

  it('el ajuste suma a lo que debemos y queda auditado', async () => {
    await compraACredito('2026-07-15', '500.0000');
    await withCtx(() =>
      adjustSupplier({
        tercero_id: proveedorId,
        amount: '50.0000',
        fecha: '2026-07-25',
        reason: 'interés por pago fuera de término',
      })
    );

    const saldo = await withCtx(() => getSupplierBalance(proveedorId));
    expect(saldo.toFixed(2)).toBe('550.00');

    const eventos = await db.execute<{ event_name: string }>(
      sql`SELECT event_name FROM audit_log WHERE tenant_id = ${tenantId}
          AND event_name LIKE 'supplier.%'`
    );
    expect(eventos.map((e) => e.event_name)).toContain('supplier.account.adjusted');
  });

  it('un ajuste sin motivo no se puede registrar', async () => {
    await compraACredito('2026-07-15', '500.0000');
    await expect(
      withCtx(() =>
        adjustSupplier({
          tercero_id: proveedorId,
          amount: '50.0000',
          fecha: '2026-07-25',
          reason: 'x',
        })
      )
    ).rejects.toThrow(/motivo/i);
  });

  it('el libro es append-only: no se puede editar ni borrar', async () => {
    await compraACredito('2026-07-15', '500.0000');
    expect(
      await causa(() =>
        db.execute(
          sql`UPDATE supplier_account_movements SET amount = '1.0000'
              WHERE tenant_id = ${tenantId}`
        )
      )
    ).toMatch(/INSERT-only/);
    expect(
      await causa(() =>
        db.execute(
          sql`DELETE FROM supplier_account_movements WHERE tenant_id = ${tenantId}`
        )
      )
    ).toMatch(/INSERT-only/);
  });

  it('el reporte de acreedores al cierre trae razón social, CUIT e importe', async () => {
    // Exactamente lo que pide el ítem 9.
    await compraACredito('2026-07-20', '500.0000');
    await withCtx(() =>
      settleSupplier({
        tercero_id: proveedorId,
        amount: '200.0000',
        method: 'transferencia',
        fecha: '2026-07-25',
      })
    );

    const filas = await withCtx(() => getAcreedoresAlCierre('2026-07-31'));
    expect(filas).toHaveLength(1);
    expect(filas[0]?.nombre).toBe('Distribuidora del Fin del Mundo');
    expect(filas[0]?.doc).toBe('30712345678');
    expect(Number(filas[0]?.saldo)).toBe(300);

    const csv = armarCsvAcreedores('2026-07-31', filas);
    expect(csv).toContain('Proveedor');
    expect(csv).toContain('30712345678');
    // La nota dice qué NO incluye: un total suelto no puede comunicar eso.
    expect(csv).toMatch(/NO incluye deudas que no se hayan cargado/i);
    expect(csv).toMatch(/Todos los proveedores tienen CUIT/i);
  });

  it('un proveedor al que se le pagó de más NO figura como acreedor', async () => {
    await compraACredito('2026-07-20', '500.0000');
    await withCtx(() =>
      settleSupplier({
        tercero_id: proveedorId,
        amount: '700.0000',
        method: 'transferencia',
        fecha: '2026-07-25',
      })
    );

    // Saldo −200: es un anticipo, un crédito NUESTRO. Si figurara, restaría
    // del total de deuda como si fuera menos pasivo.
    const saldo = await withCtx(() => getSupplierBalance(proveedorId));
    expect(saldo.toFixed(2)).toBe('-200.00');
    const filas = await withCtx(() => getAcreedoresAlCierre('2026-07-31'));
    expect(filas).toHaveLength(0);
  });

  it('el gasto anulado desaparece del reporte de acreedores', async () => {
    const gasto = await compraACredito('2026-07-20', '500.0000');
    expect(await withCtx(() => getAcreedoresAlCierre('2026-07-31'))).toHaveLength(1);

    await withCtx(() =>
      annulExpense({ expense_id: gasto.id, motivo: 'la factura era de otro comercio' })
    );

    expect(await withCtx(() => getAcreedoresAlCierre('2026-07-31'))).toHaveLength(0);
  });

  it('los saldos de todos los proveedores salen en UNA consulta', async () => {
    const otroId = crypto.randomUUID();
    await db.insert(terceros).values({
      id: otroId,
      tenant_id: tenantId,
      type: 'proveedor',
      name: 'Otro proveedor',
      doc: '30798765432',
      is_active: true,
    });

    await compraACredito('2026-07-15', '500.0000');
    await withCtx(() =>
      registerExpense({
        fecha: '2026-07-16',
        categoria: 'mercaderia',
        total: '250.0000',
        medio_pago: 'cuenta_corriente',
        tercero_id: otroId,
        comprobante_numero: 'A-0002-00099',
      })
    );

    const saldos = await withCtx(() => getBalancesBySupplier('2026-07-31'));
    expect(saldos.get(proveedorId)?.toFixed(2)).toBe('500.00');
    expect(saldos.get(otroId)?.toFixed(2)).toBe('250.00');

    await db.execute(sql`DELETE FROM terceros WHERE id = ${otroId}`).catch(() => {});
  });
});
