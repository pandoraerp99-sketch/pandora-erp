/**
 * T-INV-07 — Multi-tenant isolation cross-tenant (service-side guard).
 * Sprint 3 ROADMAP Inventory + CLAUDE.md §7.2 (defense in depth).
 *
 * **Scope F0 — capa 2 (service-side):** este test valida que `findProductById`
 * + `recordStockMovement` filtran por `tenant_id` del tracing context y NO
 * permiten ver/modificar recursos de otro tenant.
 *
 * **Scope diferido (capa 1 RLS Postgres):** la RLS DB-level requiere conectar
 * como Postgres role `authenticated` con JWT seteando `auth.jwt() ->> 'company_id'`.
 * El cliente Drizzle de tests usa el role `postgres` superuser que bypassea
 * RLS por default. Test RLS dedicado pendiente cuando Sprint 2 Identity
 * (JWT setup) cierre — registrado en INTEGRATION-TODO.md.
 *
 * **Filosofía CLAUDE.md §7.2 (defense in depth):**
 *   capa 1 = RLS Postgres
 *   capa 2 = service-side validation (esta es la que probamos acá)
 *   capa 3 = tests cross-tenant (este test)
 * Las 3 capas son redundantes a propósito — si una falla, las otras protegen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { audit_log } from '@/lib/db/schema/audit';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  findProductById,
  recordStockMovement,
  ProductNotFoundForMovementError,
} from '@/lib/inventory';

describe('T-INV-07 — Service-side cross-tenant isolation', () => {
  // 2 tenants distintos + 1 producto por tenant + 1 user por tenant.
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const productA = crypto.randomUUID();
  const productB = crypto.randomUUID();

  beforeAll(async () => {
    for (const [tid, uid, pid, label] of [
      [tenantA, userA, productA, 'A'],
      [tenantB, userB, productB, 'B'],
    ] as const) {
      await db.insert(companies).values({
        id: tid,
        name: `T-INV-07 Co ${label}`,
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      });
      await db.insert(users).values({
        id: uid,
        email: `t-inv-07-${label.toLowerCase()}-${tid.slice(0, 8)}@test.local`,
        full_name: `User ${label}`,
        is_support: false,
      });
      await db.insert(company_users).values({
        id: crypto.randomUUID(),
        company_id: tid,
        user_id: uid,
        role: 'owner',
      });
      await db.insert(products).values({
        id: pid,
        tenant_id: tid,
        name: `Producto del tenant ${label}`,
        unit_type: 'unidad',
        price: '100.0000',
        tax_rate: '21.00',
        stock_current: '10.0000',
        stock_tracking_enabled: true,
        is_active: true,
      });
    }
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      for (const tid of [tenantA, tenantB]) {
        await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tid));
        await tx.delete(audit_log).where(eq(audit_log.tenant_id, tid));
        await tx.delete(products).where(eq(products.tenant_id, tid));
        await tx.delete(company_users).where(eq(company_users.company_id, tid));
        await tx.delete(companies).where(eq(companies.id, tid));
      }
      for (const uid of [userA, userB]) {
        await tx.delete(users).where(eq(users.id, uid));
      }
    });
  });

  it('Tenant A puede leer su propio producto (findProductById)', async () => {
    const found = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantA,
        actor_user_id: userA,
        actor_type: 'user',
      },
      () => findProductById(productA)
    );
    expect(found).not.toBeNull();
    expect(found?.id).toBe(productA);
    expect(found?.name).toBe('Producto del tenant A');
  });

  it('Tenant B NO puede leer producto del tenant A (findProductById → null)', async () => {
    // tenant B intenta acceder al producto de A. El service hace
    // WHERE id=$1 AND tenant_id=$tenantB → 0 rows → null.
    const found = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantB,
        actor_user_id: userB,
        actor_type: 'user',
      },
      () => findProductById(productA)
    );
    expect(found).toBeNull();
  });

  it('Tenant B NO puede modificar stock del producto A (recordStockMovement → ProductNotFoundForMovementError)', async () => {
    // SELECT FOR UPDATE en `recordStockMovement` hace WHERE id=$1 AND tenant_id=$tenantB.
    // El producto A NO existe en tenant B → lockedRows vacío → throw.
    await expect(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantB,
          actor_user_id: userB,
          actor_type: 'user',
        },
        () =>
          recordStockMovement({
            product_id: productA,
            type: 'adjustment',
            qty: 1,
            reason: 'intento cross-tenant malicioso',
            direction: 'out',
          })
      )
    ).rejects.toThrow(ProductNotFoundForMovementError);
  });

  it('Verificación DB: stock del producto A intacto (tenant B no pudo mover nada)', async () => {
    // Validación bonus directa contra DB: nadie cambió el stock_current de A.
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productA), eq(products.tenant_id, tenantA)))
      .limit(1);
    expect(rows[0]?.stock_current).toBe('10.0000');
  });

  it('Verificación DB: 0 stock_movements en tenant B (intento bloqueado en service layer)', async () => {
    const movs = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.tenant_id, tenantB));
    expect(movs).toHaveLength(0);
  });
});
