/**
 * T-GASTO-01 — registro de gastos.
 *
 * El módulo nace del pedido real de una contadora, y estos números terminan en
 * una DDJJ. Lo que se protege acá:
 *
 *   1. que el gasto en efectivo salga de la caja UNA vez (ni cero ni dos)
 *   2. que el IVA crédito cuente SÓLO los gastos con comprobante fiscal — un
 *      gasto sin factura no da crédito por más IVA que tenga adentro el precio,
 *      y computarlo sería declarar un crédito que no existe
 *   3. que neto + IVA cierre contra el total
 *   4. que se pueda separar lo que el estudio YA baja de ARCA de lo que el
 *      comercio tiene que mandar
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { terceros } from '@/lib/db/schema/terceros';
import { expenses } from '@/lib/db/schema/expenses';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import {
  ExpenseError,
  getExpenseTotals,
  getIvaCredito,
  listExpenses,
  registerExpense,
} from '@/lib/services/expenses/expense.service';
import { closeCashSession, openCashSession } from '@/lib/cash/sessions';

// El día del COMERCIO, el mismo reloj que el guard `fecha_futura`: con el de
// UTC, entre las 21 y la medianoche HOY sería "mañana" para el service.
const HOY = diaDelComercio();
const DESDE = HOY.slice(0, 8) + '01';
const HASTA = (() => {
  const d = new Date(HOY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
})();

describe('T-GASTO-01 — registro de gastos', () => {
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
      name: `T-GASTO Co ${n}`,
      legal_name: `T-GASTO Co ${n} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
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
      email: `t-gasto-${userId.slice(0, 8)}@test.local`,
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
      await tx.delete(expenses).where(inArray(expenses.tenant_id, ids));
      for (const t of ids) {
        await tx.execute(
          sql`DELETE FROM cash_movements WHERE cash_session_id IN (
                SELECT id FROM cash_sessions WHERE tenant_id = ${t})`
        );
      }
      await tx.delete(cash_sessions).where(inArray(cash_sessions.tenant_id, ids));
      await tx.delete(terceros).where(inArray(terceros.tenant_id, ids));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, ids));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  const abrirCaja = () =>
    withCtx(() => openCashSession({ sale_point: 1, initial_amount: '20000.00' }));

  it('EN EFECTIVO: sale de la caja, una sola vez', async () => {
    const sesion = await abrirCaja();
    await withCtx(() =>
      registerExpense({
        fecha: HOY,
        categoria: 'servicios',
        total: '5000.00',
        medio_pago: 'efectivo',
        cash_session_id: sesion.id,
        descripcion: 'Luz',
      })
    );

    const movs = await db
      .select()
      .from(cash_movements)
      .where(eq(cash_movements.cash_session_id, sesion.id));
    expect(movs.length).toBe(1);
    expect(movs[0]?.type).toBe('provider_payment');
    expect(Number(movs[0]?.amount)).toBe(5000);

    // Y el arqueo lo descuenta: el cajero cuenta inicial − gasto.
    const cierre = await withCtx(() =>
      closeCashSession({ session_id: sesion.id, counted_amount: '15000.00' })
    );
    expect(Number(cierre.descuadre)).toBe(0);
  });

  it('POR TRANSFERENCIA: NO toca la caja', async () => {
    // Si todo egreso saliera del cajón, el arqueo descontaría plata que nunca
    // estuvo ahí.
    const sesion = await abrirCaja();
    await withCtx(() =>
      registerExpense({
        fecha: HOY,
        categoria: 'alquiler',
        total: '150000.00',
        medio_pago: 'transferencia',
      })
    );

    const movs = await db
      .select()
      .from(cash_movements)
      .where(eq(cash_movements.cash_session_id, sesion.id));
    expect(movs.length).toBe(0);

    const cierre = await withCtx(() =>
      closeCashSession({ session_id: sesion.id, counted_amount: '20000.00' })
    );
    expect(Number(cierre.descuadre)).toBe(0);
  });

  it('un gasto en efectivo SIN caja abierta no se registra', async () => {
    await expect(
      withCtx(() =>
        registerExpense({
          fecha: HOY,
          categoria: 'otros',
          total: '100.00',
          medio_pago: 'efectivo',
        })
      )
    ).rejects.toThrow(/caja/i);
    // Y no queda a medias.
    expect((await withCtx(() => listExpenses(DESDE, HASTA))).length).toBe(0);
  });

  it('el IVA crédito cuenta SOLO los gastos con comprobante fiscal', async () => {
    // El que no está en IVA compras no da crédito, por más IVA que tenga
    // adentro el precio. Computarlo sería declarar un crédito inexistente.
    await withCtx(() =>
      registerExpense({
        fecha: HOY,
        categoria: 'mercaderia',
        neto: '10000.00',
        iva: '2100.00',
        total: '12100.00',
        medio_pago: 'transferencia',
        en_iva_compras: true,
        comprobante_numero: 'A-0001-00000123',
      })
    );
    await withCtx(() =>
      registerExpense({
        fecha: HOY,
        categoria: 'otros',
        neto: '1000.00',
        iva: '210.00',
        total: '1210.00',
        medio_pago: 'transferencia',
        en_iva_compras: false,
      })
    );

    const { credito, comprobantes } = await withCtx(() =>
      getIvaCredito(DESDE, HASTA)
    );
    expect(Number(credito)).toBe(2100);
    expect(comprobantes).toBe(1);
  });

  it('un gasto que dice estar en IVA compras necesita comprobante', async () => {
    await expect(
      withCtx(() =>
        registerExpense({
          fecha: HOY,
          categoria: 'mercaderia',
          total: '100.00',
          medio_pago: 'transferencia',
          en_iva_compras: true,
        })
      )
    ).rejects.toThrow(/comprobante/i);
  });

  it('neto + IVA tiene que dar el total', async () => {
    // Un tipeo acá pone en la DDJJ un crédito que no coincide con el papel.
    await expect(
      withCtx(() =>
        registerExpense({
          fecha: HOY,
          categoria: 'seguros',
          neto: '1000.00',
          iva: '210.00',
          total: '9999.00',
          medio_pago: 'transferencia',
        })
      )
    ).rejects.toThrow(/no da el total/i);
  });

  it('se puede pedir SOLO lo que el estudio no baja de ARCA', async () => {
    // Es el punto del módulo: separar lo que la contadora ya tiene de lo que el
    // comercio le tiene que mandar.
    await withCtx(() =>
      registerExpense({
        fecha: HOY,
        categoria: 'mercaderia',
        total: '50000.00',
        medio_pago: 'transferencia',
        en_iva_compras: true,
        comprobante_numero: 'A-0001-00000999',
      })
    );
    await withCtx(() =>
      registerExpense({
        fecha: HOY,
        categoria: 'servicios',
        total: '3000.00',
        medio_pago: 'transferencia',
      })
    );

    const todos = await withCtx(() => getExpenseTotals(DESDE, HASTA));
    expect(todos.length).toBe(2);

    const fueraDeArca = await withCtx(() => getExpenseTotals(DESDE, HASTA, true));
    expect(fueraDeArca.length).toBe(1);
    expect(fueraDeArca[0]?.categoria).toBe('servicios');
  });

  it('copia el nombre del proveedor como SNAPSHOT', async () => {
    // Si mañana se renombra o se da de baja, el gasto sigue diciendo a quién se
    // le pagó.
    const [prov] = await db
      .insert(terceros)
      .values({
        tenant_id: tenantId,
        type: 'proveedor',
        name: 'Distribuidora Austral',
        doc: '30712345678',
      })
      .returning({ id: terceros.id });

    const g = await withCtx(() =>
      registerExpense({
        fecha: HOY,
        categoria: 'mercaderia',
        total: '8000.00',
        medio_pago: 'transferencia',
        tercero_id: prov!.id,
      })
    );
    expect(g.payee_name).toBe('Distribuidora Austral');
    expect(g.payee_doc).toBe('30712345678');
  });

  it('NO acepta un proveedor de otro comercio', async () => {
    const [ajeno] = await db
      .insert(terceros)
      .values({ tenant_id: otroTenant, type: 'proveedor', name: 'Ajeno' })
      .returning({ id: terceros.id });

    await expect(
      withCtx(() =>
        registerExpense({
          fecha: HOY,
          categoria: 'mercaderia',
          total: '100.00',
          medio_pago: 'transferencia',
          tercero_id: ajeno!.id,
        })
      )
    ).rejects.toThrow(ExpenseError);
  });

  it('NO ve los gastos de otro comercio', async () => {
    await withCtx(
      () =>
        registerExpense({
          fecha: HOY,
          categoria: 'otros',
          total: '777.00',
          medio_pago: 'transferencia',
        }),
      otroTenant
    );
    expect((await withCtx(() => listExpenses(DESDE, HASTA))).length).toBe(0);
  });

  it('es append-only: no se puede editar ni borrar', async () => {
    // Un gasto editable después de que la contadora lo uso para una DDJJ es un
    // problema, no una comodidad.
    const g = await withCtx(() =>
      registerExpense({
        fecha: HOY,
        categoria: 'otros',
        total: '500.00',
        medio_pago: 'transferencia',
      })
    );

    // El mensaje del trigger viaja en `.cause`: drizzle envuelve el error con
    // un "Failed query: ..." que no lo menciona. Mismo patrón que T-AUDIT-01.
    const mensajeDe = async (p: Promise<unknown>) => {
      try {
        await p;
        return 'NO FALLO';
      } catch (e) {
        const err = e as { message?: string; cause?: { message?: string } };
        return err.cause?.message ?? err.message ?? String(e);
      }
    };

    expect(
      await mensajeDe(
        db.update(expenses).set({ total: '1.00' }).where(eq(expenses.id, g.id))
      )
    ).toMatch(/INSERT-only/i);
    expect(
      await mensajeDe(db.delete(expenses).where(eq(expenses.id, g.id)))
    ).toMatch(/INSERT-only/i);

    // Y el gasto sigue igual: que el trigger avise no alcanza si igual cambió.
    const [releido] = await db.select().from(expenses).where(eq(expenses.id, g.id));
    expect(Number(releido?.total)).toBe(500);
  });
});
