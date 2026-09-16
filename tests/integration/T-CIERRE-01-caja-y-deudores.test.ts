/**
 * T-CIERRE-01 — Caja y deudores **a la fecha de cierre** (ítems 1 y 5).
 *
 * Los estados ya se prueban puros en `tests/unit/caja-al-cierre.test.ts`. Lo
 * que sólo se rompe con la base de por medio:
 *
 *  1. El saldo de caja es el ÚLTIMO arqueo de cada punto de venta, no la suma
 *     de todos los turnos del período.
 *  2. Un cierre posterior a la fecha no entra, aunque sea el más fresco.
 *  3. Una caja abierta al cierre sale SIN monto, incluso si se contó después.
 *  4. El borde del día: un cierre de las 22:00 del 31/07 en Ushuaia es del
 *     31/07 — con la medianoche UTC caería en agosto y se perdería.
 *  5. El saldo de un deudor al cierre ES DISTINTO del de hoy cuando hay
 *     movimientos de los dos lados del corte.
 *
 * Que la base de dev tenga cero deudores es justamente por qué esto va acá: una
 * pantalla verde con la lista vacía no prueba nada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { customers } from '@/lib/db/schema/customers';
import { customer_account_movements } from '@/lib/db/schema/customer_account';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { sales } from '@/lib/db/schema/sales';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  armarCsvCaja,
  armarCsvDeudores,
  getCajaAlCierre,
  getDeudoresAlCierre,
} from '@/lib/services/reporting/cierre.report';

describe('T-CIERRE-01 — caja y deudores a la fecha de cierre', () => {
  const tenant = crypto.randomUUID();
  const user = crypto.randomUUID();
  const rosa = crypto.randomUUID();
  const luis = crypto.randomUUID();
  const pagador = crypto.randomUUID();
  const CIERRE = '2026-07-31';

  const conCtx = <T>(fn: () => Promise<T>) =>
    withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenant,
        actor_user_id: user,
        actor_type: 'user',
      },
      fn
    );

  /** Un turno de caja ya cerrado, con las horas puestas a mano. */
  const turno = (
    punto: number,
    abre: string,
    cierra: string,
    contado: string,
    descuadre = '0.0000'
  ) => ({
    id: crypto.randomUUID(),
    tenant_id: tenant,
    sale_point: punto,
    opened_by: user,
    opened_at: new Date(abre),
    initial_amount: '1000.0000',
    closed_by: user,
    closed_at: new Date(cierra),
    final_amount: contado,
    expected_amount: contado,
    descuadre,
    discrepancy_reason: descuadre === '0.0000' ? null : 'test',
  });

  /**
   * Un fiado. Cada cargo necesita SU venta: `cam_charge_needs_sale` no deja
   * inventar deuda sin operación detrás (migration 0024).
   */
  const cargo = async (customer_id: string, amount: string, cuando: string) => {
    const [venta] = await db
      .insert(sales)
      .values({
        tenant_id: tenant,
        correlation_id: generateCorrelationId(),
        cashier_user_id: user,
        customer_id,
        commercial_status: 'terminada',
        total: amount,
        subtotal: amount,
        created_at: new Date(cuando),
      })
      .returning({ id: sales.id });
    await db.insert(customer_account_movements).values({
      tenant_id: tenant,
      customer_id,
      type: 'charge',
      amount,
      sale_id: venta!.id,
      created_by: user,
      created_at: new Date(cuando),
    });
  };

  const pago = (customer_id: string, amount: string, cuando: string) =>
    db.insert(customer_account_movements).values({
      tenant_id: tenant,
      customer_id,
      type: 'payment',
      amount,
      payment_method: 'transferencia',
      created_by: user,
      created_at: new Date(cuando),
    });

  const ajuste = (customer_id: string, amount: string, cuando: string) =>
    db.insert(customer_account_movements).values({
      tenant_id: tenant,
      customer_id,
      type: 'adjustment',
      amount,
      reason: 'corrección del test',
      created_by: user,
      created_at: new Date(cuando),
    });

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenant,
      name: 'T-CIERRE-01 Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: user,
      email: `t-cierre-01-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Quien cierra la caja',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenant,
      user_id: user,
      role: 'owner',
    });
    await db.insert(customers).values([
      {
        id: rosa,
        tenant_id: tenant,
        name: 'Rosa Gutiérrez',
        doc_type: 'CUIT',
        doc_number: '27123456784',
      },
      // Sin documento: el estudio lo pide con CUIT, y la pantalla lo avisa.
      { id: luis, tenant_id: tenant, name: 'Luis del kiosco', doc_type: 'none' },
      {
        id: pagador,
        tenant_id: tenant,
        name: 'El que pagó todo',
        doc_type: 'DNI',
        doc_number: '30111222',
      },
    ]);
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx
        .delete(customer_account_movements)
        .where(eq(customer_account_movements.tenant_id, tenant));
      await tx.delete(sales).where(eq(sales.tenant_id, tenant));
      await tx.delete(customers).where(eq(customers.tenant_id, tenant));
      await tx.delete(cash_sessions).where(eq(cash_sessions.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(eq(companies.id, tenant));
    });
  });

  it('🔴 suma el ÚLTIMO arqueo de cada caja, no todos los turnos', async () => {
    await db.insert(cash_sessions).values([
      // Caja 1: tres turnos en el mes. Sumarlos daría 480.000.
      turno(1, '2026-07-10T12:00:00Z', '2026-07-10T23:00:00Z', '100000.0000'),
      turno(1, '2026-07-20T12:00:00Z', '2026-07-20T23:00:00Z', '31000.0000'),
      // El del día del cierre a las 22:00 de Ushuaia = 01/08 01:00 UTC. Con la
      // medianoche UTC como corte, este arqueo caería en agosto y el saldo del
      // ejercicio sería el del 20/07.
      turno(1, '2026-07-31T15:00:00Z', '2026-08-01T01:00:00Z', '349000.0000'),
      // Caja 2, arqueada el mismo día.
      turno(2, '2026-07-31T15:00:00Z', '2026-07-31T23:30:00Z', '50000.0000'),
      // Posterior al cierre: no entra, aunque sea el más fresco.
      turno(1, '2026-08-05T12:00:00Z', '2026-08-05T23:00:00Z', '999999.0000'),
    ]);

    const caja = await conCtx(() => getCajaAlCierre(CIERRE));

    expect(caja.estado).toBe('contado');
    // 349.000 (caja 1, el del día) + 50.000 (caja 2). NO 480.000 ni 999.999.
    expect(caja.total).toBe('399000.0000');
    expect(caja.puntos.map((p) => p.punto)).toEqual([1, 2]);
    expect(caja.puntos[0]?.fecha).toBe('2026-07-31');
    expect(caja.abiertas).toHaveLength(0);
  });

  it('el CSV dice que es efectivo y trae una fila por caja', async () => {
    const csv = armarCsvCaja(await conCtx(() => getCajaAlCierre(CIERRE)));

    expect(csv).toContain('Punto de venta');
    expect(csv).toContain('349000,00');
    // Sin esta línea el número se lee como "toda la plata al cierre".
    expect(csv).toMatch(/EFECTIVO contado/);
    expect(csv).toMatch(/tarjeta, QR o transferencia no esta en el cajon/);
  });

  it('🔴 una caja abierta al cierre no aporta monto, aunque se cuente después', async () => {
    // Caja 3: abierta el 31/07, cerrada recién el 02/08.
    await db
      .insert(cash_sessions)
      .values([turno(3, '2026-07-31T14:00:00Z', '2026-08-02T20:00:00Z', '777000.0000')]);

    const caja = await conCtx(() => getCajaAlCierre(CIERRE));

    // El total no se mueve: al 31/07 esa plata no estaba contada.
    expect(caja.total).toBe('399000.0000');
    expect(caja.abiertas).toEqual([
      { punto: 3, desde: '2026-07-31', cerroDespues: '2026-08-02' },
    ]);
    expect(armarCsvCaja(caja)).toMatch(/caja abierta al cierre/);
  });

  it('🔴 la caja contada a las 02:00 del día siguiente NO entra en el cierre', async () => {
    // La noche normal de un kiosco: abre el 31/07 y cuenta el cajón pasada la
    // medianoche. 01/08 05:00 UTC = 02:00 de Ushuaia.
    //
    // Se atribuye por `closed_at`, así que cae en el 01/08 y el saldo del
    // ejercicio NO lo incluye: figura como abierta, contada el 01/08.
    // Atribuirlo por `opened_at` metería en el 31/07 un conteo hecho después —
    // y con un turno que queda abierto cuatro días, las ventas de esos días.
    await db
      .insert(cash_sessions)
      .values([turno(4, '2026-07-31T15:00:00Z', '2026-08-01T05:00:00Z', '123000.0000')]);

    const caja = await conCtx(() => getCajaAlCierre(CIERRE));

    expect(caja.total).toBe('399000.0000');
    expect(caja.puntos.map((p) => p.punto)).not.toContain(4);
    expect(caja.abiertas.find((a) => a.punto === 4)).toEqual({
      punto: 4,
      desde: '2026-07-31',
      cerroDespues: '2026-08-01',
    });
    // Y el CSV lo declara, para que el estudio decida qué hacer con eso.
    expect(armarCsvCaja(caja)).toMatch(/se atribuye al dia en que SE CONTO/);
  });

  it('sin ningún cierre hasta la fecha, no hay número', async () => {
    const caja = await conCtx(() => getCajaAlCierre('2026-01-15'));

    expect(caja.estado).toBe('sin_datos');
    expect(caja.total).toBeNull();
  });

  it('🔴 el saldo del deudor al cierre NO es el de hoy', async () => {
    // Rosa: fía 50.000 y paga 20.000 antes del cierre → debe 30.000.
    await cargo(rosa, '50000.0000', '2026-07-12T14:00:00Z');
    await pago(rosa, '20000.0000', '2026-07-25T14:00:00Z');
    // Y sigue comprando después del cierre: hoy debe 95.000.
    await cargo(rosa, '65000.0000', '2026-08-14T14:00:00Z');
    // Luis: fía a las 22:00 del 31/07 en Ushuaia (01/08 01:00 UTC). Es del
    // 31/07 para el comercio: tiene que entrar.
    await cargo(luis, '8000.0000', '2026-08-01T01:00:00Z');
    await ajuste(luis, '500.0000', '2026-07-30T14:00:00Z');
    // El que pagó todo: al cierre no debe nada, no puede figurar.
    await cargo(pagador, '10000.0000', '2026-07-05T14:00:00Z');
    await pago(pagador, '10000.0000', '2026-07-06T14:00:00Z');

    const alCierre = await conCtx(() => getDeudoresAlCierre(CIERRE));

    expect(alCierre.map((d) => d.nombre)).toEqual([
      'Rosa Gutiérrez',
      'Luis del kiosco',
    ]);
    expect(alCierre[0]?.saldo).toBe('30000.0000');
    expect(alCierre[0]?.doc_numero).toBe('27123456784');
    expect(alCierre[0]?.doc_tipo).toBe('CUIT');
    // 8.000 del borde del día + 500 de ajuste.
    expect(alCierre[1]?.saldo).toBe('8500.0000');
    expect(alCierre[1]?.doc_numero).toBe('');

    // Hoy (con la compra de agosto adentro) da otra cosa. Si los dos números
    // coincidieran, el corte no estaría haciendo nada.
    const hoy = await conCtx(() => getDeudoresAlCierre('2026-12-31'));
    expect(hoy.find((d) => d.nombre === 'Rosa Gutiérrez')?.saldo).toBe('95000.0000');
  });

  it('el CSV de deudores trae razón social, documento, importe y el caveat', async () => {
    const csv = armarCsvDeudores(
      CIERRE,
      await conCtx(() => getDeudoresAlCierre(CIERRE))
    );

    expect(csv).toContain('Cliente');
    expect(csv).toContain('27123456784');
    expect(csv).toContain('30000,00');
    // La limitación se declara adentro del archivo, no en una charla.
    expect(csv).toMatch(/fecha en que se REGISTRO cada movimiento/);
  });

  it('una fecha mal formada se rechaza antes de tocar la base', async () => {
    await expect(conCtx(() => getCajaAlCierre('31/07/2026'))).rejects.toThrow(
      /AAAA-MM-DD/
    );
    await expect(conCtx(() => getDeudoresAlCierre('2026-7-1'))).rejects.toThrow(
      /AAAA-MM-DD/
    );
  });
});
