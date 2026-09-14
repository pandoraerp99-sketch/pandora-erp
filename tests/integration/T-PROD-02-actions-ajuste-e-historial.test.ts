/**
 * T-PROD-02 — Las server actions del ajuste y del historial, de punta a punta.
 *
 * Los services ya están probados (T-INV-10, T-INV-13). Lo que se prueba acá es
 * la puerta que usa la pantalla: que la sesión monte el tenant, que un ajuste
 * rechazado vuelva como MENSAJE en el campo que corresponde (no como excepción
 * sin manejar), y que el historial llegue con el ajuste recién hecho.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { audit_log } from '@/lib/db/schema/audit';

const tenant = crypto.randomUUID();
const otroTenant = crypto.randomUUID();
const user = crypto.randomUUID();
const leche = crypto.randomUUID();

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

import { adjustStockAction, getHistorialAction } from '@/app/productos/actions';

const sesionDe = (companyId: string) => ({
  user_id: user,
  email: 'ajusta@test.local',
  active_company_id: companyId,
  available_company_ids: [companyId],
  app_role: 'authenticated',
  is_support: false,
  access_token: 'x',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
});

describe('T-PROD-02 — actions de ajuste e historial', () => {
  beforeAll(async () => {
    for (const [id, n] of [
      [tenant, 1],
      [otroTenant, 2],
    ] as const) {
      await db.insert(companies).values({
        id,
        name: `T-PROD-02 Co ${n}`,
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      });
    }
    await db.insert(users).values({
      id: user,
      email: `t-prod-02-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Quien ajusta',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenant,
      user_id: user,
      role: 'owner',
    });
    await db.insert(products).values({
      id: leche,
      tenant_id: tenant,
      name: 'Leche 1L',
      unit_type: 'unidad',
      price: '1500.0000',
      tax_rate: '21.00',
      stock_current: '12.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });
    mocks.session = sesionDe(tenant);
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenant));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenant));
      await tx.delete(products).where(eq(products.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(eq(companies.id, tenant));
      await tx.delete(companies).where(eq(companies.id, otroTenant));
    });
  });

  it('un vencimiento de 3 baja el stock y vuelve el producto actualizado', async () => {
    const res = await adjustStockAction({
      productId: leche,
      delta: '-3',
      motivo: 'vencimiento',
      detalle: 'lote del lunes',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.stock_current).toBe('9.0000');
  });

  it('🔴 una merma que suma vuelve como mensaje EN EL CAMPO, no como excepción', async () => {
    const res = await adjustStockAction({ productId: leche, delta: '2', motivo: 'rotura' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fieldErrors?.delta).toMatch(/merma/i);
    }
  });

  it('🔴 dejar el stock en negativo vuelve como mensaje, no como excepción', async () => {
    const res = await adjustStockAction({ productId: leche, delta: '-50', motivo: 'recuento' });
    expect(res.ok).toBe(false);
  });

  it('el historial trae el ajuste recién hecho, con su motivo', async () => {
    const res = await getHistorialAction(leche);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.total).toBe(1);
      expect(res.data.movimientos[0]).toMatchObject({
        type: 'loss',
        motivo: 'vencimiento',
        origen: 'Vencimiento · lote del lunes',
        quien: 'Quien ajusta',
      });
    }
  });

  it('🔴 con la sesión en otro comercio, el historial viene vacío', async () => {
    mocks.session = sesionDe(otroTenant);
    try {
      const res = await getHistorialAction(leche);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data.movimientos).toHaveLength(0);
    } finally {
      mocks.session = sesionDe(tenant);
    }
  });
});
