/**
 * T-GASTO-FV-01 — gastos fijos, variables y mixtos (migration 0045).
 *
 * Lo que se prueba:
 * - sin elegir nada, vale el default de la categoría (alquiler fijo,
 *   servicios mixto); impuestos y "otros" quedan sin clasificar;
 * - lo elegido al cargar gana, y se puede cambiar después agregando una fila
 *   (append-only: la clasificación vieja no se borra);
 * - la mercadería no se clasifica y no entra al resumen;
 * - el resumen por mes suma con centavos, descarta lo anulado y devuelve
 *   todos los meses aunque alguno esté en cero;
 * - otro comercio no ve ni toca la clasificación.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses } from '@/lib/db/schema/expenses';
import { expense_cost_behaviour } from '@/lib/db/schema/expense_cost_behaviour';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { diaDelComercio, mesesDelComercio } from '@/lib/domain/fecha-comercio';
import { annulExpense, registerExpense } from '@/lib/services/expenses/expense.service';
import {
  clasificacionesExplicitas,
  clasificarGasto,
  getFijosVariablesPorMes,
} from '@/lib/services/expenses/cost-behaviour.service';

const HOY = diaDelComercio();
const MES = HOY.slice(0, 7);

describe('T-GASTO-FV-01 — fijos, variables y mixtos', () => {
  let tenantId: string;
  let otro: string;
  let userId: string;

  const withCtx = <T,>(fn: () => Promise<T>, tid?: string) =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid ?? tenantId,
          actor_user_id: userId,
          actor_type: 'user',
          actor_role: 'owner',
        },
        fn
      )
    );

  const crearCompany = async (id: string, n: number) => {
    await db.insert(companies).values({
      id,
      name: `T-GASTO-FV Co ${n}`,
      legal_name: `T-GASTO-FV Co ${n} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
  };

  const gasto = (categoria: string, total: string, extra: Record<string, unknown> = {}, tid?: string) =>
    withCtx(
      () =>
        registerExpense({
          fecha: HOY,
          categoria: categoria as never,
          total,
          medio_pago: 'transferencia',
          payee_name: 'Proveedor de prueba',
          ...extra,
        }),
      tid
    );

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    otro = crypto.randomUUID();
    userId = crypto.randomUUID();
    await crearCompany(tenantId, 1);
    await crearCompany(otro, 2);
    await db.insert(users).values({
      id: userId,
      email: `t-gastofv-${userId.slice(0, 8)}@test.local`,
      full_name: 'Dueña',
      is_support: false,
    });
    await db.insert(company_users).values([
      { id: crypto.randomUUID(), company_id: tenantId, user_id: userId, role: 'owner' },
      { id: crypto.randomUUID(), company_id: otro, user_id: userId, role: 'owner' },
    ]);
  });

  afterEach(async () => {
    const ids = [tenantId, otro];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(expense_cost_behaviour).where(inArray(expense_cost_behaviour.tenant_id, ids));
      await tx.delete(expenses).where(inArray(expenses.tenant_id, ids));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, ids));
      await tx.delete(company_users).where(inArray(company_users.company_id, ids));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  const mesActual = async () => {
    const meses = await withCtx(() => getFijosVariablesPorMes(6));
    return meses[meses.length - 1]!;
  };

  it('sin elegir: vale la categoría; impuestos y otros quedan sin clasificar', async () => {
    await gasto('alquiler', '150000.50');
    await gasto('servicios', '34200.25');
    await gasto('impuestos_y_tasas', '9999.99');
    const m = await mesActual();
    expect(m.mes).toBe(MES);
    expect(m.fijo).toBe('150000.50');
    expect(m.mixto).toBe('34200.25');
    expect(m.variable).toBe('0.00');
    expect(m.sin_clasificar).toBe('9999.99');
    expect(m.cantidad_sin_clasificar).toBe(1);
    expect(m.total).toBe('194200.74');
  });

  it('lo elegido al cargar gana y queda en el evento', async () => {
    const g = await gasto('impuestos_y_tasas', '12000.10', { comportamiento: 'variable' });
    const m = await mesActual();
    expect(m.variable).toBe('12000.10');
    expect(m.sin_clasificar).toBe('0.00');
    const [ev] = await db
      .select({ payload: audit_log.payload })
      .from(audit_log)
      .where(eq(audit_log.tenant_id, tenantId));
    expect((ev!.payload as { comportamiento: string }).comportamiento).toBe('variable');
    const mapa = await withCtx(() => clasificacionesExplicitas([g.id]));
    expect(mapa.get(g.id)).toBe('variable');
  });

  it('reclasificar agrega una fila; la última vale; repetir no ensucia la historia', async () => {
    const g = await gasto('otros', '5000');
    expect((await withCtx(() => clasificarGasto(g.id, 'fijo'))).cambiado).toBe(true);
    expect((await withCtx(() => clasificarGasto(g.id, 'fijo'))).cambiado).toBe(false); // doble click
    expect((await withCtx(() => clasificarGasto(g.id, 'variable'))).cambiado).toBe(true);
    const filas = await db
      .select()
      .from(expense_cost_behaviour)
      .where(eq(expense_cost_behaviour.expense_id, g.id));
    expect(filas.length).toBe(2);
    expect((await mesActual()).variable).toBe('5000.00');
    // Pedir el default de la categoría para uno que ya lo tiene: no-op.
    const alq = await gasto('alquiler', '1000');
    expect((await withCtx(() => clasificarGasto(alq.id, 'fijo'))).cambiado).toBe(false);
  });

  it('la clasificación no se edita ni se borra en la base', async () => {
    const g = await gasto('otros', '100', { comportamiento: 'fijo' });
    await expect(
      db.update(expense_cost_behaviour).set({ comportamiento: 'variable' }).where(eq(expense_cost_behaviour.expense_id, g.id))
    ).rejects.toThrow();
    await expect(
      db.delete(expense_cost_behaviour).where(eq(expense_cost_behaviour.expense_id, g.id))
    ).rejects.toThrow();
  });

  it('la mercadería no se clasifica ni entra al resumen', async () => {
    await expect(gasto('mercaderia', '1000', { comportamiento: 'variable' })).rejects.toThrow(/mercadería/);
    const m = await gasto('mercaderia', '80000');
    await expect(withCtx(() => clasificarGasto(m.id, 'variable'))).rejects.toThrow(/mercadería/);
    expect((await mesActual()).total).toBe('0.00');
  });

  it('lo anulado no cuenta, y no se puede clasificar', async () => {
    const g = await gasto('alquiler', '70000');
    await withCtx(() => annulExpense({ expense_id: g.id, motivo: 'se cargó dos veces' }));
    expect((await mesActual()).fijo).toBe('0.00');
    await expect(withCtx(() => clasificarGasto(g.id, 'variable'))).rejects.toThrow(/anulado/);
  });

  it('devuelve los 6 meses, en orden, aunque estén vacíos', async () => {
    const meses = await withCtx(() => getFijosVariablesPorMes(6));
    expect(meses.map((x) => x.mes)).toEqual(mesesDelComercio(6));
    expect(meses.every((x) => x.total === '0.00')).toBe(true);
  });

  it('aislamiento: otro comercio no ve los gastos ni puede clasificarlos', async () => {
    const g = await gasto('alquiler', '1000');
    const ajeno = await withCtx(() => getFijosVariablesPorMes(1), otro);
    expect(ajeno[0]!.total).toBe('0.00');
    await expect(withCtx(() => clasificarGasto(g.id, 'variable'), otro)).rejects.toThrow(/no existe/);
    expect((await withCtx(() => clasificacionesExplicitas([g.id]), otro)).size).toBe(0);
  });

  it('validación: un valor que no existe', async () => {
    await expect(gasto('otros', '10', { comportamiento: 'semifijo' })).rejects.toThrow(/fijo, variable o mixto/);
  });
});
