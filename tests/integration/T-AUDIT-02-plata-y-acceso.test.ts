/**
 * T-AUDIT-02 — Las mutaciones de plata y de acceso dejan evento en audit_log.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 * CLAUDE.md §16.9 pide un evento de auditoría por mutación crítica. Hasta
 * EVENT-TAXONOMY v2.1.0 (aprobada por el owner el 2026-09-14) estas seis
 * operaciones quedaban sólo en Pino, que rota en días:
 *
 *   - cargar un gasto (y, si es mercadería, ENTRAR stock)
 *   - anular un gasto (devuelve plata a la caja y SACA stock)
 *   - cobrar una cuenta corriente (efectivo que entra al cajón)
 *   - ajustar a mano la deuda de un cliente
 *   - darle y sacarle acceso a la contadora
 *
 * El peor caso era el del stock: la compra movía el libro con `skip_audit`
 * "igual que finalizeSale", pero la venta compensa con `sale.completed` y el
 * gasto no emitía nada. La mercadería entraba y salía sin un solo evento.
 *
 * ── QUÉ AFIRMA ────────────────────────────────────────────────────────────
 * Cada caso cuenta EXACTAMENTE una fila del evento (no "al menos una"): un
 * evento duplicado es tan malo para el que investiga como uno faltante. Y cada
 * rechazo afirma CERO filas: una operación que no pasó no puede quedar
 * auditada como si hubiera pasado.
 *
 * Ver PROPUESTA-EVENTOS-AUDITORIA-2026-09.md (repo SRS).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { customers } from '@/lib/db/schema/customers';
import { customer_account_movements } from '@/lib/db/schema/customer_account';
import { expenses } from '@/lib/db/schema/expenses';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  registerExpense,
  annulExpense,
  ExpenseError,
} from '@/lib/services/expenses/expense.service';
import {
  adjustAccount,
  settleAccount,
  AccountError,
} from '@/lib/services/customers/account.service';
import { createCustomer } from '@/lib/services/customers/customer.service';
import {
  AccountantInviteError,
  linkAccountant,
  revokeAccountant,
} from '@/lib/services/identity/accountant.service';
import { adjustStock } from '@/lib/services/products';

describe('T-AUDIT-02 — plata y acceso dejan evento en audit_log', () => {
  const tenant = crypto.randomUUID();
  const ajeno = crypto.randomUUID();
  const user = crypto.randomUUID();
  const empleado = crypto.randomUUID();
  const contadoras: string[] = [];
  const yerba = crypto.randomUUID();
  const azucar = crypto.randomUUID();
  const sesion = crypto.randomUUID();
  let cliente: string;
  let clienteAjeno: string;

  const en = <T,>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: user,
          actor_type: 'user',
        },
        fn
      )
    );
  const conCtx = <T,>(fn: () => Promise<T>) => en(tenant, fn);

  /** Filas de un evento en el comercio, opcionalmente filtradas por un campo del payload. */
  const eventos = (nombre: string, campo?: string, valor?: string) =>
    db
      .select()
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenant),
          eq(audit_log.event_name, nombre),
          campo ? sql`${audit_log.payload}->>${campo} = ${valor}` : sql`true`
        )
      );

  const crearEmpresa = (id: string, nombre: string) =>
    db.insert(companies).values({
      id,
      name: nombre,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });

  beforeAll(async () => {
    await crearEmpresa(tenant, 'T-AUDIT-02 Co');
    await crearEmpresa(ajeno, 'T-AUDIT-02 Vecino');
    await db.insert(users).values([
      {
        id: user,
        email: `t-audit-02-${tenant.slice(0, 8)}@test.local`,
        full_name: 'Dueña',
        is_support: false,
      },
      {
        id: empleado,
        email: `t-audit-02-emp-${tenant.slice(0, 8)}@test.local`,
        full_name: 'Empleado',
        is_support: false,
      },
    ]);
    await db.insert(company_users).values([
      { id: crypto.randomUUID(), company_id: tenant, user_id: user, role: 'owner' },
      { id: crypto.randomUUID(), company_id: tenant, user_id: empleado, role: 'cashier' },
      // También en el comercio ajeno: el fixture le crea un cliente ahí, y
      // desde H-01 nadie escribe donde no es miembro.
      { id: crypto.randomUUID(), company_id: ajeno, user_id: user, role: 'owner' },
    ]);
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
      { ...base, id: yerba, name: 'Yerba T-AUDIT-02' },
      { ...base, id: azucar, name: 'Azúcar T-AUDIT-02' },
    ]);
    await db.insert(cash_sessions).values({
      id: sesion,
      tenant_id: tenant,
      sale_point: 1,
      opened_by: user,
      initial_amount: '10000.0000',
      closed_at: null,
    });
    cliente = (await conCtx(() => createCustomer({ name: 'Doña Rosa' }))).id;
    clienteAjeno = (await en(ajeno, () => createCustomer({ name: 'Cliente del vecino' }))).id;
  });

  afterAll(async () => {
    const tenants = [tenant, ajeno];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(customer_account_movements).where(
        inArray(customer_account_movements.tenant_id, tenants)
      );
      await tx.execute(sql`DELETE FROM expense_items WHERE tenant_id = ${tenant}`);
      await tx.delete(expenses).where(eq(expenses.tenant_id, tenant));
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenant));
      await tx.execute(
        sql`DELETE FROM cash_movements WHERE cash_session_id IN
            (SELECT id FROM cash_sessions WHERE tenant_id = ${tenant})`
      );
      await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tenant));
      await tx.delete(customers).where(inArray(customers.tenant_id, tenants));
      await tx.delete(products).where(eq(products.tenant_id, tenant));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, tenants));
      await tx.delete(company_users).where(inArray(company_users.company_id, tenants));
      await tx.delete(users).where(inArray(users.id, [user, empleado, ...contadoras]));
      await tx.delete(companies).where(inArray(companies.id, tenants));
    });
  });

  // ── Gastos ────────────────────────────────────────────────────────────────

  describe('expense.registered', () => {
    it('🔴 una compra de mercadería deja UN evento con sus líneas y los movimientos de stock', async () => {
      const gasto = await conCtx(() =>
        registerExpense({
          fecha: '2026-03-10',
          categoria: 'mercaderia',
          neto: '10000',
          iva: '2100',
          total: '12100',
          payee_name: 'Distribuidora del Sur',
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

      const filas = await eventos('expense.registered', 'expense_id', gasto.id);
      expect(filas).toHaveLength(1);
      const [ev] = filas;
      expect(ev?.severity).toBe('info');
      expect(ev?.pii_level).toBe('internal');
      expect(ev?.actor_user_id).toBe(user);
      expect(ev?.payload).toMatchObject({
        expense_id: gasto.id,
        fecha: '2026-03-10',
        categoria: 'mercaderia',
        total: '12100.0000',
        neto: '10000.0000',
        iva: '2100.0000',
        medio_pago: 'transferencia',
        en_iva_compras: true,
        comprobante_tipo: 'A',
        comprobante_numero: '0001-00012345',
        cash_movement_id: null,
        items: [
          { product_id: yerba, qty: '10.0000', unit_cost: '800.0000' },
          { product_id: azucar, qty: '5.0000', unit_cost: '400.0000' },
        ],
      });

      // Los ids del payload son los movimientos REALES de esa compra: sin esto
      // el evento podría listar cualquier cosa y seguir pasando.
      const movs = await db
        .select({ id: stock_movements.id })
        .from(stock_movements)
        .where(
          and(
            eq(stock_movements.tenant_id, tenant),
            eq(stock_movements.related_expense_id, gasto.id)
          )
        );
      const payload = ev?.payload as { stock_movement_ids: string[] };
      expect([...payload.stock_movement_ids].sort()).toEqual(
        movs.map((m) => String(m.id)).sort()
      );
      expect(payload.stock_movement_ids).toHaveLength(2);
    });

    it('un gasto en efectivo lleva el movimiento de caja para cruzarlo con el arqueo', async () => {
      const gasto = await conCtx(() =>
        registerExpense({
          fecha: '2026-03-11',
          categoria: 'servicios',
          total: '5000',
          payee_name: 'Cooperativa eléctrica',
          medio_pago: 'efectivo',
          cash_session_id: sesion,
        })
      );
      expect(gasto.cash_movement_id).not.toBeNull();

      const filas = await eventos('expense.registered', 'expense_id', gasto.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.payload).toMatchObject({
        cash_movement_id: String(gasto.cash_movement_id),
        items: [],
        stock_movement_ids: [],
      });
    });

    it('un gasto rechazado no deja evento', async () => {
      const antes = (await eventos('expense.registered')).length;
      await expect(
        conCtx(() =>
          registerExpense({
            fecha: '2026-03-12',
            categoria: 'mercaderia',
            total: '100',
            medio_pago: 'transferencia',
            items: [{ product_id: crypto.randomUUID(), qty: '1', unit_cost: '100' }],
          })
        )
      ).rejects.toThrow(ExpenseError);
      expect(await eventos('expense.registered')).toHaveLength(antes);
    });
  });

  describe('expense.annulled', () => {
    it('🔴 anular una compra deja UN evento warning con el motivo y el stock que salió', async () => {
      const gasto = await conCtx(() =>
        registerExpense({
          fecha: '2026-03-20',
          categoria: 'mercaderia',
          total: '6000',
          payee_name: 'Mayorista',
          comprobante_numero: '0002-00000077',
          medio_pago: 'transferencia',
          items: [{ product_id: azucar, qty: '10', unit_cost: '600' }],
        })
      );
      const anulacion = await conCtx(() =>
        annulExpense({ expense_id: gasto.id, motivo: 'era de otro comercio' })
      );

      const filas = await eventos('expense.annulled', 'expense_id', gasto.id);
      expect(filas).toHaveLength(1);
      const [ev] = filas;
      expect(ev?.severity).toBe('warning');
      expect(ev?.pii_level).toBe('internal');
      expect(ev?.payload).toMatchObject({
        expense_id: gasto.id,
        annulment_id: anulacion.id,
        fecha_original: '2026-03-20',
        total_anulado: '6000.0000',
        motivo: 'era de otro comercio',
        devolvio_a_caja: false,
        cash_session_id: null,
        deposit_cash_movement_id: null,
      });

      const salidas = await db
        .select({ id: stock_movements.id })
        .from(stock_movements)
        .where(
          and(
            eq(stock_movements.tenant_id, tenant),
            eq(stock_movements.related_expense_id, gasto.id),
            eq(stock_movements.direction, 'out')
          )
        );
      expect(salidas).toHaveLength(1);
      expect((ev?.payload as { stock_movement_ids: string[] }).stock_movement_ids).toEqual(
        salidas.map((m) => String(m.id))
      );
    });

    it('anular un gasto en efectivo lleva la caja y el depósito que devolvió la plata', async () => {
      const gasto = await conCtx(() =>
        registerExpense({
          fecha: '2026-03-21',
          categoria: 'otros',
          total: '2500',
          medio_pago: 'efectivo',
          cash_session_id: sesion,
        })
      );
      await conCtx(() =>
        annulExpense({ expense_id: gasto.id, motivo: 'se cargó dos veces', cash_session_id: sesion })
      );

      const [deposito] = await db
        .select({ id: cash_movements.id })
        .from(cash_movements)
        .where(
          and(eq(cash_movements.cash_session_id, sesion), eq(cash_movements.type, 'deposit'))
        );
      expect(deposito).toBeDefined();

      const filas = await eventos('expense.annulled', 'expense_id', gasto.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.payload).toMatchObject({
        devolvio_a_caja: true,
        cash_session_id: sesion,
        deposit_cash_movement_id: String(deposito?.id),
      });
    });

    it('🔴 una anulación rechazada (la mercadería ya se vendió) no deja evento', async () => {
      const gasto = await conCtx(() =>
        registerExpense({
          fecha: '2026-03-22',
          categoria: 'mercaderia',
          total: '4000',
          medio_pago: 'transferencia',
          items: [{ product_id: yerba, qty: '5', unit_cost: '800' }],
        })
      );
      // Se va stock por otro lado: ya no quedan las 5 unidades de ESTA compra
      // para devolver... salvo que haya stock previo, así que se vacía todo.
      const stock = await db
        .select({ s: products.stock_current })
        .from(products)
        .where(eq(products.id, yerba));
      await conCtx(() =>
        adjustStock({
          product_id: yerba,
          delta: `-${stock[0]!.s}`,
          motivo: 'recuento',
          detalle: 'se vendió por fuera',
        })
      );

      await expect(
        conCtx(() => annulExpense({ expense_id: gasto.id, motivo: 'intento' }))
      ).rejects.toThrow(ExpenseError);
      expect(await eventos('expense.annulled', 'expense_id', gasto.id)).toHaveLength(0);
    });
  });

  // ── Cuenta corriente ──────────────────────────────────────────────────────

  describe('customer.account.*', () => {
    it('🔴 un ajuste que suma deuda deja UN evento warning con el saldo previo', async () => {
      const mov = await conCtx(() =>
        adjustAccount({ customer_id: cliente, amount: '1500', reason: 'fiado anotado en el cuaderno' })
      );

      const filas = await eventos('customer.account.adjusted', 'movement_id', mov.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.severity).toBe('warning');
      expect(filas[0]?.pii_level).toBe('internal');
      expect(filas[0]?.payload).toMatchObject({
        movement_id: mov.id,
        customer_id: cliente,
        amount: '1500.0000',
        reason: 'fiado anotado en el cuaderno',
        saldo_antes: '0.0000',
      });
    });

    it('🔴 NO se le puede ajustar la cuenta a un cliente de OTRO comercio', async () => {
      // La FK customer_id → customers(id) no ata el tenant: sin el chequeo en el
      // service, esta fila entraba con el tenant de uno y el cliente del otro.
      await expect(
        conCtx(() =>
          adjustAccount({ customer_id: clienteAjeno, amount: '100', reason: 'intento cruzado' })
        )
      ).rejects.toThrow(AccountError);

      const filas = await db
        .select()
        .from(customer_account_movements)
        .where(eq(customer_account_movements.customer_id, clienteAjeno));
      expect(filas).toHaveLength(0);
      expect(await eventos('customer.account.adjusted', 'customer_id', clienteAjeno)).toHaveLength(0);
    });

    it('un cobro en efectivo deja UN evento con la caja y el movimiento de caja', async () => {
      const mov = await conCtx(() =>
        settleAccount({
          customer_id: cliente,
          amount: '500',
          method: 'efectivo',
          cash_session_id: sesion,
        })
      );

      const filas = await eventos('customer.account.settled', 'movement_id', mov.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.severity).toBe('info');
      expect(filas[0]?.pii_level).toBe('internal');
      expect(filas[0]?.payload).toMatchObject({
        movement_id: mov.id,
        customer_id: cliente,
        amount: '500.0000',
        method: 'efectivo',
        saldo_antes: '1500.0000',
        cash_session_id: sesion,
        cash_movement_id: String(mov.cash_movement_id),
      });
    });

    it('un cobro rechazado (no hay deuda) no deja evento', async () => {
      const otro = (await conCtx(() => createCustomer({ name: 'Al día' }))).id;
      await expect(
        conCtx(() => settleAccount({ customer_id: otro, amount: '10', method: 'transferencia' }))
      ).rejects.toThrow(AccountError);
      expect(await eventos('customer.account.settled', 'customer_id', otro)).toHaveLength(0);
    });
  });

  // ── Acceso de la contadora ────────────────────────────────────────────────

  describe('auth.accountant.*', () => {
    const nuevaContadora = () => {
      const id = crypto.randomUUID();
      contadoras.push(id);
      return { userId: id, email: `contadora-${id.slice(0, 8)}@estudio.test` };
    };

    it('🔴 darle acceso deja UN evento warning; volver a invitarla no deja otro', async () => {
      const c = nuevaContadora();
      await conCtx(() => linkAccountant({ ...c, via: 'invitacion' }));

      const filas = await eventos('auth.accountant.granted', 'accountant_user_id', c.userId);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.severity).toBe('warning');
      // Sólo ids: el email de la contadora no se copia a un log de 10 años.
      expect(filas[0]?.pii_level).toBe('internal');
      expect(filas[0]?.payload).toEqual({ accountant_user_id: c.userId, via: 'invitacion' });

      // Segunda invitación: el vínculo ya existía, no cambió nada.
      await conCtx(() => linkAccountant({ ...c, via: 'usuario_existente' }));
      expect(
        await eventos('auth.accountant.granted', 'accountant_user_id', c.userId)
      ).toHaveLength(1);
    });

    it('si no se sabe cómo llegó, el evento dice null — no inventa "ya tenía cuenta"', async () => {
      const c = nuevaContadora();
      await conCtx(() => linkAccountant(c));
      const filas = await eventos('auth.accountant.granted', 'accountant_user_id', c.userId);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.payload).toEqual({ accountant_user_id: c.userId, via: null });
    });

    it('invitar como contador a alguien que ya trabaja en el comercio no deja evento', async () => {
      await expect(
        conCtx(() =>
          linkAccountant({ userId: empleado, email: `t-audit-02-emp-${tenant.slice(0, 8)}@test.local` })
        )
      ).rejects.toThrow(AccountantInviteError);
      expect(
        await eventos('auth.accountant.granted', 'accountant_user_id', empleado)
      ).toHaveLength(0);
    });

    it('🔴 sacarle el acceso deja UN evento; sacárselo de nuevo no deja otro', async () => {
      const c = nuevaContadora();
      await conCtx(() => linkAccountant(c));
      await conCtx(() => revokeAccountant(c.userId));

      const filas = await eventos('auth.accountant.revoked', 'accountant_user_id', c.userId);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.severity).toBe('warning');
      expect(filas[0]?.payload).toEqual({ accountant_user_id: c.userId });

      // No quedaba vínculo: no se borró nada, no hay nada que auditar.
      await conCtx(() => revokeAccountant(c.userId));
      expect(
        await eventos('auth.accountant.revoked', 'accountant_user_id', c.userId)
      ).toHaveLength(1);
    });

    it('revocar a un usuario que NO es contador (el dueño) no borra ni audita', async () => {
      await conCtx(() => revokeAccountant(user));
      const vinculo = await db
        .select()
        .from(company_users)
        .where(and(eq(company_users.company_id, tenant), eq(company_users.user_id, user)));
      expect(vinculo).toHaveLength(1);
      expect(await eventos('auth.accountant.revoked', 'accountant_user_id', user)).toHaveLength(0);
    });
  });
});
