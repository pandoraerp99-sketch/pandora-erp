/**
 * T-INV-05 — Trigger immutable bloquea UPDATE/DELETE/TRUNCATE en stock_movements.
 * Sprint 3 ROADMAP Inventory + CLAUDE.md §16.5 append-only.
 *
 * **Verifica:**
 * - Trigger `stock_movements_no_update` bloquea UPDATE (ERRCODE check_violation)
 * - Trigger `stock_movements_no_delete` bloquea DELETE
 * - Trigger `stock_movements_no_truncate` bloquea TRUNCATE
 * - Mensaje de error incluye 'INSERT-only' + 'movimiento inverso'
 *   (orientación al operator para hacer cancelación correcta)
 *
 * **Por qué CRÍTICO:** Si el trigger NO funcionara, alguien podría UPDATE/DELETE
 * stock_movements y romper auditabilidad. CLAUDE.md §16.5 marca stock_movements
 * como append-only — cancelación de movimiento = INSERT inverso (return/adjustment),
 * NUNCA UPDATE/DELETE del original.
 *
 * **NOTA cleanup:** el test usa `session_replication_role = 'replica'` durante
 * cleanup para bypassear el mismo trigger que está testeando. Esto NO invalida
 * el test — el trigger funciona en runtime normal, solo se desactiva
 * explícitamente para teardown (mismo PG escape hatch que T-INV-04).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { audit_log } from '@/lib/db/schema/audit';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { recordStockMovement } from '@/lib/inventory/stock';

describe('T-INV-05 — Trigger immutable bloquea mutations en stock_movements', () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  let insertedMovementId: bigint;

  beforeAll(async () => {
    // Seed mínimo (similar a T-INV-04 pero sin sales)
    await db.insert(companies).values({
      id: tenantId,
      name: 'T-INV-05 Test Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });

    await db.insert(users).values({
      id: userId,
      email: `t-inv-05-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Operator Test',
      is_support: false,
    });

    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });

    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Producto T-INV-05',
      unit_type: 'unidad',
      price: '100.0000',
      tax_rate: '21.00',
      stock_current: '50.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });

    // Insertar un stock_movement válido via recordStockMovement (adjustment con reason).
    const result = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        recordStockMovement({
          product_id: productId,
          type: 'adjustment',
          qty: 5,
          reason: 'recuento inicial T-INV-05',
          direction: 'in',
        })
    );
    insertedMovementId = result.movement.id;
  });

  // Drizzle envuelve PgError en un Error wrapper; el original PgError vive
  // en `.cause`. Helper para extraer code + message del error subyacente.
  function unwrapPgError(e: unknown): { code?: string; message: string } {
    if (e && typeof e === 'object') {
      const err = e as { message?: string; code?: string; cause?: unknown };
      const cause = err.cause as { code?: string; message?: string } | undefined;
      return {
        code: cause?.code ?? err.code,
        message: cause?.message ?? err.message ?? String(e),
      };
    }
    return { message: String(e) };
  }

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('UPDATE en stock_movements → throw con código check_violation + mensaje "INSERT-only"', async () => {
    let caught: Error | null = null;
    try {
      await db
        .update(stock_movements)
        .set({ reason: 'tampered post-hoc' })
        .where(eq(stock_movements.id, insertedMovementId));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    const pgErr = unwrapPgError(caught);
    expect(pgErr.message).toMatch(/INSERT-only/);
    expect(pgErr.message).toMatch(/movimiento inverso/);
    // PG ERRCODE 23514 = check_violation (RAISE EXCEPTION ... USING ERRCODE = 'check_violation')
    expect(pgErr.code).toBe('23514');
  });

  it('DELETE en stock_movements → throw con código check_violation', async () => {
    let caught: Error | null = null;
    try {
      await db
        .delete(stock_movements)
        .where(eq(stock_movements.id, insertedMovementId));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    const pgErr = unwrapPgError(caught);
    expect(pgErr.message).toMatch(/INSERT-only/);
    expect(pgErr.code).toBe('23514');
  });

  it('TRUNCATE en stock_movements → throw con código check_violation', async () => {
    let caught: Error | null = null;
    try {
      await db.execute(sql`TRUNCATE TABLE stock_movements`);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    const pgErr = unwrapPgError(caught);
    expect(pgErr.message).toMatch(/INSERT-only/);
    expect(pgErr.code).toBe('23514');
  });

  it('INSERT (movimiento inverso) sigue funcionando — append-only NO bloquea inserts', async () => {
    // Validación positiva: el trigger NO bloquea INSERTs (es append-only,
    // no read-only). El INSERT canceladora es el patrón canónico para
    // "revertir" un movimiento anterior.
    const reverseResult = await withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: 'user',
      },
      () =>
        recordStockMovement({
          product_id: productId,
          type: 'adjustment',
          qty: 5,
          reason: 'reverso del recuento inicial T-INV-05 (cancelación)',
          direction: 'out',
        })
    );
    expect(reverseResult.movement.type).toBe('adjustment');
    expect(reverseResult.movement.qty).toBe('5.0000');
  });
});
