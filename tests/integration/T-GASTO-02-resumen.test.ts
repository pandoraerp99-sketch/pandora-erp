/**
 * T-GASTO-02 — el resumen del período que alimenta la pantalla.
 *
 * ── POR QUÉ ESTA CONSULTA EXISTE ──────────────────────────────────────────
 * La pantalla podría sumar los totales por categoría en el navegador. No lo
 * hace, y no es preferencia: sumar plata con `+=` sobre strings arrastra el
 * error de punto flotante, y encima pasa desapercibido porque con importes
 * redondos da bien — el número roto recién aparece con centavos de verdad. Ya
 * pasó una vez con el KPI "Por cobrar" de Clientes (CLAUDE.md §9.8).
 *
 * Por eso estos tests usan importes CON CENTAVOS a propósito: con miles
 * redondos, una implementación en float pasaría igual y no probaríamos nada.
 *
 * Lo otro que se protege acá es la separación que motiva todo el módulo: lo que
 * el estudio YA baja de ARCA vs. lo que el comercio tiene que mandar.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses } from '@/lib/db/schema/expenses';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  getExpenseSummary,
  getExpenseTotals,
  registerExpense,
} from '@/lib/services/expenses/expense.service';

const HOY = new Date().toISOString().slice(0, 10);
const DESDE = HOY.slice(0, 8) + '01';
const HASTA = (() => {
  const d = new Date(HOY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
})();
/** El último día del mes ANTERIOR: el borde que suele fallar. */
const JUSTO_ANTES = (() => {
  const d = new Date(DESDE);
  return new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
})();

describe('T-GASTO-02 — resumen del período', () => {
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
      name: `T-GASTO2 Co ${n}`,
      legal_name: `T-GASTO2 Co ${n} SRL`,
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
      email: `t-gasto2-${userId.slice(0, 8)}@test.local`,
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
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, ids));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  /** Un gasto con comprobante (entra al IVA compras). */
  const conFactura = (total: string, neto: string, iva: string, fecha = HOY) =>
    withCtx(() =>
      registerExpense({
        fecha,
        categoria: 'servicios',
        total,
        neto,
        iva,
        medio_pago: 'transferencia',
        comprobante_tipo: 'Factura',
        comprobante_numero: `0001-${Math.floor(Math.random() * 1e8)}`,
        en_iva_compras: true,
      })
    );

  /** Un gasto sin comprobante fiscal: el que hay que mandarle al estudio. */
  const sinFactura = (total: string, fecha = HOY) =>
    withCtx(() =>
      registerExpense({
        fecha,
        categoria: 'otros',
        total,
        medio_pago: 'transferencia',
      })
    );

  it('el total del período se suma con centavos, sin arrastrar float', async () => {
    // 0.1 + 0.2 en float da 0.30000000000000004. Tres importes con centavos que
    // en float NO cierran redondo: si esto se sumara en JS con `+`, el total
    // saldría con basura al final.
    await sinFactura('1000.10');
    await sinFactura('2000.20');
    await sinFactura('3000.30');

    const r = await withCtx(() => getExpenseSummary(DESDE, HASTA));
    expect(new Decimal(r.total).eq('6000.60')).toBe(true);
    expect(r.cantidad).toBe('3');
  });

  it('separa lo que el estudio baja de ARCA de lo que hay que mandarle', async () => {
    // Es la separación que motiva todo el módulo. Si se mezclan, el export le
    // manda a la contadora lo que ella ya tiene, y revisa dos veces lo mismo.
    await conFactura('1210.00', '1000.00', '210.00');
    await conFactura('605.00', '500.00', '105.00');
    await sinFactura('750.50');

    const r = await withCtx(() => getExpenseSummary(DESDE, HASTA));
    expect(new Decimal(r.arca_total).eq('1815.00')).toBe(true);
    expect(r.arca_cantidad).toBe('2');
    expect(new Decimal(r.fuera_total).eq('750.50')).toBe(true);
    expect(r.fuera_cantidad).toBe('1');
    // Y las dos partes tienen que dar el todo: si no, hay gastos que no están
    // ni de un lado ni del otro y nadie se entera.
    expect(
      new Decimal(r.arca_total).plus(r.fuera_total).eq(r.total)
    ).toBe(true);
  });

  it('el IVA crédito sale SÓLO de los gastos con comprobante fiscal', async () => {
    // Un gasto sin factura no da crédito por más IVA que tenga adentro el
    // precio. Computarlo sería declarar un crédito que no existe.
    await conFactura('1210.00', '1000.00', '210.00');
    await sinFactura('5000.00');

    const r = await withCtx(() => getExpenseSummary(DESDE, HASTA));
    expect(new Decimal(r.arca_credito).eq('210.00')).toBe(true);
  });

  it('no cuenta un gasto del mes anterior', async () => {
    await sinFactura('999.00', JUSTO_ANTES);
    const r = await withCtx(() => getExpenseSummary(DESDE, HASTA));
    expect(new Decimal(r.total).eq('0')).toBe(true);
    expect(r.cantidad).toBe('0');
  });

  it('sin gastos devuelve ceros, no null: la pantalla muestra $0', async () => {
    const r = await withCtx(() => getExpenseSummary(DESDE, HASTA));
    expect(new Decimal(r.total).eq('0')).toBe(true);
    expect(new Decimal(r.arca_credito).eq('0')).toBe(true);
    expect(r.cantidad).toBe('0');
    expect(r.fuera_cantidad).toBe('0');
  });

  it('ordena las categorías por importe, no alfabéticamente por el texto', async () => {
    // BUG REAL encontrado midiendo la pantalla (2026-09-09): la consulta decía
    // `ORDER BY 2`, y la columna 2 es el total YA casteado a text. Ordenar
    // texto compara caracter por caracter, así que '95000' salía antes que
    // '400000' porque '9' > '4'. En pantalla se veía Honorarios arriba de
    // Alquiler con el importe de cada fila BIEN: nada delataba el error salvo
    // el orden.
    await withCtx(() =>
      registerExpense({
        fecha: HOY, categoria: 'honorarios', total: '95000.00',
        medio_pago: 'transferencia',
      })
    );
    await withCtx(() =>
      registerExpense({
        fecha: HOY, categoria: 'alquiler', total: '400000.00',
        medio_pago: 'transferencia',
      })
    );

    const filas = await withCtx(() => getExpenseTotals(DESDE, HASTA));
    expect(filas.map((f) => f.categoria)).toEqual(['alquiler', 'honorarios']);
  });

  it('no suma los gastos de otro comercio', async () => {
    await withCtx(
      () =>
        registerExpense({
          fecha: HOY,
          categoria: 'otros',
          total: '9999.00',
          medio_pago: 'transferencia',
        }),
      otroTenant
    );
    await sinFactura('100.00');

    const r = await withCtx(() => getExpenseSummary(DESDE, HASTA));
    expect(new Decimal(r.total).eq('100.00')).toBe(true);
    expect(r.cantidad).toBe('1');
  });
});
