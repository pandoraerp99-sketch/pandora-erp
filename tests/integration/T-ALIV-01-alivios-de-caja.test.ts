/**
 * T-ALIV-01 — alivios de caja (migration 0044).
 *
 * Un alivio es un RETIRO para el arqueo (resta del esperado) más una marca
 * que dice que fue un alivio; después alguien lo retira. Se prueba por el
 * camino real: registerRelief → computeCashBreakdown / closeCashSession.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { cash_movements } from '@/lib/db/schema/cash_movements';
import { cash_reliefs, cash_relief_pickups } from '@/lib/db/schema/cash_reliefs';
import { idempotency_log } from '@/lib/db/schema/idempotency_log';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { closeCashSession, computeCashBreakdown, openCashSession } from '@/lib/cash/sessions';
import { listReliefsForSession, markReliefsPickedUp, registerRelief } from '@/lib/cash/reliefs';

const INICIAL = '50000.00';

async function crearComercio(etiqueta: string) {
  const tenantId = crypto.randomUUID();
  const duenia = crypto.randomUUID();
  const cajero = crypto.randomUUID();
  const encargado = crypto.randomUUID();
  await db.insert(companies).values({
    id: tenantId,
    name: `T-ALIV-01 ${etiqueta}`,
    legal_name: `T-ALIV-01 ${etiqueta} SRL`,
    cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
    tax_regime: 'responsable_inscripto',
    merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
    merchant_special_regime: null,
    afip_environment: 'homologacion',
    afip_sale_point: '0001',
    demo_status: 'trial',
  });
  for (const [id, nombre, rol] of [
    [duenia, 'Dueña', 'owner'],
    [cajero, 'Mateo Giordano', 'cashier'],
    [encargado, 'Encargado', 'admin'],
  ] as const) {
    await db.insert(users).values({ id, email: `t-aliv-${id.slice(0, 8)}@test.local`, full_name: nombre, is_support: false });
    await db.insert(company_users).values({ id: crypto.randomUUID(), company_id: tenantId, user_id: id, role: rol });
  }
  return { tenantId, duenia, cajero, encargado };
}

async function borrar(c: { tenantId: string; duenia: string; cajero: string; encargado: string }) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
    await tx.delete(cash_relief_pickups).where(eq(cash_relief_pickups.tenant_id, c.tenantId));
    await tx.delete(cash_reliefs).where(eq(cash_reliefs.tenant_id, c.tenantId));
    await tx.execute(sql`DELETE FROM cash_movements WHERE cash_session_id IN (SELECT id FROM cash_sessions WHERE tenant_id = ${c.tenantId})`);
    await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, c.tenantId));
    await tx.delete(idempotency_log).where(eq(idempotency_log.tenant_id, c.tenantId));
    await tx.delete(audit_log).where(eq(audit_log.tenant_id, c.tenantId));
    await tx.delete(company_users).where(eq(company_users.company_id, c.tenantId));
    await tx.execute(sql`DELETE FROM users WHERE id IN (${c.duenia}, ${c.cajero}, ${c.encargado})`);
    await tx.delete(companies).where(eq(companies.id, c.tenantId));
  });
}

describe('T-ALIV-01 — alivios de caja', () => {
  let A: Awaited<ReturnType<typeof crearComercio>>;
  let B: Awaited<ReturnType<typeof crearComercio>>;

  const como = <T,>(tenantId: string, userId: string, rol: string, fn: () => Promise<T>) =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
          actor_role: rol,
        },
        fn
      )
    );
  const cajero = <T,>(fn: () => Promise<T>) => como(A.tenantId, A.cajero, 'cashier', fn);
  const duenia = <T,>(fn: () => Promise<T>) => como(A.tenantId, A.duenia, 'owner', fn);

  beforeEach(async () => {
    A = await crearComercio('A');
    B = await crearComercio('B');
  });
  afterEach(async () => {
    await borrar(A);
    await borrar(B);
  });

  it('un alivio es un retiro: resta del esperado y el cierre da cero', async () => {
    const caja = await cajero(() => openCashSession({ sale_point: 1, initial_amount: INICIAL }));
    await cajero(() => registerRelief({ cash_session_id: caja.id, amount: '18000' }, crypto.randomUUID()));

    const movs = await db.select().from(cash_movements).where(eq(cash_movements.cash_session_id, caja.id));
    expect(movs.length).toBe(1);
    expect(movs[0]!.type).toBe('withdraw');
    expect(movs[0]!.reason).toBe('Alivio de caja');

    const d = await computeCashBreakdown(db, caja.id, A.tenantId, INICIAL);
    expect(d.withdraws).toBe('18000.0000');
    expect(d.expected).toBe('32000.0000');
    const cierre = await duenia(() => closeCashSession({ session_id: caja.id, counted_amount: '32000.00' }));
    expect(Number(cierre.descuadre)).toBe(0);
  });

  it('doble click en registrar: misma clave, UN alivio y UN retiro', async () => {
    const caja = await cajero(() => openCashSession({ sale_point: 1, initial_amount: INICIAL }));
    const key = crypto.randomUUID();
    await Promise.allSettled([
      cajero(() => registerRelief({ cash_session_id: caja.id, amount: '5000' }, key)),
      cajero(() => registerRelief({ cash_session_id: caja.id, amount: '5000' }, key)),
    ]);
    await cajero(() => registerRelief({ cash_session_id: caja.id, amount: '5000' }, key));
    expect((await db.select().from(cash_reliefs).where(eq(cash_reliefs.tenant_id, A.tenantId))).length).toBe(1);
    expect((await db.select().from(cash_movements).where(eq(cash_movements.cash_session_id, caja.id))).length).toBe(1);
  });

  it('marcar retirado: ni el cajero ni el encargado pueden; la dueña sí, una sola vez', async () => {
    const caja = await cajero(() => openCashSession({ sale_point: 1, initial_amount: INICIAL }));
    const r = await cajero(() => registerRelief({ cash_session_id: caja.id, amount: '25000' }, crypto.randomUUID()));

    await expect(cajero(() => markReliefsPickedUp([r.relief_id]))).rejects.toThrow(/Sólo la dueña/);
    // Regla del owner (2026-11-18): el encargado TAMPOCO.
    await expect(
      como(A.tenantId, A.encargado, 'admin', () => markReliefsPickedUp([r.relief_id]))
    ).rejects.toThrow(/Sólo la dueña/);

    expect((await duenia(() => markReliefsPickedUp([r.relief_id]))).marcados).toBe(1);
    // Doble click: no-op, no error y no duplica.
    expect((await duenia(() => markReliefsPickedUp([r.relief_id]))).marcados).toBe(0);

    const lista = await duenia(() => listReliefsForSession(caja.id));
    expect(lista.length).toBe(1);
    expect(lista[0]!.picked_por).toBe('Dueña');
    expect(lista[0]!.por).toBe('Mateo Giordano');
    // Retirar no mueve la caja: la plata ya había salido con el alivio.
    expect((await computeCashBreakdown(db, caja.id, A.tenantId, INICIAL)).expected).toBe('25000.0000');
  });

  it('la lista: pendientes primero; un pendiente de una caja ANTERIOR sigue apareciendo', async () => {
    const vieja = await cajero(() => openCashSession({ sale_point: 1, initial_amount: INICIAL }));
    const pendViejo = await cajero(() => registerRelief({ cash_session_id: vieja.id, amount: '15000' }, crypto.randomUUID()));
    const retViejo = await cajero(() => registerRelief({ cash_session_id: vieja.id, amount: '30000' }, crypto.randomUUID()));
    await duenia(() => markReliefsPickedUp([retViejo.relief_id]));
    await duenia(() => closeCashSession({ session_id: vieja.id, counted_amount: '5000.00' }));

    const nueva = await cajero(() => openCashSession({ sale_point: 1, initial_amount: INICIAL }));
    const pendNuevo = await cajero(() => registerRelief({ cash_session_id: nueva.id, amount: '18000' }, crypto.randomUUID()));
    const retNuevo = await cajero(() => registerRelief({ cash_session_id: nueva.id, amount: '12000' }, crypto.randomUUID()));
    await duenia(() => markReliefsPickedUp([retNuevo.relief_id]));

    const ids = (await cajero(() => listReliefsForSession(nueva.id))).map((f) => f.id);
    // Pendientes (viejo y nuevo) y el retirado de esta caja; el retirado de la vieja ya no.
    expect(ids).toEqual([pendViejo.relief_id, pendNuevo.relief_id, retNuevo.relief_id]);
  });

  it('inmutable en la base, y aislado entre comercios', async () => {
    const caja = await cajero(() => openCashSession({ sale_point: 1, initial_amount: INICIAL }));
    const r = await cajero(() => registerRelief({ cash_session_id: caja.id, amount: '1000' }, crypto.randomUUID()));
    await duenia(() => markReliefsPickedUp([r.relief_id]));
    await expect(db.delete(cash_reliefs).where(eq(cash_reliefs.id, r.relief_id))).rejects.toThrow();
    await expect(db.delete(cash_relief_pickups).where(eq(cash_relief_pickups.relief_id, r.relief_id))).rejects.toThrow();

    // B no ve los alivios de A ni puede marcarlos.
    expect(await como(B.tenantId, B.duenia, 'owner', () => listReliefsForSession(caja.id))).toEqual([]);
    await expect(
      como(B.tenantId, B.duenia, 'owner', () => markReliefsPickedUp([r.relief_id]))
    ).rejects.toThrow(/no existe/);
    // B tampoco puede colgar un alivio de la caja de A.
    await expect(
      como(B.tenantId, B.cajero, 'cashier', () => registerRelief({ cash_session_id: caja.id, amount: '10' }, crypto.randomUUID()))
    ).rejects.toThrow();
  });
});
