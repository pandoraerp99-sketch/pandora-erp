/**
 * T-GASTOS-03 — las Server Actions de /gastos hacen lo que la pantalla promete.
 *
 * Slice 3 de `RESEARCH-BRIEF-gastos-detalle-y-anulacion.md`. El service ya está
 * probado en T-COMPRAS-01 y T-GASTOS-02; lo que se prueba acá es **el camino
 * que recorre la pantalla**: sesión → bridge de tracing → action → service.
 *
 * Tres cosas que sólo se rompen en ese tramo:
 *
 *  1. La caja la resuelve el SERVIDOR al anular. Si el navegador eligiera a qué
 *     sesión devolver la plata, podría mandarla a un arqueo ya cerrado.
 *  2. El mensaje de bloqueo por mercadería vendida llega TEXTUAL. Nombra el
 *     producto y sus números, y eso es lo que le dice al comerciante qué hacer:
 *     traducirlo a "no se pudo anular" tira justo la parte útil.
 *  3. Anular saca al gasto de la lista y lo pone en la de anulados. Si sólo lo
 *     sacara, se vería como si se hubiera borrado.
 *
 * Mismo mockeo mínimo que T-POS-ACTION-01: sólo el borde de Next y la sesión.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { expenses } from '@/lib/db/schema/expenses';
import { expense_items } from '@/lib/db/schema/expense_items';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { audit_log } from '@/lib/db/schema/audit';

const tenant = crypto.randomUUID();
const user = crypto.randomUUID();

const mocks = vi.hoisted(() => ({
  session: null as null | {
    user_id: string;
    email: string;
    active_company_id: string | null;
    available_company_ids: string[];
    app_role: string | null;
    is_support: boolean;
    access_token: string;
    expires_at: number;
  },
}));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Map([
      ['x-correlation-id', crypto.randomUUID()],
      ['x-request-id', crypto.randomUUID()],
    ]),
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: async () => mocks.session,
}));

import {
  anularGastoAction,
  getDetalleAction,
  registrarGastoAction,
} from '@/app/gastos/actions';
import {
  listAnnulledExpenses,
  listExpenses,
} from '@/lib/services/expenses/expense.service';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import { sumarDias } from '@/lib/calendar/fechas';

/** Para las lecturas de verificación, que son del service y no de la action. */
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

