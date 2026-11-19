/**
 * T-ROL-01 — quién puede ESCRIBIR en el comercio (H-01 de la auditoría).
 *
 * ── El agujero ───────────────────────────────────────────────────────────
 * "El contador es read-only" (ADR-0008, CLAUDE.md §7.3) no lo hacía cumplir
 * nada: la UI no dibujaba los botones (§6.4: eso no es autorización), el
 * proxy no filtra rutas por rol, y el RLS no corre sobre las escrituras del
 * servidor porque Drizzle entra como `postgres` con `rolbypassrls = true`.
 * Se probó corriendo: con rol `accountant`, `registerExpense` y
 * `createProduct` escribían.
 *
 * ── Lo que se prueba ─────────────────────────────────────────────────────
 * Una muestra de mutaciones de TODOS los dominios, no una sola: la guardia
 * es una línea por función y la que falta no se ve. Para el rechazo se
 * manda un input VACÍO a propósito: si la función tira `SoloLecturaError` y
 * no un error de validación, la guardia corre ANTES de validar y antes de
 * cualquier efecto. Para el paso, inputs válidos de dos mutaciones.
 *
 * Y la mitad que se olvida: la dueña sigue escribiendo, y un actor que no es
 * persona (`system`: el webhook de MercadoPago) también — tiene su propia
 * puerta (HMAC).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses } from '@/lib/db/schema/expenses';
import { products } from '@/lib/db/schema/products';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import type { ActorType } from '@/lib/db/schema/_common';
import { SoloLecturaError } from '@/lib/auth/autorizacion';
import { registerExpense, annulExpense } from '@/lib/services/expenses/expense.service';
import { createProduct, updateProduct, adjustStock } from '@/lib/services/products/product.service';
import { createCustomer, deactivateCustomer } from '@/lib/services/customers/customer.service';
import { settleAccount } from '@/lib/services/customers/account.service';
import { createDraftSale, finalizeSale, cancelSale } from '@/lib/services/sales/sale.service';
import { openCashSession, closeCashSession } from '@/lib/cash/sessions';
import { registerCashMovement } from '@/lib/cash/movements';
import { createTask, deleteTask } from '@/lib/services/tasks/task.service';
import { recordStockMovement } from '@/lib/inventory/stock';
import { settleSupplier } from '@/lib/services/expenses/supplier-account.service';
import {
  createOrder,
  updateOrder,
  changeOrderStatus,
  registerOrderPayment,
  deliverOrder,
} from '@/lib/services/orders/order.service';
import { registerRelief, markReliefsPickedUp } from '@/lib/cash/reliefs';

describe('T-ROL-01 — quién escribe en el comercio', () => {
  const tenant = crypto.randomUUID();
  const duenia = crypto.randomUUID();
  const contadora = crypto.randomUUID();
  const nadie = crypto.randomUUID();

  const como = <T,>(
    userId: string,
    fn: () => Promise<T>,
    actorType: ActorType = 'user'
  ): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenant,
          actor_user_id: userId,
          actor_type: actorType,
        },
        fn
      )
    );

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenant,
      name: 'T-ROL-01 Comercio',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values([
      { id: duenia, email: `t-rol-01-duenia-${tenant.slice(0, 8)}@test.local`, full_name: 'Dueña', is_support: false },
      { id: contadora, email: `t-rol-01-contadora-${tenant.slice(0, 8)}@test.local`, full_name: 'Contadora', is_support: false },
    ]);
    await db.insert(company_users).values([
      { id: crypto.randomUUID(), company_id: tenant, user_id: duenia, role: 'owner' },
      { id: crypto.randomUUID(), company_id: tenant, user_id: contadora, role: 'accountant' },
    ]);
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.execute(sql`DELETE FROM expense_items WHERE tenant_id = ${tenant}`);
      await tx.delete(expenses).where(eq(expenses.tenant_id, tenant));
      await tx.execute(sql`DELETE FROM stock_movements WHERE tenant_id = ${tenant}`);
      await tx.delete(products).where(eq(products.tenant_id, tenant));
      await tx.execute(sql`DELETE FROM tasks WHERE tenant_id = ${tenant}`);
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(inArray(users.id, [duenia, contadora]));
      await tx.delete(companies).where(eq(companies.id, tenant));
    });
  });

  // Input vacío a propósito: ver el encabezado. `as never` porque el tipo no
  // importa — lo que importa es QUÉ error sale.
  const vacio = {} as never;
  const MUTACIONES: Array<[string, () => Promise<unknown>]> = [
    ['registerExpense', () => registerExpense(vacio)],
    ['annulExpense', () => annulExpense(vacio)],
    ['createProduct', () => createProduct(vacio)],
    ['updateProduct', () => updateProduct(vacio, vacio)],
    ['adjustStock', () => adjustStock(vacio)],
    ['recordStockMovement', () => recordStockMovement(vacio)],
    ['createCustomer', () => createCustomer(vacio)],
    ['deactivateCustomer', () => deactivateCustomer('')],
    ['settleAccount', () => settleAccount(vacio)],
    ['settleSupplier', () => settleSupplier(vacio)],
    ['createDraftSale', () => createDraftSale(vacio)],
    ['finalizeSale', () => finalizeSale(vacio)],
    ['cancelSale', () => cancelSale(vacio)],
    ['openCashSession', () => openCashSession(vacio)],
    ['closeCashSession', () => closeCashSession(vacio)],
    ['registerCashMovement', () => registerCashMovement(vacio)],
    ['createTask', () => createTask(vacio)],
    ['deleteTask', () => deleteTask('')],
    // Pedidos con seña (ADR-0029): mueven plata en la caja.
    ['createOrder', () => createOrder(vacio, null, '')],
    ['updateOrder', () => updateOrder('', vacio)],
    ['changeOrderStatus', () => changeOrderStatus('', 'cancelado')],
    ['registerOrderPayment', () => registerOrderPayment('', vacio, '')],
    ['deliverOrder', () => deliverOrder('', null, '')],
    // Alivios de caja (migration 0044).
    ['registerRelief', () => registerRelief(vacio, '')],
    ['markReliefsPickedUp', () => markReliefsPickedUp([])],
  ];

  describe('🔴 la contadora NO escribe, y el rechazo llega antes que la validación', () => {
    for (const [nombre, fn] of MUTACIONES) {
      it(nombre, async () => {
        await expect(como(contadora, fn)).rejects.toThrow(SoloLecturaError);
      });
    }
  });

  describe('🔴 un usuario SIN membresía tampoco', () => {
    for (const [nombre, fn] of MUTACIONES) {
      it(nombre, async () => {
        await expect(como(nadie, fn)).rejects.toThrow(SoloLecturaError);
      });
    }
  });

  it('🔴 soporte es persona y es read-only (§7.8)', async () => {
    await expect(como(duenia, () => createProduct(vacio), 'support')).rejects.toThrow(
      SoloLecturaError
    );
  });

  // ── La mitad que se olvida ────────────────────────────────────────────

  it('🔴 la dueña SIGUE escribiendo: la guardia no le trabó el comercio', async () => {
    const p = await como(duenia, () =>
      createProduct({ name: 'Yerba', price: '1000', tax_rate: '21', sku: `ROL-${tenant.slice(0, 6)}` } as never)
    );
    expect(p.id).toBeTruthy();

    const g = await como(duenia, () =>
      registerExpense({
        fecha: '2026-03-10',
        categoria: 'servicios',
        neto: '1000',
        iva: '210',
        total: '1210',
        payee_name: 'Edenor',
        comprobante_tipo: 'B',
        comprobante_numero: '0001-00000001',
        en_iva_compras: true,
        medio_pago: 'transferencia',
      })
    );
    expect(g.id).toBeTruthy();
  });

  it('🔴 un actor que no es persona pasa: el webhook tiene su propia puerta', async () => {
    // `system` con un input vacío: si la guardia lo dejara pasar, lo que sale
    // es el error de VALIDACIÓN, no SoloLecturaError. Es la prueba de que la
    // guardia no frena al sistema.
    await expect(como(duenia, () => createProduct(vacio), 'system')).rejects.not.toThrow(
      SoloLecturaError
    );
  });
});
