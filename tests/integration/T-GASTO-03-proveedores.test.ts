/**
 * T-GASTO-03 — proveedores del período (ítem 9 de la carta de la contadora).
 *
 * ── LO QUE SE PROTEGE ─────────────────────────────────────────────────────
 * Este listado va a un balance. Lo que puede salir mal y NO se ve mirando el
 * archivo:
 *
 *   1. Que la suma del listado no dé el total del período. Pasa apenas se cae
 *      una fila —un gasto sin proveedor cargado, por ejemplo— y el archivo sale
 *      igual de prolijo. Es el invariante más fuerte que tiene esta consulta.
 *   2. Que dos proveedores distintos se junten, o que el mismo quede partido en
 *      dos filas por haberlo elegido una vez del catálogo y escrito otra a mano.
 *   3. Que un CUIT equivocado quede al lado del nombre correcto. Nadie revisa
 *      eso, y termina en un papel firmado por una matriculada.
 *   4. Que el archivo se lea como el detalle de ACREEDORES. No lo es, y Pandora
 *      no puede saberlo: todo gasto nace pagado.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { terceros } from '@/lib/db/schema/terceros';
import { expenses } from '@/lib/db/schema/expenses';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import {
  armarCsvProveedores,
  getExpenseSummary,
  getProveedoresDelPeriodo,
  registerExpense,
} from '@/lib/services/expenses/expense.service';

// El día del COMERCIO, el mismo reloj que el guard `fecha_futura`: con el de
// UTC, entre las 21 y la medianoche HOY sería "mañana" para el service.
const HOY = diaDelComercio();
const DESDE = HOY.slice(0, 8) + '01';
const HASTA = (() => {
  const d = new Date(HOY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
})();

describe('T-GASTO-03 — proveedores del período', () => {
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

  const crearCompany = async (id: string, n: number) => {
    await db.insert(companies).values({
      id,
      name: `T-GASTO3 Co ${n}`,
      legal_name: `T-GASTO3 Co ${n} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    otroTenant = crypto.randomUUID();
    userId = crypto.randomUUID();
    await crearCompany(tenantId, 1);
    await crearCompany(otroTenant, 2);
    await db.insert(users).values({
      id: userId,
      email: `t-gasto3-${userId.slice(0, 8)}@test.local`,
      full_name: 'Dueño',
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
      await tx.delete(expenses).where(inArray(expenses.tenant_id, ids));
      await tx.delete(terceros).where(inArray(terceros.tenant_id, ids));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, ids));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  /** Gasto suelto, con nombre escrito a mano. */
  const gasto = (
    total: string,
    payee_name?: string,
    payee_doc?: string,
    categoria: 'servicios' | 'alquiler' | 'otros' = 'servicios'
  ) =>
    withCtx(() =>
      registerExpense({
        fecha: HOY,
        categoria,
        total,
        medio_pago: 'transferencia',
        ...(payee_name !== undefined ? { payee_name } : {}),
        ...(payee_doc !== undefined ? { payee_doc } : {}),
      })
    );

  it('EL INVARIANTE: la suma del listado da el total del período', async () => {
    // Incluye a propósito un gasto SIN proveedor cargado. Si esa fila se
    // cayera, el listado sumaría menos que el total y el archivo saldría igual
    // de prolijo — nadie lo notaría hasta que la contadora pregunte.
    await gasto('1000.55', 'Edenor', '30-12345678-9');
    await gasto('2000.45', 'Camuzzi', '30-65786411-2');
    await gasto('300.10'); // sin proveedor

    const filas = await withCtx(() => getProveedoresDelPeriodo(DESDE, HASTA));
    const suma = filas.reduce((a, f) => a.plus(f.total), new Decimal(0));
    const resumen = await withCtx(() => getExpenseSummary(DESDE, HASTA));

    expect(suma.eq(resumen.total)).toBe(true);
    expect(suma.eq('3301.10')).toBe(true);
  });

  it('el gasto sin proveedor aparece como fila propia, no se descarta', async () => {
    await gasto('500.00');
    const filas = await withCtx(() => getProveedoresDelPeriodo(DESDE, HASTA));
    expect(filas.length).toBe(1);
    expect(filas[0]?.nombre).toBe('(sin proveedor indicado)');
    expect(filas[0]?.cuit).toBe('');
  });

  it('junta los gastos del mismo proveedor en una fila', async () => {
    await gasto('100.00', 'Edenor', '30-12345678-9');
    await gasto('250.00', 'Edenor', '30-12345678-9');

    const filas = await withCtx(() => getProveedoresDelPeriodo(DESDE, HASTA));
    expect(filas.length).toBe(1);
    expect(filas[0]?.comprobantes).toBe('2');
    expect(new Decimal(filas[0]!.total).eq('350.00')).toBe(true);
  });

  it('NO junta a dos proveedores distintos', async () => {
    await gasto('100.00', 'Edenor', '30-11111111-1');
    await gasto('100.00', 'Camuzzi', '30-22222222-2');
    const filas = await withCtx(() => getProveedoresDelPeriodo(DESDE, HASTA));
    expect(filas.length).toBe(2);
  });

  it('el mismo proveedor del CATALOGO y escrito a mano NO se parte en dos', async () => {
    // Es el caso real: una vez se elige del catálogo y otra se escribe. Se
    // agrupa por tercero_id cuando está, y por el nombre normalizado cuando no,
    // así que "edenor" y "Edenor" caen juntos.
    await gasto('100.00', 'Edenor', '30-12345678-9');
    await gasto('200.00', '  edenor ', '30-12345678-9');

    const filas = await withCtx(() => getProveedoresDelPeriodo(DESDE, HASTA));
    expect(filas.length).toBe(1);
    expect(new Decimal(filas[0]!.total).eq('300.00')).toBe(true);
  });

  it('el CUIT sale del SNAPSHOT del gasto, no de la ficha de hoy', async () => {
    const [prov] = await db
      .insert(terceros)
      .values({
        tenant_id: tenantId,
        type: 'proveedor',
        name: 'Distribuidora Fueguina',
        doc: '30-70991234-8',
      })
      .returning();

    await withCtx(() =>
      registerExpense({
        fecha: HOY,
        categoria: 'mercaderia',
        total: '900.00',
        medio_pago: 'transferencia',
        tercero_id: prov!.id,
      })
    );

    // Se renombra el proveedor DESPUES del gasto.
    await db
      .update(terceros)
      .set({ name: 'OTRO NOMBRE' })
      .where(eq(terceros.id, prov!.id));

    const filas = await withCtx(() => getProveedoresDelPeriodo(DESDE, HASTA));
    expect(filas[0]?.nombre).toBe('Distribuidora Fueguina');
    expect(filas[0]?.cuit).toBe('30-70991234-8');
  });

  it('si el grupo trae DOS CUIT, se muestran los dos en vez de elegir uno', async () => {
    // Un tipeo en el CUIT de un proveedor. Elegir uno en silencio pone un CUIT
    // equivocado al lado del nombre correcto, y eso nadie lo revisa.
    await gasto('100.00', 'Edenor', '30-12345678-9');
    await gasto('100.00', 'Edenor', '30-12345678-0');

    const filas = await withCtx(() => getProveedoresDelPeriodo(DESDE, HASTA));
    expect(filas.length).toBe(1);
    expect(filas[0]?.cuits).toBe('2');
    expect(filas[0]?.cuit).toContain('30-12345678-9');
    expect(filas[0]?.cuit).toContain('30-12345678-0');

    // Y el CSV lo dice, no lo deja pasar como un CUIT largo.
    const csv = armarCsvProveedores(filas, 'septiembre');
    expect(csv).toContain('revisar: 2 CUIT');
  });

  it('ordena de mayor a menor importe', async () => {
    await gasto('100.00', 'Chico', '30-11111111-1');
    await gasto('5000.00', 'Grande', '30-22222222-2');
    const filas = await withCtx(() => getProveedoresDelPeriodo(DESDE, HASTA));
    expect(filas.map((f) => f.nombre)).toEqual(['Grande', 'Chico']);
  });

  it('no ve los proveedores de otro comercio', async () => {
    await withCtx(
      () =>
        registerExpense({
          fecha: HOY,
          categoria: 'otros',
          total: '777.00',
          medio_pago: 'transferencia',
          payee_name: 'Proveedor Ajeno',
        }),
      otroTenant
    );
    await gasto('100.00', 'Mío', '30-11111111-1');

    const filas = await withCtx(() => getProveedoresDelPeriodo(DESDE, HASTA));
    expect(filas.length).toBe(1);
    expect(filas[0]?.nombre).toBe('Mío');
  });

  describe('el CSV dice lo que NO es', () => {
    it('avisa que no es el detalle de acreedores', async () => {
      // Si la contadora lo lee como "no hay saldos pendientes", concluye algo
      // que Pandora no puede saber — y eso termina en un balance.
      const csv = armarCsvProveedores(
        [
          {
            nombre: 'Edenor',
            cuit: '30-12345678-9',
            cuits: '1',
            comprobantes: '2',
            total: '1000.00',
          },
        ],
        'septiembre de 2026'
      );
      expect(csv).toContain('PAGADOS');
      expect(csv).toContain('NO incluye lo que se les debe');
      // Y manda al archivo que SÍ lo tiene. La nota vieja decía "en este
      // sistema todo gasto se registra ya pagado": con la 0039 (ADR-0028) eso
      // pasó a ser falso, y un archivo que lo afirma le está diciendo al
      // estudio que no hace falta pedir la lista de acreedores.
      expect(csv).toContain('acreedores al cierre');
      expect(csv).not.toContain('todo gasto se ');
      // Y lleva el período adentro, no sólo en el nombre del archivo.
      expect(csv).toContain('septiembre de 2026');
    });

    it('lleva las columnas que pide la carta', async () => {
      const csv = armarCsvProveedores([], 'x');
      expect(csv).toContain('Proveedor;CUIT;Comprobantes;Total pagado');
    });

    it('usa la misma receta que los otros CSV', async () => {
      const csv = armarCsvProveedores(
        [{ nombre: 'A', cuit: '', cuits: '0', comprobantes: '1', total: '1234.5' }],
        'x'
      );
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain('1234,50');
      expect(csv).not.toContain('1234.50');
    });
  });
});
