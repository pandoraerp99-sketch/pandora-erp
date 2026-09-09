/**
 * T-CONT-02 — el resumen que ve la contadora.
 *
 * Estos números terminan en una declaración jurada. Las tres formas en que
 * podrían mentir, y que cubre este archivo:
 *   1. contar carritos abandonados como ventas
 *   2. meter ventas de otro mes (o dejar afuera las del último día)
 *   3. contar dos veces un cobro al que después se le corrigió el medio
 * Ninguna de las tres se nota mirando la pantalla: el número se ve razonable
 * igual.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { sales } from '@/lib/db/schema/sales';
import { sale_payments } from '@/lib/db/schema/sale_payments';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  armarCsv,
  getResumenContable,
  getVentasParaExport,
  mesDe,
  type FilaExport,
} from '@/lib/services/reporting/accountant.report';

describe('T-CONT-02 — resumen contable', () => {
  let tenantId: string;
  let otroTenant: string;
  let userId: string;

  const periodo = mesDe();
  /** Una fecha cómoda DENTRO del período: el día 15. */
  const dentro = new Date(periodo.desde.getTime() + 14 * 86400000);
  /** El último instante del mes anterior: el borde que suele fallar. */
  const justoAntes = new Date(periodo.desde.getTime() - 1000);

  const withCtx = <T,>(fn: () => Promise<T>, tid = tenantId): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid,
          actor_user_id: userId,
          actor_type: 'user',
        },
        fn
      )
    );

  const venta = async (opciones: {
    estado?: string;
    cuando?: Date;
    neto?: string;
    iva?: string;
    exento?: string;
    tenant?: string;
  }) => {
    const neto = opciones.neto ?? '1000.00';
    const iva = opciones.iva ?? '210.00';
    const exento = opciones.exento ?? '0.00';
    const total = (Number(neto) + Number(iva) + Number(exento)).toFixed(2);
    const [v] = await db
      .insert(sales)
      .values({
        tenant_id: opciones.tenant ?? tenantId,
        correlation_id: generateCorrelationId(),
        cashier_user_id: userId,
        commercial_status: opciones.estado ?? 'terminada',
        subtotal: neto,
        tax_amount: iva,
        exempt_amount: exento,
        total,
        created_at: opciones.cuando ?? dentro,
      })
      .returning({ id: sales.id });
    return v!.id;
  };

  const crearCompany = async (id: string, n: number) => {
    await db.insert(companies).values({
      id,
      name: `T-CONT-02 Co ${n}`,
      legal_name: `T-CONT-02 Co ${n} SRL`,
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
      email: `t-cont02-${userId.slice(0, 8)}@test.local`,
      full_name: 'Owner',
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
      // Un DELETE por tenant: `ANY(${ids})` con un array de JS no bindea como
      // array (el driver manda los elementos sueltos y Postgres tira 42809).
      for (const t of ids) {
        await tx.execute(
          sql`DELETE FROM sale_payments WHERE sale_id IN (
                SELECT id FROM sales WHERE tenant_id = ${t})`
        );
      }
      await tx.delete(sales).where(inArray(sales.tenant_id, ids));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  it('suma neto, IVA y exento de las ventas cerradas', async () => {
    await venta({ neto: '1000.00', iva: '210.00' });
    await venta({ neto: '2000.00', iva: '420.00', exento: '500.00' });

    const r = await withCtx(() => getResumenContable(periodo));
    expect(r.ventas.cantidad).toBe(2);
    expect(Number(r.ventas.neto)).toBe(3000);
    expect(Number(r.ventas.iva)).toBe(630);
    expect(Number(r.ventas.exento)).toBe(500);
    expect(Number(r.ventas.total)).toBe(4130);
  });

  it('NO cuenta carritos abandonados ni ventas canceladas', async () => {
    await venta({ estado: 'cobrada' });
    await venta({ estado: 'draft', neto: '99999.00' });
    await venta({ estado: 'in_progress', neto: '88888.00' });
    await venta({ estado: 'cancelada', neto: '77777.00' });

    const r = await withCtx(() => getResumenContable(periodo));
    expect(r.ventas.cantidad).toBe(1);
    expect(Number(r.ventas.neto)).toBe(1000);
  });

  it('respeta el borde del período: el mes anterior NO entra', async () => {
    // Un segundo antes del 1ro a las 00:00. Es el caso que se rompe cuando
    // alguien usa `>=` y `<=` en vez de `<` en el límite superior.
    await venta({ cuando: justoAntes, neto: '5000.00' });
    await venta({ cuando: dentro, neto: '1000.00' });

    const r = await withCtx(() => getResumenContable(periodo));
    expect(r.ventas.cantidad).toBe(1);
    expect(Number(r.ventas.neto)).toBe(1000);
  });

  it('NO ve las ventas de otro comercio', async () => {
    await venta({ tenant: otroTenant, neto: '4000.00' });
    const r = await withCtx(() => getResumenContable(periodo));
    expect(r.ventas.cantidad).toBe(0);
  });

  it('un cobro reclasificado cuenta UNA vez, con el medio corregido', async () => {
    // Se registró como efectivo y era débito. Si se contaran las dos filas, el
    // arqueo del contador tendría el doble de cobros que la caja.
    const saleId = await venta({ neto: '1000.00', iva: '210.00' });
    const [original] = await db
      .insert(sale_payments)
      .values({
        tenant_id: tenantId,
        sale_id: saleId,
        method: 'efectivo',
        amount: '1210.00',
      })
      .returning({ id: sale_payments.id });
    await db.insert(sale_payments).values({
      tenant_id: tenantId,
      sale_id: saleId,
      method: 'debito',
      amount: '1210.00',
      corrects_id: original!.id,
    });

    const r = await withCtx(() => getResumenContable(periodo));
    expect(r.medios.length).toBe(1);
    expect(r.medios[0]?.medio).toBe('debito');
    expect(Number(r.medios[0]?.total)).toBe(1210);
  });

  it('el export trae una fila por venta del período', async () => {
    await venta({ neto: '1000.00' });
    await venta({ neto: '2000.00' });
    await venta({ cuando: justoAntes, neto: '9999.00' });

    const filas = await withCtx(() => getVentasParaExport(periodo));
    expect(filas.length).toBe(2);
  });
});

describe('CSV para el contador', () => {
  const fila = (extra: Partial<FilaExport> = {}): FilaExport => ({
    fecha: '2026-09-15',
    cliente: 'Kiosco El Faro',
    doc: '20987654321',
    condicion: 'monotributo',
    neto: '1000.0000',
    iva: '210.0000',
    exento: '0.0000',
    total: '1210.0000',
    medio: 'efectivo',
    ...extra,
  });

  it('usa punto y coma y coma decimal — si no, Excel en es-AR no lo abre', () => {
    // Con coma separadora y punto decimal, el contador ve UNA columna de texto
    // y tiene que reimportar a mano. Ese es justo el trabajo que esto viene a
    // sacarle.
    const csv = armarCsv([fila()]);
    const linea = csv.split('\r\n')[1]!;
    expect(linea).toContain(';');
    expect(linea).toContain('1000,00');
    expect(linea).toContain('1210,00');
    expect(linea).not.toContain('1000.00');
  });

  it('arranca con BOM: sin él Excel rompe los acentos y la ñ', () => {
    expect(armarCsv([]).charCodeAt(0)).toBe(0xfeff);
  });

  it('escapa un nombre que trae punto y coma', () => {
    // "Pérez; e hijos" partiría la fila en dos columnas.
    const csv = armarCsv([fila({ cliente: 'Pérez; e hijos' })]);
    expect(csv).toContain('"Pérez; e hijos"');
  });

  it('duplica las comillas de un nombre entrecomillado', () => {
    const csv = armarCsv([fila({ cliente: 'El "Rojo"' })]);
    expect(csv).toContain('"El ""Rojo"""');
  });

  it('siempre lleva la fila de encabezados', () => {
    const csv = armarCsv([]);
    expect(csv).toContain('Fecha;Cliente');
    expect(csv).toContain('Condición IVA');
  });
});
