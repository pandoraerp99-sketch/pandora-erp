/**
 * T-GASTO-DUP-01 — la misma factura no se carga dos veces.
 *
 * Lo que se prueba (contra la base real, por el service):
 * - mismo comprobante del mismo proveedor, aunque el número esté escrito de
 *   otra forma → se rechaza y no queda una segunda fila;
 * - el proveedor se reconoce por la ficha, por el CUIT o por el nombre;
 * - mismo número de OTRO proveedor, u otro tipo de comprobante → pasa;
 * - anulado el primero, se puede volver a cargar;
 * - sin número: mismo proveedor, día y monto → aviso `posible_duplicado`, que
 *   se saltea confirmando; sin proveedor, no hay aviso;
 * - otro comercio con el mismo número → pasa;
 * - dos cargas SIMULTÁNEAS del mismo comprobante → entra una sola.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses, GASTO_VIGENTE } from '@/lib/db/schema/expenses';
import { expense_cost_behaviour } from '@/lib/db/schema/expense_cost_behaviour';
import { terceros } from '@/lib/db/schema/terceros';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import {
  annulExpense,
  registerExpense,
  type NuevoGasto,
} from '@/lib/services/expenses/expense.service';

const HOY = diaDelComercio();

describe('T-GASTO-DUP-01 — comprobantes duplicados', () => {
  let tenantId: string;
  let otro: string;
  let userId: string;

  const withCtx = <T,>(fn: () => Promise<T>, tid?: string) =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid ?? tenantId,
          actor_user_id: userId,
          actor_type: 'user',
          actor_role: 'owner',
        },
        fn
      )
    );

  const crearCompany = async (id: string, n: number) => {
    await db.insert(companies).values({
      id,
      name: `T-GASTO-DUP Co ${n}`,
      legal_name: `T-GASTO-DUP Co ${n} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
  };

  const proveedor = async (name: string, doc: string | null = null, tid?: string) => {
    const [p] = await db
      .insert(terceros)
      .values({ tenant_id: tid ?? tenantId, type: 'proveedor', name, doc })
      .returning();
    return p!.id;
  };

  const cargar = (extra: Partial<NuevoGasto>, tid?: string) =>
    withCtx(
      () =>
        registerExpense({
          fecha: HOY,
          categoria: 'servicios',
          total: '1000.00',
          medio_pago: 'transferencia',
          comprobante_tipo: 'Factura',
          ...extra,
        } as NuevoGasto),
      tid
    );

  const cuantos = async (tid?: string) =>
    (
      await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.tenant_id, tid ?? tenantId), GASTO_VIGENTE))
    ).length;

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    otro = crypto.randomUUID();
    userId = crypto.randomUUID();
    await crearCompany(tenantId, 1);
    await crearCompany(otro, 2);
    await db.insert(users).values({
      id: userId,
      email: `t-gastodup-${userId.slice(0, 8)}@test.local`,
      full_name: 'Dueña',
      is_support: false,
    });
    await db.insert(company_users).values([
      { id: crypto.randomUUID(), company_id: tenantId, user_id: userId, role: 'owner' },
      { id: crypto.randomUUID(), company_id: otro, user_id: userId, role: 'owner' },
    ]);
  });

  afterEach(async () => {
    const ids = [tenantId, otro];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(expense_cost_behaviour).where(inArray(expense_cost_behaviour.tenant_id, ids));
      await tx.delete(expenses).where(inArray(expenses.tenant_id, ids));
      await tx.delete(terceros).where(inArray(terceros.tenant_id, ids));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, ids));
      await tx.delete(company_users).where(inArray(company_users.company_id, ids));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  it('🔴 la misma factura del mismo proveedor, aunque el número esté escrito distinto, se rechaza', async () => {
    const makor = await proveedor('Makor SA', '30-71469403-7');
    await cargar({ tercero_id: makor, comprobante_numero: '0007-00001162' });
    await expect(cargar({ tercero_id: makor, comprobante_numero: '7-1162' })).rejects.toMatchObject({
      code: 'comprobante_duplicado',
      messageEs: expect.stringMatching(/ya está cargada.*Makor SA/),
    });
    expect(await cuantos()).toBe(1);
  });

  it('reconoce al proveedor por el CUIT y por el nombre escrito igual', async () => {
    const makor = await proveedor('Makor SA', '30-71469403-7');
    await cargar({ tercero_id: makor, comprobante_numero: '0007-00001162' });
    await expect(
      cargar({ payee_name: 'Otro nombre', payee_doc: '30714694037', comprobante_numero: '0007-00001162' })
    ).rejects.toMatchObject({ code: 'comprobante_duplicado' });

    await cargar({ payee_name: 'Panadería La Espiga', comprobante_numero: '0002-00000099' });
    await expect(
      cargar({ payee_name: 'PANADERIA  la espiga', comprobante_numero: '2-99' })
    ).rejects.toMatchObject({ code: 'comprobante_duplicado' });
    expect(await cuantos()).toBe(2);
  });

  it('el mismo número de otro proveedor, o una nota de débito, no es duplicado', async () => {
    const makor = await proveedor('Makor SA');
    const traberso = await proveedor('Traberso SRL');
    await cargar({ tercero_id: makor, comprobante_numero: '0007-00001162' });
    await cargar({ tercero_id: traberso, comprobante_numero: '0007-00001162' });
    await cargar({ tercero_id: makor, comprobante_numero: '0007-00001162', comprobante_tipo: 'Nota de débito' });
    expect(await cuantos()).toBe(3);
  });

  it('anulado el primero, se puede volver a cargar', async () => {
    const makor = await proveedor('Makor SA');
    const g = await cargar({ tercero_id: makor, comprobante_numero: '0007-00001162', total: '999.00' });
    await withCtx(() => annulExpense({ expense_id: g.id, motivo: 'importe mal cargado' }));
    await cargar({ tercero_id: makor, comprobante_numero: '0007-00001162', total: '1000.00' });
    expect(await cuantos()).toBe(1);
  });

  it('sin número: mismo proveedor, día y monto avisa; confirmando, entra', async () => {
    await cargar({ payee_name: 'Panadería', comprobante_tipo: undefined });
    await expect(cargar({ payee_name: 'panadería', comprobante_tipo: undefined })).rejects.toMatchObject({
      code: 'posible_duplicado',
    });
    await cargar({ payee_name: 'panadería', comprobante_tipo: undefined, confirmar_duplicado: true });
    // Otro monto u otro día no avisa.
    await cargar({ payee_name: 'Panadería', comprobante_tipo: undefined, total: '1000.50' });
    expect(await cuantos()).toBe(3);
  });

  it('sin número y sin proveedor no hay con qué comparar: no avisa', async () => {
    await cargar({ comprobante_tipo: undefined });
    await cargar({ comprobante_tipo: undefined });
    expect(await cuantos()).toBe(2);
  });

  it('otro comercio con el mismo número y el mismo nombre no cuenta', async () => {
    await cargar({ payee_name: 'Makor SA', comprobante_numero: '0007-00001162' });
    await cargar({ payee_name: 'Makor SA', comprobante_numero: '0007-00001162' }, otro);
    expect(await cuantos()).toBe(1);
    expect(await cuantos(otro)).toBe(1);
  });

  it('🔴 dos cargas simultáneas del mismo comprobante: entra una sola', async () => {
    const makor = await proveedor('Makor SA');
    // Veinte a la vez, alternando cinco formas de escribir el número. Con dos
    // o cinco intentos la ventana de carrera es tan chica que no se pisan y el
    // test pasaría aunque faltara el lock; con veinte, sin el lock entraron
    // CINCO copias (una por conexión del pool). Verificado sacando el lock.
    const formas = ['0007-00001162', '7-1162', '00007 00001162', 'FC 0007-00001162', '7-01162'];
    const r = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        cargar({ tercero_id: makor, comprobante_numero: formas[i % formas.length]! })
      )
    );
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const x of r.filter((y) => y.status === 'rejected') as PromiseRejectedResult[]) {
      expect(x.reason).toMatchObject({ code: 'comprobante_duplicado' });
    }
    expect(await cuantos()).toBe(1);
  });
});
