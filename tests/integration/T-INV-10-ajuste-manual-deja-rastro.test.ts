/**
 * T-INV-10 — El ajuste manual de stock deja rastro en el ledger.
 *
 * ── POR QUE EXISTE ESTE TEST ──────────────────────────────────────────────
 * `adjustStock` es el único camino para corregir stock a mano. Hasta este
 * commit NO tenía un solo test — ni unitario ni de integración — y hacía
 * UPDATE de `products.stock_current` + audit, sin escribir jamás en
 * `stock_movements`.
 *
 * No llegó a perder datos: `adjustStockAction` existe en
 * `src/app/productos/actions.ts` pero ningún componente la llama todavía, así
 * que no hubo ajustes reales. El arreglo va ahora, antes de cablear la
 * pantalla, porque a partir de ese momento cada ajuste sin registrar sería un
 * hueco imposible de reconstruir después.
 *
 * Medido antes de tocar nada: `stock_movements` tenía 27 filas, TODAS
 * `type='sale'`. Cero ajustes. El único INSERT a esa tabla vivía en
 * `recordStockMovement`, al que solo llamaba `finalizeSale`.
 *
 * O sea: el libro de movimientos de stock existía, estaba bien diseñado
 * (append-only, trigger de inmutabilidad, índice por tenant+producto+fecha) y
 * la mitad de las cosas que mueven stock no pasaban por ahí.
 *
 * ── QUE PRUEBA CADA COSA ──────────────────────────────────────────────────
 * El test afirma las DOS cosas juntas: que el stock efectivamente cambió Y que
 * quedó la fila en el ledger. Solo la segunda no alcanza — si el ajuste fallara
 * por cualquier otro motivo, "no hay fila" se vería idéntico a "el ajuste no
 * deja rastro", que es justo lo que queremos distinguir.
 *
 * El caso que importa de verdad es `dos ajustes opuestos`: antes de la
 * migration 0032 la dirección no se guardaba, así que sumar 5 y restar 5
 * producían dos filas idénticas salvo el id y la hora. Ese test falla aunque
 * `adjustStock` escriba en el ledger, si el ledger no guarda el signo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { audit_log } from '@/lib/db/schema/audit';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { adjustStock } from '@/lib/services/products';
import { FiscalIntegrityError, ValidationError } from '@/lib/multi_tenant/errors';

describe('T-INV-10 — El ajuste manual deja rastro en stock_movements', () => {
  const tenant = crypto.randomUUID();
  const user = crypto.randomUUID();
  const conStock = crypto.randomUUID();
  const opuestos = crypto.randomUUID();
  const inactivo = crypto.randomUUID();
  const sinTracking = crypto.randomUUID();
  const merma = crypto.randomUUID();

  /**
   * Todo ajuste corre con el mismo contexto de tracing que usa la app.
   *
   * Desde el ajuste en pantalla (migration 0038) el service recibe un MOTIVO
   * de la lista cerrada y un detalle opcional, no un texto libre. Los tests de
   * antes usan "recuento" con su texto como detalle: son correcciones.
   */
  const ajustar = (
    product_id: string,
    delta: string,
    detalle: string,
    motivo: string = 'recuento'
  ) =>
    withTracingContext(
      {
        correlation_id: generateCorrelationId(),
        request_id: generateRequestId(),
        tenant_id: tenant,
        actor_user_id: user,
        actor_type: 'user',
      },
      () => adjustStock({ product_id, delta, motivo, detalle })
    );

  const movimientosDe = (product_id: string) =>
    db
      .select()
      .from(stock_movements)
      .where(
        and(
          eq(stock_movements.tenant_id, tenant),
          eq(stock_movements.product_id, product_id)
        )
      )
      .orderBy(asc(stock_movements.id));

  const stockDe = async (product_id: string) => {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.tenant_id, tenant), eq(products.id, product_id)))
      .limit(1);
    return rows[0]?.stock_current ?? null;
  };

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenant,
      name: 'T-INV-10 Co',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: user,
      email: `t-inv-10-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Quien ajusta',
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
      price: '100.0000',
      tax_rate: '21.00',
      stock_current: '10.0000',
      stock_tracking_enabled: true,
      is_active: true,
    };
    await db.insert(products).values([
      { ...base, id: conStock, name: 'Producto con stock' },
      { ...base, id: opuestos, name: 'Producto de los ajustes opuestos' },
      { ...base, id: inactivo, name: 'Producto dado de baja', is_active: false },
      { ...base, id: merma, name: 'Producto de la merma' },
      {
        ...base,
        id: sinTracking,
        name: 'Servicio sin control de stock',
        stock_tracking_enabled: false,
      },
    ]);
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
    });
  });

  it('sumar stock mueve el número Y deja el movimiento en el ledger', async () => {
    const resultado = await ajustar(conStock, '5', 'llegó mercadería del proveedor');

    // (1) El ajuste efectivamente pasó — sin esto, "no hay movimiento" podría
    //     significar simplemente que el ajuste falló por otra cosa.
    expect(resultado.stock_current).toBe('15.0000');
    expect(await stockDe(conStock)).toBe('15.0000');

    // (2) Y quedó registrado. Esto es lo que NO pasaba.
    const movs = await movimientosDe(conStock);
    expect(movs).toHaveLength(1);
    expect(movs[0]?.type).toBe('adjustment');
    expect(movs[0]?.direction).toBe('in');
    expect(movs[0]?.qty).toBe('5.0000');
    expect(movs[0]?.reason).toBe('Recuento · llegó mercadería del proveedor');
    expect(movs[0]?.motivo).toBe('recuento');
  });

  it('restar stock queda como movimiento out (qty positiva, el signo va aparte)', async () => {
    await ajustar(conStock, '-3', 'se había contado de más');

    expect(await stockDe(conStock)).toBe('12.0000');

    const movs = await movimientosDe(conStock);
    expect(movs).toHaveLength(2);
    // qty SIEMPRE positiva (CHECK stock_movements_qty_positive): el signo vive
    // en `direction`, no en el número.
    expect(movs[1]?.qty).toBe('3.0000');
    expect(movs[1]?.direction).toBe('out');
  });

  it('🔴 dos ajustes de la MISMA cantidad en sentidos opuestos son distinguibles', async () => {
    // Este es el caso que la migration 0032 vino a arreglar. Sin la columna
    // `direction` las dos filas son idénticas salvo id y created_at, y el
    // ledger no puede reconstruir el stock a una fecha pasada.
    await ajustar(opuestos, '4', 'conteo: había más de lo anotado');
    await ajustar(opuestos, '-4', 'conteo: se había contado dos veces');

    const movs = await movimientosDe(opuestos);
    expect(movs).toHaveLength(2);
    expect(movs.map((m) => m.direction)).toEqual(['in', 'out']);

    // Y la cuenta que justifica todo el ledger: el stock reconstruido sumando
    // los movimientos tiene que dar lo mismo que el stock guardado.
    const reconstruido = movs.reduce(
      (acc, m) => acc + (m.direction === 'in' ? Number(m.qty) : -Number(m.qty)),
      10 // stock inicial del fixture
    );
    expect(reconstruido).toBe(10);
    expect(await stockDe(opuestos)).toBe('10.0000');
  });

  it('sigue auditando stock.adjusted_manually con severidad notice (catálogo)', async () => {
    const filas = await db
      .select()
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenant),
          eq(audit_log.event_name, 'stock.adjusted_manually')
        )
      );

    // 4 ajustes exitosos hasta acá (2 en conStock + 2 en opuestos).
    expect(filas.length).toBe(4);
    // EVENT-TAXONOMY: `stock.adjusted_manually | notice | internal`.
    expect(new Set(filas.map((f) => f.severity))).toEqual(new Set(['notice']));
    expect(new Set(filas.map((f) => f.pii_level))).toEqual(new Set(['internal']));
  });

  it('un producto dado de baja NO se puede ajustar', async () => {
    // Cambio de comportamiento consciente: antes se podía mover el stock de un
    // producto soft-deleted, que es justo lo que no debería poder pasar.
    //
    // El service traduce el `ProductInactiveError` de inventory a un error de
    // dominio, porque `runAction` solo sabe mostrarle al usuario los que
    // heredan de `DomainError`: si se propagara el original, la pantalla
    // recibiría un error sin manejar en vez de un mensaje.
    await expect(
      ajustar(inactivo, '5', 'intento sobre producto inactivo')
    ).rejects.toThrow(ValidationError);
    expect(await movimientosDe(inactivo)).toHaveLength(0);
    expect(await stockDe(inactivo)).toBe('10.0000');
  });

  it('un delta de 0 se rechaza en vez de auditar que no pasó nada', async () => {
    await expect(ajustar(conStock, '0', 'ajuste vacío')).rejects.toThrow(ValidationError);
    // Y no dejó basura: siguen siendo los 2 movimientos de los tests anteriores.
    expect(await movimientosDe(conStock)).toHaveLength(2);
  });

  it('no se puede dejar el stock en negativo, y el intento no deja rastro', async () => {
    const antes = await stockDe(conStock);
    await expect(ajustar(conStock, '-999', 'más de lo que hay')).rejects.toThrow(
      FiscalIntegrityError
    );

    // Además de la clase de error: el estado no se movió ni por un lado ni por
    // el otro. Un ajuste rechazado que igual dejara media fila sería peor que
    // el bug original.
    expect(await stockDe(conStock)).toBe(antes);
    expect(await movimientosDe(conStock)).toHaveLength(2);
  });

  it('producto sin control de stock: registra el movimiento, no toca el número', async () => {
    // Cambio de comportamiento consciente: antes `adjustStock` movía
    // `stock_current` incluso con `stock_tracking_enabled = false`, que es
    // contradictorio con lo que ese flag significa.
    await ajustar(sinTracking, '7', 'ajuste sobre un servicio');

    const movs = await movimientosDe(sinTracking);
    expect(movs).toHaveLength(1);
    expect(movs[0]?.direction).toBe('in');
    expect(await stockDe(sinTracking)).toBe('10.0000');
  });

  // ── Merma y corrección (migration 0038) ────────────────────────────────────

  it('🔴 una rotura queda como MERMA: loss, sale, con su motivo en columna', async () => {
    await ajustar(merma, '-2', 'se cayó el pack', 'rotura');

    expect(await stockDe(merma)).toBe('8.0000');
    const movs = await movimientosDe(merma);
    expect(movs).toHaveLength(1);
    expect(movs[0]?.type).toBe('loss');
    expect(movs[0]?.direction).toBe('out');
    expect(movs[0]?.motivo).toBe('rotura');
    expect(movs[0]?.reason).toBe('Rotura · se cayó el pack');

    // Se audita con el MISMO evento del catálogo, y el payload dice qué fue:
    // sin type y motivo ahí, una merma y un recuento serían indistinguibles.
    const [audit] = await db
      .select()
      .from(audit_log)
      .where(
        and(
          eq(audit_log.tenant_id, tenant),
          eq(audit_log.event_name, 'stock.adjusted_manually'),
          sql`${audit_log.payload}->>'product_id' = ${merma}`
        )
      );
    expect(audit?.payload).toMatchObject({ type: 'loss', motivo: 'rotura' });
  });

  it('🔴 una merma que SUMA se rechaza y no deja rastro', async () => {
    await expect(ajustar(merma, '3', 'apareció', 'robo')).rejects.toThrow(ValidationError);
    expect(await stockDe(merma)).toBe('8.0000');
    expect(await movimientosDe(merma)).toHaveLength(1);
  });

  it('🔴 "Otro" sin detalle se rechaza: sería un ajuste sin motivo', async () => {
    await expect(ajustar(merma, '1', '', 'otro')).rejects.toThrow(ValidationError);
    expect(await movimientosDe(merma)).toHaveLength(1);
  });

  it('un motivo que no está en la lista se rechaza', async () => {
    await expect(ajustar(merma, '-1', 'x', 'regalo')).rejects.toThrow(ValidationError);
  });
});
