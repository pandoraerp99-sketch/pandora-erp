/**
 * T-ADJ-03 — el gasto queda apuntando a la ficha del proveedor.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 * El ítem 12 pide "alquileres (CON CONTRATO)" y el contrato cuelga del
 * PROVEEDOR, no del gasto (un contrato respalda doce pagos). Pero elegir el
 * proveedor de la lista era opcional y nadie lo elegía: 0 de 18 gastos de la
 * base de dev tenían `tercero_id`, los dos de alquiler incluidos. Con eso, el
 * contrato colgaba de una fila que ningún gasto señalaba y la contadora no
 * podía unirlo con la deducción.
 *
 * Lo que se prueba acá no es "la función hace lo que dice" sino la condición
 * que el slice necesita: **después de cargar el alquiler, existe un camino del
 * gasto a la ficha**. Y, del otro lado, que dar de alta en el catálogo siga
 * siendo del dueño — porque de esa lista salen los destinatarios de los
 * retiros de caja, y cargar un gasto no puede ser la puerta de atrás.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses } from '@/lib/db/schema/expenses';
import { terceros } from '@/lib/db/schema/terceros';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { registerExpense } from '@/lib/services/expenses/expense.service';

const CUIT_LOCADOR = '30712345671';

describe('T-ADJ-03 — el gasto encuentra la ficha del proveedor', () => {
  const tenant = crypto.randomUUID();
  const duenia = crypto.randomUUID();
  const cajero = crypto.randomUUID();

  const en = <T,>(userId: string, fn: () => Promise<T>): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenant,
          actor_user_id: userId,
          actor_type: 'user',
        },
        fn
      )
    );

  // El rol NO va en el input: el service lo lee de `company_users` por
  // (tenant, usuario). Por eso lo que cambia entre un caso y otro es QUIÉN
  // actúa —`en(duenia, …)` contra `en(cajero, …)`— y no un campo que el que
  // llama podría mandar dibujado.
  const alquiler = (extra: Record<string, unknown> = {}) => ({
    fecha: '2026-03-05',
    categoria: 'alquiler' as const,
    neto: '0',
    iva: '0',
    total: '400000',
    payee_name: 'Inmobiliaria Del Sur',
    payee_doc: CUIT_LOCADOR,
    comprobante_tipo: 'B',
    comprobante_numero: '0003-00004521',
    en_iva_compras: true,
    medio_pago: 'transferencia' as const,
    ...extra,
  });

  const fichasDelLocador = () =>
    db
      .select()
      .from(terceros)
      .where(and(eq(terceros.tenant_id, tenant), eq(terceros.doc, CUIT_LOCADOR)));

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenant,
      name: 'T-ADJ-03 Comercio',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values([
      {
        id: duenia,
        email: `t-adj-03-duenia-${tenant.slice(0, 8)}@test.local`,
        full_name: 'Dueña',
        is_support: false,
      },
      {
        id: cajero,
        email: `t-adj-03-cajero-${tenant.slice(0, 8)}@test.local`,
        full_name: 'Cajero',
        is_support: false,
      },
    ]);
    await db.insert(company_users).values([
      { id: crypto.randomUUID(), company_id: tenant, user_id: duenia, role: 'owner' },
      { id: crypto.randomUUID(), company_id: tenant, user_id: cajero, role: 'cashier' },
    ]);
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.execute(sql`DELETE FROM expense_items WHERE tenant_id = ${tenant}`);
      await tx.delete(expenses).where(eq(expenses.tenant_id, tenant));
      await tx.delete(terceros).where(eq(terceros.tenant_id, tenant));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(inArray(users.id, [duenia, cajero]));
      await tx.delete(companies).where(eq(companies.id, tenant));
    });
  });

  it('🔴 el alquiler con CUIT deja el gasto apuntando a la ficha del locador', async () => {
    expect(await fichasDelLocador()).toHaveLength(0);

    const gasto = await en(duenia, () => registerExpense(alquiler()));

    // Lo que importa NO es que exista la ficha, sino que se pueda ir del gasto
    // a ella: es el camino que el contrato del ítem 12 necesita.
    expect(gasto.tercero_id).not.toBeNull();

    const [ficha] = await fichasDelLocador();
    expect(ficha!.id).toBe(gasto.tercero_id);
    expect(ficha!.type).toBe('proveedor');
    expect(ficha!.name).toBe('Inmobiliaria Del Sur');
  });

  it('🔴 el alquiler del mes siguiente reusa la MISMA ficha, no crea otra', async () => {
    const segundo = await en(duenia, () =>
      registerExpense(alquiler({ fecha: '2026-04-05', comprobante_numero: '0003-00004599' }))
    );

    // Si cada mes creara una ficha nueva, el contrato quedaría colgado de la de
    // marzo y los pagos de abril en adelante no llegarían a él.
    const fichas = await fichasDelLocador();
    expect(fichas).toHaveLength(1);
    expect(segundo.tercero_id).toBe(fichas[0]!.id);
  });

  it('🔴 el nombre escrito distinto NO parte al locador en dos: manda el CUIT', async () => {
    const otro = await en(duenia, () =>
      registerExpense(
        alquiler({
          fecha: '2026-05-05',
          comprobante_numero: '0003-00004650',
          payee_name: 'INMOB. DEL SUR',
        })
      )
    );

    const fichas = await fichasDelLocador();
    expect(fichas).toHaveLength(1);
    expect(otro.tercero_id).toBe(fichas[0]!.id);

    // Y el gasto conserva el nombre TIPEADO, no el de la ficha.
    //
    // Escribí este test esperando lo contrario y estaba equivocado yo, no el
    // código: el gasto es la evidencia de un comprobante, y si el papel dice
    // "INMOB. DEL SUR" eso es lo que se registró. Pisarlo con el nombre del
    // catálogo cambiaría en silencio lo que el usuario cargó, y si la ficha
    // quedó con un nombre viejo el gasto pasaría a decir algo que el
    // comprobante no dice.
    //
    // Consecuencia buscada: la tarjeta "Por proveedor" agrupa por `tercero_id`
    // —así que sigue siendo UNA fila con UN CUIT— y muestra las dos grafías
    // separadas por " / ". Eso es informativo, no sucio: dice que el mismo
    // CUIT se cargó escrito de dos formas, que es justo lo que esa tarjeta
    // existe para que alguien revise antes de mandarlo (ítem 9).
    expect(otro.payee_name).toBe('INMOB. DEL SUR');
  });

  it('🔴 un gasto SIN CUIT no inventa ninguna ficha', async () => {
    const antes = (await db.select().from(terceros).where(eq(terceros.tenant_id, tenant))).length;

    const suelto = await en(duenia, () =>
      registerExpense({
        fecha: '2026-03-06',
        categoria: 'otros',
        neto: '0',
        iva: '0',
        total: '18450',
        payee_name: 'Ferretería del barrio',
        en_iva_compras: false,
        medio_pago: 'transferencia',
      })
    );

    expect(suelto.tercero_id).toBeNull();
    const despues = (await db.select().from(terceros).where(eq(terceros.tenant_id, tenant))).length;
    expect(despues).toBe(antes);
  });

  // ── La mitad que protege ──────────────────────────────────────────────────

  it('🔴 un cajero VINCULA a la ficha que ya existe (no le otorga nada nuevo)', async () => {
    const [ficha] = await fichasDelLocador();

    const gasto = await en(cajero, () =>
      registerExpense(
        alquiler({ fecha: '2026-06-05', comprobante_numero: '0003-00004700' })
      )
    );

    expect(gasto.tercero_id).toBe(ficha!.id);
  });

  it('🔴 un cajero NO puede dar de alta una ficha nueva cargando un gasto', async () => {
    const CUIT_NUEVO = '27999888771';
    const antes = (await db.select().from(terceros).where(eq(terceros.tenant_id, tenant))).length;

    // El gasto se carga igual — el hecho no se pierde — pero el catálogo de
    // beneficiarios, del que salen los destinatarios de los retiros de caja,
    // lo sigue administrando sólo el dueño.
    const gasto = await en(cajero, () =>
      registerExpense(
        alquiler({
          fecha: '2026-06-10',
          comprobante_numero: '0003-00004777',
          payee_name: 'Seguros del Fin del Mundo',
          payee_doc: CUIT_NUEVO,
        })
      )
    );

    expect(gasto.tercero_id).toBeNull();
    // Y el gasto conserva a quién se le pagó, que es lo que la contadora lee.
    expect(gasto.payee_doc).toBe(CUIT_NUEVO);
    expect(gasto.payee_name).toBe('Seguros del Fin del Mundo');

    const despues = (await db.select().from(terceros).where(eq(terceros.tenant_id, tenant))).length;
    expect(despues).toBe(antes);
  });

  it('🔴 elegir el proveedor a mano sigue mandando sobre el CUIT tipeado', async () => {
    const [ficha] = await fichasDelLocador();

    const gasto = await en(duenia, () =>
      registerExpense(
        alquiler({
          fecha: '2026-07-05',
          comprobante_numero: '0003-00004800',
          tercero_id: ficha!.id,
          // Un CUIT distinto en el formulario no puede pisar la elección
          // explícita: el nombre y el doc salen de la ficha elegida.
          payee_doc: '30999999999',
          payee_name: 'algo tipeado mal',
        })
      )
    );

    expect(gasto.tercero_id).toBe(ficha!.id);
    expect(gasto.payee_doc).toBe(CUIT_LOCADOR);
    expect(gasto.payee_name).toBe('Inmobiliaria Del Sur');
  });
});
