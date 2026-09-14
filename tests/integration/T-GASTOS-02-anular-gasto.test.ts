/**
 * T-GASTOS-02 — Anular un gasto lo saca de TODAS las consultas.
 *
 * ── POR QUE ESTE TEST MIRA 7 LUGARES ──────────────────────────────────────
 * Antes de escribir el código se hizo un censo de quién lee la tabla
 * `expenses` (`scripts/consumidores-expenses.sh`): son **7 consultas en 3
 * archivos**. Cada una tiene que excluir lo anulado, y un test que sólo
 * mirara el listado de la pantalla pasaría en verde mientras el CSV que se le
 * manda al estudio sigue mostrando el gasto anulado.
 *
 * Ese CSV es el entregable del ítem 9 del pedido de la contadora. El lugar
 * donde el error importa NO es la pantalla.
 *
 * ── LAS DOS MITADES DE "VIGENTE" ──────────────────────────────────────────
 * Una fila cuenta si nadie la apunta con `corrects_id` **y** su total es > 0.
 * Cada mitad tapa un agujero distinto, y el test los separa:
 *
 *   - sin `NOT EXISTS` → el gasto se contaría dos veces (original + anulación)
 *   - sin `total > 0`  → la anulación suma $0 pero **cuenta como comprobante**
 *     en todos los `count(*)`
 *
 * Por eso no alcanza con mirar importes: hay aserciones explícitas sobre las
 * CANTIDADES.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses } from '@/lib/db/schema/expenses';
import { terceros } from '@/lib/db/schema/terceros';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import {
  registerExpense,
  annulExpense,
  listExpenses,
  getExpenseTotals,
  getExpenseSummary,
  getIvaCredito,
  getProveedoresDelPeriodo,
  ExpenseError,
} from '@/lib/services/expenses/expense.service';

describe('T-GASTOS-02 — Anular un gasto', () => {
  const tenant = crypto.randomUUID();
  const user = crypto.randomUUID();
  const proveedor = crypto.randomUUID();

  // Fecha VIEJA a propósito: el período es lo que se rompe en silencio si la
  // anulación llevara la fecha de hoy.
  const FECHA = '2026-03-15';
  const DESDE = '2026-03-01';
  const HASTA = '2026-04-01';

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

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenant,
      name: 'T-GASTOS-02 Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: user,
      email: `t-gastos-02-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Quien carga gastos',
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
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(expenses).where(eq(expenses.tenant_id, tenant));
      await tx.execute(
        sql`DELETE FROM cash_movements WHERE cash_session_id IN
            (SELECT id FROM cash_sessions WHERE tenant_id = ${tenant})`
      );
      await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tenant));
      await tx.delete(terceros).where(eq(terceros.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(eq(companies.id, tenant));
    });
  });

  /** Gasto NO efectivo: aísla la anulación de la lógica de caja. */
  async function gastoPorTransferencia() {
    return conCtx(() =>
      registerExpense({
        fecha: FECHA,
        categoria: 'mercaderia',
        total: '100000',
        neto: '82644.63',
        iva: '17355.37',
        tercero_id: proveedor,
        comprobante_tipo: 'A',
        comprobante_numero: '0001-00099999',
        en_iva_compras: true,
        medio_pago: 'transferencia',
        descripcion: 'compra que se cargo mal',
      })
    );
  }

  it('el gasto cargado aparece en las 7 consultas (línea de base)', async () => {
    await gastoPorTransferencia();

    const [lista, totales, resumen, credito, proveedores] = await conCtx(async () => [
      await listExpenses(DESDE, HASTA),
      await getExpenseTotals(DESDE, HASTA),
      await getExpenseSummary(DESDE, HASTA),
      await getIvaCredito(DESDE, HASTA),
      await getProveedoresDelPeriodo(DESDE, HASTA),
    ]);

    expect(lista).toHaveLength(1);
    expect(totales.find((t) => t.categoria === 'mercaderia')?.total).toBe('100000.0000');
    expect(resumen.cantidad).toBe('1');
    expect(credito.comprobantes).toBe(1);
    expect(proveedores).toHaveLength(1);
  });

  it('🔴 anulado: desaparece de las 7, y las CANTIDADES también bajan', async () => {
    const gasto = await gastoPorTransferencia();
    await conCtx(() => annulExpense({ expense_id: gasto.id, motivo: 'se cargo dos veces' }));

    const [lista, totales, resumen, credito, proveedores] = await conCtx(async () => [
      await listExpenses(DESDE, HASTA),
      await getExpenseTotals(DESDE, HASTA),
      await getExpenseSummary(DESDE, HASTA),
      await getIvaCredito(DESDE, HASTA),
      await getProveedoresDelPeriodo(DESDE, HASTA),
    ]);

    // (1) listExpenses — la pantalla
    expect(lista.map((g) => g.id)).not.toContain(gasto.id);
    // (2) getExpenseTotals — acá el importe NO alcanza para probar nada: la
    //     fila de anulación vale 0, así que `sum(total)` da lo mismo con filtro
    //     o sin él. Lo único que delata el problema es la CANTIDAD.
    const merc = totales.find((t) => t.categoria === 'mercaderia');
    expect(merc?.total).toBe('100000.0000');
    expect(merc?.cantidad).toBe('1');
    // (3) getExpenseSummary — el count es el que delata la mitad `total > 0`
    expect(resumen.cantidad).toBe('1');
    expect(resumen.total).toBe('100000.0000');
    // (4) getIvaCredito — un crédito fiscal de un comprobante anulado es un
    //     crédito que no existe
    expect(credito.comprobantes).toBe(1);
    expect(credito.credito).toBe('17355.3700');
    // (5) getProveedoresDelPeriodo — esto es lo que va en el CSV al estudio
    expect(proveedores).toHaveLength(1);
    expect(proveedores[0]?.comprobantes).toBe('1');
    expect(proveedores[0]?.total).toBe('100000.0000');
  });

  it('🔴 la anulación hereda la fecha del original, no la de hoy', async () => {
    const gasto = await gastoPorTransferencia();
    const anulacion = await conCtx(() =>
      annulExpense({ expense_id: gasto.id, motivo: 'prueba de periodo' })
    );

    // Si llevara la fecha de hoy, marzo perdería el gasto y el mes actual
    // ganaría una fila fantasma — sin que ningún total se vea mal.
    expect(anulacion.fecha).toBe(FECHA);
    expect(anulacion.total).toBe('0.0000');
    expect(anulacion.corrects_id).toBe(gasto.id);

    // Y no aparece en el mes en curso.
    const hoy = diaDelComercio();
    const delMesActual = await conCtx(() =>
      listExpenses(hoy.slice(0, 7) + '-01', '2100-01-01')
    );
    expect(delMesActual.map((g) => g.id)).not.toContain(anulacion.id);
  });

  it('no se anula dos veces', async () => {
    const gasto = await gastoPorTransferencia();
    await conCtx(() => annulExpense({ expense_id: gasto.id, motivo: 'primera' }));
    await expect(
      conCtx(() => annulExpense({ expense_id: gasto.id, motivo: 'segunda' }))
    ).rejects.toThrow(ExpenseError);
  });

  it('exige motivo', async () => {
    const gasto = await gastoPorTransferencia();
    await expect(
      conCtx(() => annulExpense({ expense_id: gasto.id, motivo: '  ' }))
    ).rejects.toThrow(ExpenseError);
  });

  it('gasto en efectivo: la plata vuelve a la caja abierta de hoy', async () => {
    const sesionVieja = crypto.randomUUID();
    const sesionHoy = crypto.randomUUID();
    await db.insert(cash_sessions).values([
      {
        id: sesionVieja,
        tenant_id: tenant,
        sale_point: 1,
        opened_by: user,
        initial_amount: '50000.0000',
        closed_at: null,
      },
      {
        id: sesionHoy,
        tenant_id: tenant,
        sale_point: 2,
        opened_by: user,
        initial_amount: '10000.0000',
        closed_at: null,
      },
    ]);

    const gasto = await conCtx(() =>
      registerExpense({
        fecha: FECHA,
        categoria: 'mercaderia',
        total: '30000',
        tercero_id: proveedor,
        medio_pago: 'efectivo',
        cash_session_id: sesionVieja,
      })
    );
    expect(gasto.cash_movement_id).not.toBeNull();

    await conCtx(() =>
      annulExpense({
        expense_id: gasto.id,
        motivo: 'no era esta caja',
        cash_session_id: sesionHoy,
      })
    );

    // El deposit va a la caja de HOY. La sesión vieja no se toca: puede estar
    // cerrada y arqueada, y meterle un movimiento cambiaría un cierre hecho.
    const movsHoy = await db
      .select()
      .from(cash_movements)
      .where(eq(cash_movements.cash_session_id, sesionHoy));
    expect(movsHoy).toHaveLength(1);
    expect(movsHoy[0]?.type).toBe('deposit');
    expect(movsHoy[0]?.amount).toBe('30000.0000');

    const movsViejos = await db
      .select()
      .from(cash_movements)
      .where(eq(cash_movements.cash_session_id, sesionVieja));
    expect(movsViejos).toHaveLength(1); // sólo el provider_payment original
    expect(movsViejos[0]?.type).toBe('provider_payment');
  });

  it('gasto en efectivo sin caja indicada: se rechaza y no deja nada a medias', async () => {
    const sesion = crypto.randomUUID();
    await db.insert(cash_sessions).values({
      id: sesion,
      tenant_id: tenant,
      sale_point: 3,
      opened_by: user,
      initial_amount: '10000.0000',
      closed_at: null,
    });
    const gasto = await conCtx(() =>
      registerExpense({
        fecha: FECHA,
        categoria: 'otros',
        total: '5000',
        medio_pago: 'efectivo',
        cash_session_id: sesion,
      })
    );

    await expect(
      conCtx(() => annulExpense({ expense_id: gasto.id, motivo: 'sin caja' }))
    ).rejects.toThrow(ExpenseError);

    // El gasto sigue vigente: no quedó anulado a medias.
    const sigue = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.tenant_id, tenant), eq(expenses.corrects_id, gasto.id)));
    expect(sigue).toHaveLength(0);
  });
});
