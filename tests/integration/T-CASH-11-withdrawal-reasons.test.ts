/**
 * T-CASH-11 — Catálogo de motivos de retiro (cash_withdrawal_reasons).
 *
 * Valida:
 *   - owner: crear / renombrar / dar de baja (soft-delete) funciona.
 *   - cashier / accountant: RECHAZADOS (boundary owner-only, server-side).
 *   - baja lógica: el motivo desaparece de la lista activa pero la fila persiste.
 *   - tenant scope: los motivos de un tenant no se ven desde otro.
 *
 * Patrón: sigue T-CASH-10 (seed/cleanup por test).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { cash_withdrawal_reasons } from '@/lib/db/schema/cash_withdrawal_reasons';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  listWithdrawalReasons,
  createWithdrawalReason,
  updateWithdrawalReason,
  deactivateWithdrawalReason,
  ReasonAuthorizationError,
} from '@/lib/cash/reasons';

describe('T-CASH-11 — Catálogo de motivos de retiro (owner-only)', () => {
  let tenantId: string;
  let userId: string;

  // `withTracingContext` devuelve `T | Promise<T>` (acepta fn sincronas), asi
  // que hay que envolverlo para tipar el await.
  const ctxFor = <T,>(tid: string, uid: string, fn: () => Promise<T>): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid,
          actor_user_id: uid,
          actor_type: 'user',
        },
        fn
      )
    );
  const withCtx = <T,>(fn: () => Promise<T>): Promise<T> => ctxFor(tenantId, userId, fn);

  const seedTenant = async (tid: string, uid: string) => {
    await db.insert(companies).values({
      id: tid,
      name: 'T-CASH-11 Co',
      legal_name: 'T-CASH-11 Co SRL',
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
      email: `t-cash-11-${tid.slice(0, 8)}@test.local`,
      full_name: 'User T-CASH-11',
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
    await db.delete(cash_withdrawal_reasons).where(eq(cash_withdrawal_reasons.tenant_id, tid));
    await db.delete(company_users).where(eq(company_users.company_id, tid));
    await db.delete(users).where(eq(users.id, uid));
    await db.delete(companies).where(eq(companies.id, tid));
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    await seedTenant(tenantId, userId);
  });

  afterEach(async () => {
    await cleanupTenant(tenantId, userId);
  });

  it('owner: crea, lista, renombra y da de baja (soft-delete)', async () => {
    const created = await withCtx(() =>
      createWithdrawalReason({ label: 'Pago de servicios' }, 'owner')
    );
    expect(created.label).toBe('Pago de servicios');
    expect(created.is_active).toBe(true);

    let list = await withCtx(() => listWithdrawalReasons());
    expect(list.map((r) => r.label)).toContain('Pago de servicios');

    await withCtx(() =>
      updateWithdrawalReason({ id: created.id, label: 'Pago de servicios públicos' }, 'owner')
    );
    list = await withCtx(() => listWithdrawalReasons());
    expect(list.find((r) => r.id === created.id)?.label).toBe('Pago de servicios públicos');

    await withCtx(() => deactivateWithdrawalReason({ id: created.id }, 'owner'));
    list = await withCtx(() => listWithdrawalReasons());
    expect(list.find((r) => r.id === created.id)).toBeUndefined();

    // Soft-delete: la fila persiste con is_active=false (histórico intacto).
    const rows = await db
      .select()
      .from(cash_withdrawal_reasons)
      .where(eq(cash_withdrawal_reasons.id, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_active).toBe(false);
  });

  it('cashier / accountant / admin: NO pueden crear, renombrar ni dar de baja', async () => {
    const seed = await withCtx(() => createWithdrawalReason({ label: 'Motivo X' }, 'owner'));

    await expect(
      withCtx(() => createWithdrawalReason({ label: 'Hackeo' }, 'cashier'))
    ).rejects.toBeInstanceOf(ReasonAuthorizationError);

    await expect(
      withCtx(() => updateWithdrawalReason({ id: seed.id, label: 'Cambiado' }, 'cashier'))
    ).rejects.toBeInstanceOf(ReasonAuthorizationError);

    await expect(
      withCtx(() => deactivateWithdrawalReason({ id: seed.id }, 'accountant'))
    ).rejects.toBeInstanceOf(ReasonAuthorizationError);

    await expect(
      withCtx(() => createWithdrawalReason({ label: 'Admin no' }, 'admin'))
    ).rejects.toBeInstanceOf(ReasonAuthorizationError);

    // El motivo original quedó intacto (ningún cambio pasó).
    const list = await withCtx(() => listWithdrawalReasons());
    expect(list.find((r) => r.id === seed.id)?.label).toBe('Motivo X');
  });

  it('tenant scope: los motivos de un tenant no se ven desde otro', async () => {
    await withCtx(() => createWithdrawalReason({ label: 'Solo de A' }, 'owner'));

    const otherTenant = crypto.randomUUID();
    const otherUser = crypto.randomUUID();
    await seedTenant(otherTenant, otherUser);
    try {
      const listB = await ctxFor(otherTenant, otherUser, () => listWithdrawalReasons());
      expect(listB.map((r) => r.label)).not.toContain('Solo de A');
    } finally {
      await cleanupTenant(otherTenant, otherUser);
    }
  });
});