describe('T-GASTOS-03 — actions de gastos', () => {
  const yerba = crypto.randomUUID();
  const azucar = crypto.randomUUID();

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenant,
      name: 'T-GASTOS-03 Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: user,
      email: `t-gastos-03-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Quien carga',
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

    mocks.session = {
      user_id: user,
      email: `t-gastos-03-${tenant.slice(0, 8)}@test.local`,
      active_company_id: tenant,
      available_company_ids: [tenant],
      app_role: 'owner',
      is_support: false,
      access_token: 'test',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenant));
      await tx.delete(expense_items).where(eq(expense_items.tenant_id, tenant));
      await tx.delete(expenses).where(eq(expenses.tenant_id, tenant));
      await tx.delete(cash_movements).where(
        sql`cash_session_id IN (SELECT id FROM cash_sessions WHERE tenant_id = ${tenant})`
      );
      await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tenant));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenant));
      await tx.delete(products).where(eq(products.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(eq(companies.id, tenant));
    });
  });

  it('🔴 cargar una compra con detalle desde la pantalla mueve el stock', async () => {
    const res = await registrarGastoAction({
      fecha: '2026-03-10',
      categoria: 'mercaderia',
      total: '12100',
      neto: '10000',
      iva: '2100',
      comprobante_tipo: 'Factura',
      comprobante_numero: '0001-00099001',
      en_iva_compras: true,
      medio_pago: 'transferencia',
      items: [
        { product_id: yerba, qty: '10', unit_cost: '800' },
        { product_id: azucar, qty: '5', unit_cost: '400' },
      ],
    });
    expect(res.ok).toBe(true);

    const [p] = await db
      .select()
      .from(products)
      .where(and(eq(products.tenant_id, tenant), eq(products.id, yerba)))
      .limit(1);
    expect(p?.stock_current).toBe('10.0000');
    // Neto, no bruto: el IVA discriminado se recupera.
    expect(p?.cost).toBe('800.0000');
  });

  it('el detalle se lee desde la pantalla, en el orden en que se cargó', async () => {
    const [gasto] = await conCtx(() => listExpenses('2026-03-01', '2026-04-01'));
    const res = await getDetalleAction(gasto!.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.map((l) => l.linea)).toEqual([1, 2]);
    expect(res.data[0]?.product_name).toBe('Yerba 1kg');
    expect(res.data[0]?.unit_cost).toBe('800.0000');
  });

  it('🔴 el bloqueo por mercadería ya vendida llega TEXTUAL a la pantalla', async () => {
    // Se vende parte de lo comprado.
    await db
      .update(products)
      .set({ stock_current: '7.0000' })
      .where(and(eq(products.tenant_id, tenant), eq(products.id, yerba)));

    const [gasto] = await conCtx(() => listExpenses('2026-03-01', '2026-04-01'));
    const res = await anularGastoAction(gasto!.id, 'me equivoqué de proveedor');

    expect(res.ok).toBe(false);
    if (res.ok) return;
    // El mensaje nombra el producto y los números. Sin eso, el comerciante no
    // sabe cuál de las dos líneas es el problema ni qué hacer.
    expect(res.error).toContain('Yerba 1kg');
    expect(res.error).toContain('7.00');

    // Y no dejó nada a medias.
    const vigentes = await conCtx(() => listExpenses('2026-03-01', '2026-04-01'));
    expect(vigentes).toHaveLength(1);
  });

  it('🔴 un gasto en efectivo no se puede anular sin caja abierta, y lo dice', async () => {
    // No hay ninguna caja abierta en este tenant: registrar en efectivo ya
    // falla, así que el gasto se crea con el movimiento de caja a mano para
    // poder probar el camino de la anulación.
    const sesionCerrada = crypto.randomUUID();
    await db.insert(cash_sessions).values({
      id: sesionCerrada,
      tenant_id: tenant,
      sale_point: 1,
      initial_amount: '1000.0000',
      opened_by: user,
      // Cerrada de verdad: el CHECK `cash_sessions_closed_consistency` exige
      // que si hay `closed_at` estén también quién cerró y con cuánto. Una
      // sesión "medio cerrada" no existe.
      closed_at: new Date(),
      closed_by: user,
      final_amount: '1000.0000',
      expected_amount: '1000.0000',
      descuadre: '0.0000',
    });
    const [mov] = await db
      .insert(cash_movements)
      .values({
        cash_session_id: sesionCerrada,
        type: 'provider_payment',
        amount: '5000.0000',
        reason: 'gasto viejo',
        created_by: user,
      })
      .returning();
    const [gasto] = await db
      .insert(expenses)
      .values({
        tenant_id: tenant,
        fecha: '2026-03-11',
        categoria: 'servicios',
        total: '5000.0000',
        medio_pago: 'efectivo',
        cash_movement_id: mov!.id,
        created_by: user,
      })
      .returning();

    const res = await anularGastoAction(gasto!.id, 'estaba mal el importe');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Explica QUÉ hacer, no sólo que no se pudo.
    expect(res.error).toContain('caja');
  });

  it('🔴 anular saca el gasto de la lista y lo deja en la de anulados', async () => {
    const gasto = await conCtx(async () => {
      const [g] = await db
        .insert(expenses)
        .values({
          tenant_id: tenant,
          fecha: '2026-03-12',
          categoria: 'servicios',
          total: '3000.0000',
          payee_name: 'Internet del Sur',
          medio_pago: 'transferencia',
          created_by: user,
        })
        .returning();
      return g!;
    });

    const antes = await conCtx(() => listExpenses('2026-03-01', '2026-04-01'));
    const res = await anularGastoAction(gasto.id, 'lo cargué dos veces');
    expect(res.ok).toBe(true);

    const despues = await conCtx(() => listExpenses('2026-03-01', '2026-04-01'));
    // Desaparece de la lista: el original deja de estar vigente y la fila de
    // anulación vale 0.
    expect(despues).toHaveLength(antes.length - 1);
    expect(despues.some((g) => g.id === gasto.id)).toBe(false);

    // Pero NO se borró: está en la pestaña de anulados, con su motivo.
    //
    // Se busca en el rango de HOY y no en el del gasto: la pestaña lista por
    // cuándo se anuló. Ver el test de abajo, que es el que prueba por qué.
    // El día del COMERCIO: con el de UTC, este test fallaba entre las 21 y la
    // medianoche de Ushuaia (la pestaña corta por el día local).
    const hoy = diaDelComercio();
    const manana = sumarDias(hoy, 1);
    const anulados = await conCtx(() => listAnnulledExpenses(hoy, manana));
    const suyo = anulados.find((a) => a.id === gasto.id);
    expect(suyo).toBeDefined();
    expect(suyo?.motivo).toBe('lo cargué dos veces');
    // El importe se muestra tachado, no en cero: esconderlo taparía de cuánto
    // era el comprobante dado de baja.
    expect(suyo?.total).toBe('3000.0000');
  });

  it('🔴 anular un gasto VIEJO lo muestra en el período en que se anuló', async () => {
    // El caso real: en septiembre aparece una factura de marzo cargada de más.
    const [viejo] = await db
      .insert(expenses)
      .values({
        tenant_id: tenant,
        fecha: '2026-03-02',
        categoria: 'servicios',
        total: '4500.0000',
        payee_name: 'Seguro viejo',
        medio_pago: 'transferencia',
        created_by: user,
      })
      .returning();

    const res = await anularGastoAction(viejo!.id, 'duplicado del de marzo');
    expect(res.ok).toBe(true);

    // El día del COMERCIO: con el de UTC, este test fallaba entre las 21 y la
    // medianoche de Ushuaia (la pestaña corta por el día local).
    const hoy = diaDelComercio();
    const manana = sumarDias(hoy, 1);

    // La anulación PASÓ HOY, así que se ve hoy. Con el filtro por la fecha del
    // comprobante, la pantalla saltaba a la pestaña de anulados y mostraba
    // "no anulaste ningún gasto" un segundo después de anular uno.
    const deHoy = await conCtx(() => listAnnulledExpenses(hoy, manana));
    expect(deHoy.some((a) => a.id === viejo!.id)).toBe(true);

    // Y NO aparece en marzo, que es cuando fue el gasto: la plata sigue siendo
    // de marzo (los totales no se movieron), pero la anulación no es de marzo.
    const deMarzo = await conCtx(() => listAnnulledExpenses('2026-03-01', '2026-03-15'));
    expect(deMarzo.some((a) => a.id === viejo!.id)).toBe(false);

    // Lo que sí tiene que seguir pasando: el gasto salió de las lecturas que
    // suman, en SU período. Anular no le cambia el período a la plata.
    const vigentesMarzo = await conCtx(() => listExpenses('2026-03-01', '2026-03-15'));
    expect(vigentesMarzo.some((g) => g.id === viejo!.id)).toBe(false);
  });

  it('🔴 una anulación del último día del mes a las 22:30 es de ESE mes, no del siguiente', async () => {
    const [gasto] = await db
      .insert(expenses)
      .values({
        tenant_id: tenant,
        fecha: '2026-03-03',
        categoria: 'servicios',
        total: '1200.0000',
        payee_name: 'Anulado a la noche',
        medio_pago: 'transferencia',
        created_by: user,
      })
      .returning();
    const res = await anularGastoAction(gasto!.id, 'de noche');
    expect(res.ok).toBe(true);

    // 01:30 UTC del día 1 de este mes = 22:30 del último día del mes pasado en
    // Ushuaia. La tabla es append-only: se mueve el instante saltando el
    // trigger, sólo para poner la anulación en el borde.
    const [y, m] = diaDelComercio().split('-').map(Number) as [number, number];
    const primero = (delta: number) =>
      new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.execute(
        sql`UPDATE expenses SET created_at = ${`${primero(0)}T01:30:00Z`}::timestamptz
             WHERE tenant_id = ${tenant} AND corrects_id = ${gasto!.id}`
      );
    });

    const delMesPasado = await conCtx(() => listAnnulledExpenses(primero(-1), primero(0)));
    const suyo = delMesPasado.find((a) => a.id === gasto!.id);
    expect(suyo).toBeDefined();
    // Y la fecha que se muestra es la del comercio: el último día del mes pasado.
    expect(suyo!.anulado_el).toBe(
      new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)
    );

    const deEsteMes = await conCtx(() => listAnnulledExpenses(primero(0), primero(1)));
    expect(deEsteMes.some((a) => a.id === gasto!.id)).toBe(false);
  });
});
