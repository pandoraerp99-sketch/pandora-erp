/**
 * T-GASTO-ULT-01 — "Últimos gastos" al lado del alta (`listRecentExpenses`).
 *
 * Lo que se prueba:
 * - el orden es por CUÁNDO SE CARGÓ, no por la fecha del gasto: un gasto de
 *   agosto cargado hoy va arriba (es lo que se acaba de registrar);
 * - un gasto anulado no aparece (ya no es un gasto);
 * - el límite se respeta;
 * - otro comercio no ve los gastos de éste (CLAUDE.md §7.9 y §18.4: toda
 *   lectura nueva de datos de un comercio lleva su prueba de aislamiento).
 *
 * Y la memoria por proveedor (`memoriaPorProveedor`), que completa sola la
 * categoría y el tipo al elegir un proveedor ya usado:
 * - devuelve los del ÚLTIMO gasto cargado con ese proveedor;
 * - el tipo elegido a mano gana sobre el de la categoría;
 * - un gasto anulado no cuenta;
 * - no cruza comercios.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses } from '@/lib/db/schema/expenses';
import { expense_cost_behaviour } from '@/lib/db/schema/expense_cost_behaviour';
import { terceros } from '@/lib/db/schema/terceros';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import {
  annulExpense,
  listRecentExpenses,
  registerExpense,
} from '@/lib/services/expenses/expense.service';
import { memoriaPorProveedor } from '@/lib/services/expenses/cost-behaviour.service';

const HOY = diaDelComercio();
const ANIO = HOY.slice(0, 4);

describe('T-GASTO-ULT-01 — últimos gastos cargados', () => {
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
      name: `T-GASTO-ULT Co ${n}`,
      legal_name: `T-GASTO-ULT Co ${n} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
  };

  const gasto = (fecha: string, descripcion: string, tid?: string) =>
    withCtx(
      () =>
        registerExpense({
          fecha,
          categoria: 'servicios',
          total: '100.00',
          medio_pago: 'transferencia',
          descripcion,
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
      email: `t-gastoult-${userId.slice(0, 8)}@test.local`,
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
      await tx.delete(terceros).where(inArray(terceros.tenant_id, ids));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, ids));
      await tx.delete(company_users).where(inArray(company_users.company_id, ids));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  it('ordena por cuándo se cargó, no por la fecha del gasto', async () => {
    await gasto(HOY, 'cargado primero, con fecha de hoy');
    await gasto(`${ANIO}-01-15`, 'cargado después, con fecha vieja');
    const ult = await withCtx(() => listRecentExpenses(5));
    expect(ult.map((g) => g.descripcion)).toEqual([
      'cargado después, con fecha vieja',
      'cargado primero, con fecha de hoy',
    ]);
  });

  it('un gasto anulado no aparece', async () => {
    const g = await gasto(HOY, 'se anula');
    await gasto(HOY, 'queda');
    await withCtx(() => annulExpense({ expense_id: g.id, motivo: 'se cargó dos veces' }));
    const ult = await withCtx(() => listRecentExpenses(5));
    expect(ult.map((x) => x.descripcion)).toEqual(['queda']);
  });

  it('respeta el límite', async () => {
    for (let i = 0; i < 4; i++) await gasto(HOY, `gasto ${i}`);
    const ult = await withCtx(() => listRecentExpenses(2));
    expect(ult.map((g) => g.descripcion)).toEqual(['gasto 3', 'gasto 2']);
  });

  it('otro comercio no ve los gastos de éste', async () => {
    await gasto(HOY, 'del comercio 1');
    await gasto(HOY, 'del comercio 2', otro);
    const mios = await withCtx(() => listRecentExpenses(5));
    const ajenos = await withCtx(() => listRecentExpenses(5), otro);
    expect(mios.map((g) => g.descripcion)).toEqual(['del comercio 1']);
    expect(ajenos.map((g) => g.descripcion)).toEqual(['del comercio 2']);
    expect(mios.every((g) => g.tenant_id === tenantId)).toBe(true);
  });

  describe('memoria por proveedor', () => {
    const proveedor = async (name: string, tid?: string) => {
      const [p] = await db
        .insert(terceros)
        .values({ tenant_id: tid ?? tenantId, type: 'proveedor', name })
        .returning();
      return p!.id;
    };
    const cargar = (
      tercero: string,
      categoria: string,
      extra: Record<string, unknown> = {},
      tid?: string
    ) =>
      withCtx(
        () =>
          registerExpense({
            fecha: HOY,
            categoria: categoria as never,
            total: '50.00',
            medio_pago: 'transferencia',
            tercero_id: tercero,
            // Gastos iguales a propósito: lo que se prueba es la memoria, no el
            // aviso de duplicado (T-GASTO-DUP-01).
            confirmar_duplicado: true,
            ...extra,
          }),
        tid
      );

    it('devuelve la categoría y el tipo del último gasto con ese proveedor', async () => {
      const luz = await proveedor('Cooperativa Eléctrica');
      await cargar(luz, 'otros', { comportamiento: 'variable' });
      await cargar(luz, 'servicios');
      const m = await withCtx(() => memoriaPorProveedor());
      // El último fue servicios sin elegir tipo: vale el de la categoría.
      expect(m[luz]).toEqual({ categoria: 'servicios', comportamiento: 'mixto' });
    });

    it('el tipo elegido a mano gana sobre el de la categoría', async () => {
      const muni = await proveedor('Municipalidad');
      await cargar(muni, 'impuestos_y_tasas', { comportamiento: 'fijo' });
      const m = await withCtx(() => memoriaPorProveedor());
      expect(m[muni]).toEqual({ categoria: 'impuestos_y_tasas', comportamiento: 'fijo' });
    });

    it('la mercadería trae la categoría pero no un tipo', async () => {
      const dist = await proveedor('Distribuidora');
      await cargar(dist, 'mercaderia');
      const m = await withCtx(() => memoriaPorProveedor());
      expect(m[dist]).toEqual({ categoria: 'mercaderia', comportamiento: null });
    });

    it('un gasto anulado no cuenta: vuelve al anterior', async () => {
      const seg = await proveedor('Aseguradora');
      await cargar(seg, 'seguros');
      const malo = await cargar(seg, 'otros', { comportamiento: 'variable' });
      await withCtx(() => annulExpense({ expense_id: malo.id, motivo: 'categoría equivocada' }));
      const m = await withCtx(() => memoriaPorProveedor());
      expect(m[seg]).toEqual({ categoria: 'seguros', comportamiento: 'fijo' });
    });

    it('no cruza comercios', async () => {
      const mio = await proveedor('Proveedor mío');
      const ajeno = await proveedor('Proveedor ajeno', otro);
      await cargar(mio, 'alquiler');
      await cargar(ajeno, 'honorarios', {}, otro);
      const m1 = await withCtx(() => memoriaPorProveedor());
      const m2 = await withCtx(() => memoriaPorProveedor(), otro);
      expect(Object.keys(m1)).toEqual([mio]);
      expect(Object.keys(m2)).toEqual([ajeno]);
    });
  });
});
