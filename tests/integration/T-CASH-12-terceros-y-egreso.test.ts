/**
 * T-CASH-12 — Terceros (beneficiarios) + egreso de caja estructurado.
 *
 * Valida:
 *   - terceros CRUD (owner) + gate (cashier rechazado) + tenant scope + soft-delete.
 *   - cash_withdrawal_reasons.beneficiario_tipo en create/update.
 *   - registerCashMovement estructurado: concept_id + payee_id (catálogo) persisten;
 *     "Otro" → payee_id null + payee_name snapshot.
 *
 * Patrón: sigue T-CASH-11 (seed/cleanup por test).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { cash_withdrawal_reasons } from '@/lib/db/schema/cash_withdrawal_reasons';
import { terceros } from '@/lib/db/schema/terceros';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { openCashSession } from '@/lib/cash/sessions';
import { registerCashMovement } from '@/lib/cash/movements';
import {
  createWithdrawalReason,
  updateWithdrawalReason,
  listWithdrawalReasons,
} from '@/lib/cash/reasons';
import {
  listTerceros,
  createTercero,
  updateTercero,
  deactivateTercero,
  TerceroAuthorizationError,
} from '@/lib/cash/terceros';

describe('T-CASH-12 — Terceros + egreso estructurado', () => {
  let tenantId: string;
  let userId: string;

  const ctxFor = <T,>(tid: string, uid: string, fn: () => Promise<T>): Promise<T> =>
    withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tid,
        actor_user_id: uid,
        actor_type: 'user',
      },
      fn
    );
  const withCtx = <T,>(fn: () => Promise<T>): Promise<T> => ctxFor(tenantId, userId, fn);

  const seedTenant = async (tid: string, uid: string) => {
    await db.insert(companies).values({
      id: tid,
      name: 'T-CASH-12 Co',
      legal_name: 'T-CASH-12 Co SRL',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: uid,
      email: `t-cash-12-${tid.slice(0, 8)}@test.local`,
      full_name: 'User T-CASH-12',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tid,
      user_id: uid,
      role: 'owner',
    });
  };

  const cleanupTenant = async (tid: string, uid: string) => {
    await db.transaction(async (tx) => {
      // cash_movements es append-only (trigger) → replica role para poder borrar.
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.execute(
        sql`DELETE FROM cash_movements WHERE cash_session_id IN (SELECT id FROM cash_sessions WHERE tenant_id = ${tid})`
      );
      await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tid));
      await tx.delete(terceros).where(eq(terceros.tenant_id, tid));
      await tx.delete(cash_withdrawal_reasons).where(eq(cash_withdrawal_reasons.tenant_id, tid));
      await tx.delete(company_users).where(eq(company_users.company_id, tid));
      await tx.delete(users).where(eq(users.id, uid));
      await tx.delete(companies).where(eq(companies.id, tid));
    });
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    await seedTenant(tenantId, userId);
  });

  afterEach(async () => {
    await cleanupTenant(tenantId, userId);
  });

  it('terceros: owner crea/renombra/baja; cajero rechazado; tenant scope', async () => {
    const emp = await withCtx(() => createTercero({ type: 'empleado', name: 'Juana' }, 'owner'));
    expect(emp.type).toBe('empleado');
    expect(emp.is_active).toBe(true);

    // cajero NO puede
    await expect(
      withCtx(() => createTercero({ type: 'proveedor', name: 'Hack' }, 'cashier'))
    ).rejects.toBeInstanceOf(TerceroAuthorizationError);
    await expect(
      withCtx(() => updateTercero({ id: emp.id, name: 'X' }, 'cashier'))
    ).rejects.toBeInstanceOf(TerceroAuthorizationError);
    await expect(
      withCtx(() => deactivateTercero({ id: emp.id }, 'accountant'))
    ).rejects.toBeInstanceOf(TerceroAuthorizationError);

    // rename + doc
    await withCtx(() => updateTercero({ id: emp.id, name: 'Juana Pérez', doc: '27111111119' }, 'owner'));
    let empleados = await withCtx(() => listTerceros('empleado'));
    expect(empleados.find((t) => t.id === emp.id)?.name).toBe('Juana Pérez');
    expect(empleados.find((t) => t.id === emp.id)?.doc).toBe('27111111119');

    // listTerceros filtra por tipo
    const prov = await withCtx(() => createTercero({ type: 'proveedor', name: 'Distribuidora X' }, 'owner'));
    empleados = await withCtx(() => listTerceros('empleado'));
    const proveedores = await withCtx(() => listTerceros('proveedor'));
    expect(empleados.map((t) => t.id)).not.toContain(prov.id);
    expect(proveedores.map((t) => t.id)).toContain(prov.id);

    // soft-delete
    await withCtx(() => deactivateTercero({ id: emp.id }, 'owner'));
    empleados = await withCtx(() => listTerceros('empleado'));
    expect(empleados.find((t) => t.id === emp.id)).toBeUndefined();
    const rows = await db.select().from(terceros).where(eq(terceros.id, emp.id));
    expect(rows[0]!.is_active).toBe(false);

    // tenant scope
    const otherTenant = crypto.randomUUID();
    const otherUser = crypto.randomUUID();
    await seedTenant(otherTenant, otherUser);
    try {
      const listB = await ctxFor(otherTenant, otherUser, () => listTerceros('proveedor'));
      expect(listB.map((t) => t.id)).not.toContain(prov.id);
    } finally {
      await cleanupTenant(otherTenant, otherUser);
    }
  });

  it('reason.beneficiario_tipo: se setea en create y se cambia en update', async () => {
    const r = await withCtx(() =>
      createWithdrawalReason({ label: 'Pago de flete', beneficiario_tipo: 'proveedor' }, 'owner')
    );
    expect(r.beneficiario_tipo).toBe('proveedor');

    await withCtx(() =>
      updateWithdrawalReason({ id: r.id, label: 'Pago de flete', beneficiario_tipo: 'ninguno' }, 'owner')
    );
    const list = await withCtx(() => listWithdrawalReasons());
    expect(list.find((x) => x.id === r.id)?.beneficiario_tipo).toBe('ninguno');
  });

  it('egreso estructurado: concepto + beneficiario del catálogo persisten', async () => {
    const session = await withCtx(() => openCashSession({ sale_point: 1, initial_amount: '1000.0000' }));
    const concept = await withCtx(() =>
      createWithdrawalReason({ label: 'Pago de proveedor', beneficiario_tipo: 'proveedor' }, 'owner')
    );
    const prov = await withCtx(() => createTercero({ type: 'proveedor', name: 'Distribuidora X' }, 'owner'));

    const mov = await withCtx(() =>
      registerCashMovement({
        cash_session_id: session.id,
        type: 'provider_payment',
        amount: '500.0000',
        reason: concept.label,
        concept_id: concept.id,
        payee_id: prov.id,
        payee_type: 'proveedor',
        payee_name: prov.name,
        notes: 'factura 123',
      })
    );
    expect(mov.reason).toBe('Pago de proveedor');
    expect(mov.concept_id).toBe(concept.id);
    expect(mov.payee_id).toBe(prov.id);
    expect(mov.payee_type).toBe('proveedor');
    expect(mov.payee_name).toBe('Distribuidora X');
    expect(mov.notes).toBe('factura 123');
  });

  it('egreso "Otro": payee_id null + payee_name snapshot (no crea tercero)', async () => {
    const session = await withCtx(() => openCashSession({ sale_point: 1, initial_amount: '1000.0000' }));
    const concept = await withCtx(() =>
      createWithdrawalReason({ label: 'Pago de sueldo', beneficiario_tipo: 'empleado' }, 'owner')
    );

    const mov = await withCtx(() =>
      registerCashMovement({
        cash_session_id: session.id,
        type: 'provider_payment',
        amount: '800.0000',
        reason: concept.label,
        concept_id: concept.id,
        payee_id: null,
        payee_type: 'empleado',
        payee_name: 'Changuito de la esquina',
        notes: null,
      })
    );
    expect(mov.payee_id).toBeNull();
    expect(mov.payee_name).toBe('Changuito de la esquina');

    // "Otro" NO creó una fila en terceros.
    const empleados = await withCtx(() => listTerceros('empleado'));
    expect(empleados.map((t) => t.name)).not.toContain('Changuito de la esquina');
  });
});
