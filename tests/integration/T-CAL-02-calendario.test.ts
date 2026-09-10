/**
 * T-CAL-02 — las consultas del Calendario.
 *
 * ── LO QUE SE PROTEGE ─────────────────────────────────────────────────────
 *  1. **Que no haya huecos.** Un día sin ventas TIENE que devolver una fila en
 *     cero. Si se salteara, el calendario no podría distinguir "ese día no
 *     vendí" de "no tengo el dato de ese día" — y las pinta distinto a
 *     propósito.
 *  2. **La cobertura.** Un año que no está cargado tiene que resultar en cero
 *     filas de cobertura, para que la pantalla diga que no lo tiene en vez de
 *     dibujar un año sin feriados.
 *  3. **El aislamiento.** Las ventas del calendario son del comercio; los
 *     feriados NO (son dato de referencia compartido, y eso es deliberado).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { sales } from '@/lib/db/schema/sales';
import { holidays, holiday_calendars } from '@/lib/db/schema/holidays';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { TZ_COMERCIO } from '@/lib/services/reporting/panel.report';
import {
  getCoberturaFeriados,
  getDiasConVentas,
  getFeriados,
} from '@/lib/services/reporting/calendar.report';

// Un anio lejano y propio, para no pisar el calendario cargado por la migration.
const ANIO_TEST = 2093;

describe('T-CAL-02 — calendario', () => {
  let tenantId: string;
  let otroTenant: string;
  let userId: string;

  const withCtx = <T,>(fn: () => Promise<T>, tid?: string): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid ?? tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        fn
      )
    );

  const hoyLocal = async (): Promise<string> => {
    const [r] = await db.execute<{ d: string }>(
      sql`SELECT (now() AT TIME ZONE ${TZ_COMERCIO})::date::text AS d`
    );
    return r!.d;
  };

  /** Una venta a las 12 del día local que se le indique. */
  const venta = async (diaLocal: string, total: string, tid?: string) => {
    await db.insert(sales).values({
      tenant_id: tid ?? tenantId,
      correlation_id: crypto.randomUUID(),
      cashier_user_id: userId,
      commercial_status: 'cobrada',
      fiscal_status: 'not_required',
      subtotal: total,
      tax_amount: '0',
      total,
      payment_method: 'efectivo',
      created_at: sql`(${diaLocal}::date + interval '12 hours') AT TIME ZONE ${TZ_COMERCIO}` as never,
    });
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    otroTenant = crypto.randomUUID();
    userId = crypto.randomUUID();
    for (const [i, id] of [tenantId, otroTenant].entries()) {
      await db.insert(companies).values({
        id,
        name: `T-CAL Co ${i}`,
        legal_name: `T-CAL Co ${i} SRL`,
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      });
    }
    await db.insert(users).values({
      id: userId,
      email: `t-cal-${userId.slice(0, 8)}@test.local`,
      full_name: 'Cajero',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });
  });

  afterEach(async () => {
    const ids = [tenantId, otroTenant];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(sales).where(inArray(sales.tenant_id, ids));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, ids));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
      // Acotado al año de prueba a propósito: un DELETE por `jurisdiction` se
      // llevaría puesto el calendario real que cargó la migration 0029.
      await tx.execute(
        sql`DELETE FROM holidays WHERE extract(year FROM fecha) BETWEEN ${ANIO_TEST} AND ${ANIO_TEST + 10}`
      );
      await tx.execute(
        sql`DELETE FROM holiday_calendars WHERE anio BETWEEN ${ANIO_TEST} AND ${ANIO_TEST + 10}`
      );
    });
  });

  describe('días con ventas', () => {
    /**
     * La invariante del heatmap. Sin el cero explícito el calendario no puede
     * distinguir "cerré" de "no sé", y los pinta distinto a propósito.
     */
    it('devuelve TODOS los días del rango, incluidos los que no vendieron', async () => {
      const r = await withCtx(() => getDiasConVentas(30));
      expect(r).toHaveLength(30);
      // Y el último es hoy.
      expect(r[r.length - 1]!.dia).toBe(await hoyLocal());
    });

    it('viene ordenado de la más vieja a la más nueva', async () => {
      const r = await withCtx(() => getDiasConVentas(10));
      const ordenado = [...r].sort((a, b) => a.dia.localeCompare(b.dia));
      expect(r.map((x) => x.dia)).toEqual(ordenado.map((x) => x.dia));
    });

    it('suma las ventas del día, no las cuenta', async () => {
      const hoy = await hoyLocal();
      await venta(hoy, '1000.50');
      await venta(hoy, '2000.25');

      const r = await withCtx(() => getDiasConVentas(2));
      const deHoy = r.find((x) => x.dia === hoy)!;

      expect(new Decimal(deHoy.total).toFixed(2)).toBe('3000.75');
      expect(deHoy.tickets).toBe('2');
    });

    it('un día sin ventas es un CERO, no una fila ausente', async () => {
      const r = await withCtx(() => getDiasConVentas(15));
      const vacios = r.filter((x) => new Decimal(x.total).isZero());
      expect(vacios.length).toBeGreaterThan(0);
      expect(vacios.every((x) => x.tickets === '0')).toBe(true);
    });

    it('no ve las ventas de otro comercio', async () => {
      const hoy = await hoyLocal();
      await venta(hoy, '9999', otroTenant);

      const r = await withCtx(() => getDiasConVentas(2));
      const deHoy = r.find((x) => x.dia === hoy)!;

      expect(new Decimal(deHoy.total).isZero()).toBe(true);
    });
  });

  describe('feriados', () => {
    const cargar = async (fecha: string, nombre: string, tipo: string) => {
      await db.insert(holidays).values({
        fecha,
        nombre,
        tipo: tipo as never,
        jurisdiction: 'nacional',
        source_url: 'https://test.local',
        verified_at: `${ANIO_TEST}-01-01`,
      });
    };

    it('trae los del rango de años pedido y nada más', async () => {
      await cargar(`${ANIO_TEST}-05-01`, 'Feriado de prueba', 'inamovible');
      await cargar(`${ANIO_TEST + 5}-05-01`, 'Fuera de rango', 'inamovible');

      const r = await getFeriados(ANIO_TEST, ANIO_TEST);

      expect(r.map((x) => x.nombre)).toEqual(['Feriado de prueba']);
    });

    it('viene ordenado por fecha', async () => {
      await cargar(`${ANIO_TEST}-12-25`, 'Diciembre', 'inamovible');
      await cargar(`${ANIO_TEST}-01-01`, 'Enero', 'inamovible');
      await cargar(`${ANIO_TEST}-07-09`, 'Julio', 'inamovible');

      const r = await getFeriados(ANIO_TEST, ANIO_TEST);

      expect(r.map((x) => x.nombre)).toEqual(['Enero', 'Julio', 'Diciembre']);
    });

    /**
     * Los feriados son dato de REFERENCIA compartido: no llevan tenant y se ven
     * desde cualquier comercio. Es deliberado (un feriado nacional es el mismo
     * para todos) y este test lo fija, para que nadie lo "arregle" agregándoles
     * un tenant_id.
     */
    it('los ve cualquier comercio: son dato compartido, no del tenant', async () => {
      await cargar(`${ANIO_TEST}-05-01`, 'Compartido', 'inamovible');

      const a = await withCtx(() => getFeriados(ANIO_TEST, ANIO_TEST));
      const b = await withCtx(() => getFeriados(ANIO_TEST, ANIO_TEST), otroTenant);

      expect(a.map((x) => x.nombre)).toEqual(['Compartido']);
      expect(b).toEqual(a);
    });
  });

  describe('cobertura', () => {
    /**
     * Lo que permite decir "todavía no tengo el calendario de 2028" en vez de
     * dibujar 2028 como si no tuviera ningún feriado.
     */
    it('un año que no se cargó no devuelve fila', async () => {
      const r = await getCoberturaFeriados(ANIO_TEST, ANIO_TEST);
      expect(r).toEqual([]);
    });

    it('un año cargado a medias se reporta como incompleto, con su nota', async () => {
      await db.insert(holiday_calendars).values({
        anio: ANIO_TEST,
        jurisdiction: 'nacional',
        source_url: 'https://test.local',
        verified_at: `${ANIO_TEST}-01-01`,
        completo: false,
        nota: 'Faltan los trasladables.',
      });

      const r = await getCoberturaFeriados(ANIO_TEST, ANIO_TEST);

      expect(r).toHaveLength(1);
      expect(r[0]!.completo).toBe(false);
      expect(r[0]!.nota).toBe('Faltan los trasladables.');
    });
  });
});
