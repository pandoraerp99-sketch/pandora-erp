/**
 * T-PANEL-02 — Merma del mes y valor del stock (RESEARCH-BRIEF-panel §8.e).
 *
 * Los casos que importan son los que harían mentir al bloque SIN que ningún
 * número se vea raro:
 *
 *   - 🔴 el STOCK INICIAL entra como `adjustment` sin motivo: contarlo como
 *     "corrección" mostraría la carga del catálogo como errores;
 *   - 🔴 la salida de una COMPRA ANULADA es `adjustment` sin motivo: tampoco;
 *   - la merma del mes pasado y la del mes que viene no son de este mes;
 *   - un producto sin costo no aporta $0: aporta unidades sin costo;
 *   - la merma del vecino no es mía.
 *
 * Las filas se insertan directo en el libro con la `fecha` que el caso necesita
 * (el trigger de inmutabilidad sólo bloquea UPDATE/DELETE). Un caso además pasa
 * por `adjustStock`, el camino real, para no probar sólo fixtures.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { stock_movements, type NewStockMovement } from '@/lib/db/schema/stock_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import { getMermaDelMes, getValorStock } from '@/lib/services/reporting/merma.report';
import { calcularMerma, calcularValorStock } from '@/lib/reporting/merma';
import { adjustStock } from '@/lib/services/products';

describe('T-PANEL-02 — merma del mes y valor del stock', () => {
  const tenant = crypto.randomUUID();
  const vecino = crypto.randomUUID();
  const user = crypto.randomUUID();
  const yerba = crypto.randomUUID(); // costo 2400
  const leche = crypto.randomUUID(); // costo 500
  const sinCosto = crypto.randomUUID(); // cost NULL
  const inactivo = crypto.randomUUID();
  const servicio = crypto.randomUUID();
  const agotado = crypto.randomUUID();
  const delVecino = crypto.randomUUID();

  // Fechas del COMERCIO, no de UTC.
  const hoy = diaDelComercio();
  const [y, m] = hoy.split('-').map(Number) as [number, number];
  const primeroDelMes = `${hoy.slice(0, 7)}-01`;
  const ultimoDelMesPasado = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  const primeroDelMesQueViene = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const en = <T,>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: user,
          actor_type: 'user',
        },
        fn
      )
    );

  const mov = (v: Partial<NewStockMovement> & Pick<NewStockMovement, 'product_id'>) => ({
    tenant_id: tenant,
    type: 'loss',
    direction: 'out' as const,
    qty: '1.0000',
    fecha: primeroDelMes,
    created_by: user,
    ...v,
  });

  const crearEmpresa = (id: string, nombre: string) =>
    db.insert(companies).values({
      id,
      name: nombre,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });

  beforeAll(async () => {
    await crearEmpresa(tenant, 'T-PANEL-02 Co');
    await crearEmpresa(vecino, 'T-PANEL-02 Vecino');
    await db.insert(users).values({
      id: user,
      email: `t-panel-02-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Dueña',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenant,
      user_id: user,
      role: 'owner',
    });

    const base = {
      tenant_id: tenant,
      unit_type: 'unidad' as const,
      price: '5000.0000',
      tax_rate: '21.00',
      stock_tracking_enabled: true,
      is_active: true,
    };
    await db.insert(products).values([
      { ...base, id: yerba, name: 'Yerba', cost: '2400.0000', stock_current: '10.0000' },
      { ...base, id: leche, name: 'Leche', cost: '500.0000', stock_current: '20.0000' },
      { ...base, id: sinCosto, name: 'Alfajor sin costo', cost: null, stock_current: '4.0000' },
      // No suman al valor del stock, por tres razones distintas:
      { ...base, id: inactivo, name: 'Dado de baja', cost: '100.0000', stock_current: '50.0000', is_active: false },
      { ...base, id: servicio, name: 'Servicio', cost: '100.0000', stock_current: '50.0000', stock_tracking_enabled: false },
      { ...base, id: agotado, name: 'Agotado', cost: '100.0000', stock_current: '0.0000' },
      { ...base, id: delVecino, tenant_id: vecino, name: 'Del vecino', cost: '9999.0000', stock_current: '99.0000' },
    ]);

    await db.insert(stock_movements).values([
      // ── Merma de ESTE mes ──
      mov({ product_id: yerba, motivo: 'rotura', qty: '2.0000' }),
      mov({ product_id: leche, motivo: 'vencimiento', qty: '3.0000' }),
      mov({ product_id: leche, motivo: 'vencimiento', qty: '1.0000', fecha: hoy }),
      mov({ product_id: sinCosto, motivo: 'robo', qty: '1.0000' }),
      // ── Fuera del mes ──
      mov({ product_id: yerba, motivo: 'robo', qty: '7.0000', fecha: ultimoDelMesPasado }),
      mov({ product_id: yerba, motivo: 'robo', qty: '7.0000', fecha: primeroDelMesQueViene }),
      // ── Correcciones declaradas ──
      mov({ product_id: leche, type: 'adjustment', direction: 'in', motivo: 'recuento', reason: 'Recuento · x' }),
      mov({ product_id: leche, type: 'adjustment', direction: 'out', motivo: 'error_carga', reason: 'Error · x' }),
      mov({ product_id: yerba, type: 'adjustment', direction: 'out', motivo: 'error_carga', reason: 'Error · y' }),
      // 🔴 Movimientos del SISTEMA: adjustment SIN motivo — no son correcciones
      mov({ product_id: yerba, type: 'adjustment', direction: 'in', motivo: null, qty: '100.0000', reason: 'Stock inicial declarado en el alta del producto' }),
      mov({ product_id: leche, type: 'adjustment', direction: 'out', motivo: null, qty: '5.0000', reason: 'Anulación de compra · 0001-00000001' }),
      // ── Del vecino ──
      mov({ tenant_id: vecino, product_id: delVecino, motivo: 'robo', qty: '50.0000' }),
      mov({ tenant_id: vecino, product_id: delVecino, type: 'adjustment', direction: 'out', motivo: 'recuento', reason: 'x' }),
    ]);
  });

  afterAll(async () => {
    const tenants = [tenant, vecino];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(stock_movements).where(inArray(stock_movements.tenant_id, tenants));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, tenants));
      await tx.delete(products).where(inArray(products.tenant_id, tenants));
      await tx.delete(company_users).where(inArray(company_users.company_id, tenants));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(inArray(companies.id, tenants));
    });
  });

  it('merma por motivo: sólo este mes, sólo este comercio, pesos a costo de última compra', async () => {
    const crudo = await en(tenant, () => getMermaDelMes());
    const porMotivo = Object.fromEntries(crudo.motivos.map((x) => [x.motivo, x]));

    expect(Object.keys(porMotivo).sort()).toEqual(['robo', 'rotura', 'vencimiento']);
    expect(porMotivo.rotura).toMatchObject({ unidades: '2.0000', costo: '4800.0000', filas: 1 });
    // Dos filas en el mes (una el 1º, otra hoy): 4 × 500.
    expect(porMotivo.vencimiento).toMatchObject({ unidades: '4.0000', costo: '2000.0000', filas: 2 });
    // El robo del mes pasado y el del mes que viene (7 + 7 de yerba) NO entran;
    // el del vecino (50) tampoco. Queda sólo el alfajor, que no tiene costo.
    expect(porMotivo.robo).toMatchObject({
      unidades: '1.0000',
      unidades_sin_costo: '1.0000',
      costo: '0.0000',
      filas: 1,
    });
  });

  it('🔴 el total es parcial: el alfajor sin costo NO vale $0, son unidades sin valorizar', async () => {
    const crudo = await en(tenant, () => getMermaDelMes());
    const merma = calcularMerma(crudo.motivos, crudo.productos);
    expect(merma.estado).toBe('parcial');
    expect(merma.costo).toBe('6800.0000');
    expect(merma.unidades).toBe('7.0000');
    expect(merma.unidadesSinCosto).toBe('1.0000');
    expect(merma.productos.map((p) => [p.nombre, p.costo])).toEqual([
      ['Yerba', '4800.0000'],
      ['Leche', '2000.0000'],
      ['Alfajor sin costo', null],
    ]);
  });

  it('🔴 correcciones: sólo las declaradas — ni el stock inicial ni la compra anulada', async () => {
    const crudo = await en(tenant, () => getMermaDelMes());
    expect(crudo.correcciones).toEqual([
      { motivo: 'error_carga', filas: 2 },
      { motivo: 'recuento', filas: 1 },
    ]);
  });

  it('valor del stock: activos, con control de stock y con unidades; el sin costo se cuenta aparte', async () => {
    const crudo = await en(tenant, () => getValorStock());
    // 10 × 2400 + 20 × 500. Ni el dado de baja, ni el servicio, ni el agotado,
    // ni los 99 × 9999 del vecino.
    expect(crudo).toEqual({ valor: '34000.0000', productos_con_stock: 3, productos_sin_costo: 1 });
    expect(calcularValorStock(crudo)).toMatchObject({ estado: 'parcial', valor: '34000.0000' });
  });

  it('el vecino ve SU merma, no la mía', async () => {
    const crudo = await en(vecino, () => getMermaDelMes());
    expect(crudo.motivos).toEqual([
      { motivo: 'robo', unidades: '50.0000', unidades_sin_costo: '0.0000', costo: '499950.0000', filas: 1 },
    ]);
    expect(crudo.correcciones).toEqual([{ motivo: 'recuento', filas: 1 }]);
  });

  it('una rotura cargada por el camino real (adjustStock) aparece en el bloque', async () => {
    const antes = calcularMerma(...(await en(tenant, async () => {
      const c = await getMermaDelMes();
      return [c.motivos, c.productos] as const;
    })));
    await en(tenant, () =>
      adjustStock({ product_id: yerba, delta: '-1', motivo: 'rotura', detalle: 'se cayó' })
    );
    const c = await en(tenant, () => getMermaDelMes());
    const despues = calcularMerma(c.motivos, c.productos);
    expect(despues.movimientos).toBe(antes.movimientos + 1);
    expect(despues.costo).toBe('9200.0000'); // 6800 + 2400
  });
});
