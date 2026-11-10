/**
 * T-ADJ-05 — la contadora BAJA los comprobantes, y no los toca (ítem 12, slice 4).
 *
 * ── POR QUÉ ESTE TEST EXISTE ──────────────────────────────────────────────
 * El slice 4 le da a la contadora los archivos. Eso es lo que el ítem 12 pide.
 * Pero darle una pantalla nueva obligó a preguntar algo que nadie había
 * preguntado: ¿qué le impide ESCRIBIR?
 *
 * La respuesta era nada. Dos capas que parecían cubrirlo, y no cubrían:
 *
 *   1. `ContadorClient.tsx` no dibuja el botón. CLAUDE.md §6.4 dice, con todas
 *      las letras, que esconder un botón NO es autorización — y ahí abajo hay
 *      un comentario que afirma "el rol `accountant` mira y exporta" sin que
 *      nada lo verifique. Un comentario que promete una garantía que no existe
 *      es peor que no tenerlo (§20.27).
 *   2. El RLS. Se midió: la conexión de Drizzle entra como `postgres` con
 *      `rolbypassrls = true` (`scripts/ver-rol-de-la-conexion.sh`). Ninguna
 *      policy corre sobre las escrituras del service layer. El RLS protege el
 *      límite entre comercios por el lado del cliente de Supabase, pero no
 *      dice una palabra sobre roles adentro del mismo comercio.
 *
 * Así que la guardia tiene que ser TypeScript, y tiene que estar en el
 * SERVICE: las actions son llamables de a una, y un chequeo en
 * `/contador/actions.ts` no protegería `/gastos/actions.ts`.
 *
 * ── EL ROL SE LEE, NO SE RECIBE ───────────────────────────────────────────
 * Mismo criterio que `vincularProveedorPorCuit`: se consulta `company_users`
 * por (tenant, usuario). Un parámetro `actor_role` alcanzaría para que quien
 * llama se declare owner.
 *
 * ── LA MITAD QUE SE OLVIDA ────────────────────────────────────────────────
 * Probar sólo que la contadora NO puede subir dejaría pasar una guardia
 * demasiado ancha —una que también le trabe la pantalla a la dueña— y una que
 * rechace DESPUÉS de subir, dejando bytes huérfanos en el bucket. Se prueban
 * las dos mitades y el momento.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses } from '@/lib/db/schema/expenses';
import { terceros } from '@/lib/db/schema/terceros';
import { attachments } from '@/lib/db/schema/attachments';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { annulExpense, registerExpense } from '@/lib/services/expenses/expense.service';
import {
  adjuntarComprobante,
  adjuntarContrato,
  contarAdjuntosPorGasto,
  listarAdjuntosDeGasto,
  listarComprobantesDelPeriodo,
  listarContratosDeTercero,
  quitarComprobante,
  urlParaDescargar,
  SoloLecturaError,
  ContratoReservadoError,
} from '@/lib/services/expenses/attachment.service';
import type { AlmacenDeComprobantes } from '@/lib/services/expenses/attachment.storage';

function almacenFalso() {
  const subidas: string[] = [];
  const almacen: AlmacenDeComprobantes = {
    async subir(path) {
      subidas.push(path);
      return { error: null };
    },
    async borrar() {
      return { error: null };
    },
    async existe() {
      return true;
    },
    async firmar(path) {
      return `https://firmado.test/${path}`;
    },
  };
  return { almacen, subidas };
}

const pdf = (nombre = 'factura.pdf') => ({
  nombre,
  contentType: 'application/pdf',
  bytes: new TextEncoder().encode('%PDF-1.4 comprobante'),
});

describe('T-ADJ-05 — la contadora baja, no sube', () => {
  const tenant = crypto.randomUUID();
  const duenia = crypto.randomUUID();
  const contadora = crypto.randomUUID();
  let gasto: string;
  let proveedor: string;
  let adjunto: string;

  const como = <T,>(userId: string, fn: () => Promise<T>): Promise<T> =>
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

  beforeAll(async () => {
    await db.insert(companies).values({
      id: tenant,
      name: 'T-ADJ-05 Comercio',
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
        email: `t-adj-05-duenia-${tenant.slice(0, 8)}@test.local`,
        full_name: 'Dueña',
        is_support: false,
      },
      {
        id: contadora,
        email: `t-adj-05-contadora-${tenant.slice(0, 8)}@test.local`,
        full_name: 'Contadora',
        is_support: false,
      },
    ]);
    await db.insert(company_users).values([
      { id: crypto.randomUUID(), company_id: tenant, user_id: duenia, role: 'owner' },
      {
        id: crypto.randomUUID(),
        company_id: tenant,
        user_id: contadora,
        role: 'accountant',
      },
    ]);

    const g = await como(duenia, () =>
      registerExpense({
        fecha: '2026-03-10',
        categoria: 'servicios',
        neto: '10000',
        iva: '2100',
        total: '12100',
        payee_name: 'Edenor',
        comprobante_tipo: 'B',
        comprobante_numero: '0001-00099999',
        en_iva_compras: true,
        medio_pago: 'transferencia',
      })
    );
    gasto = g.id;

    const [t] = await db
      .insert(terceros)
      .values({ tenant_id: tenant, type: 'proveedor', name: 'Inmobiliaria', sort_order: 1 })
      .returning();
    proveedor = t!.id;

    // Lo sube la DUEÑA: para que la contadora tenga algo que bajar.
    const a = await como(duenia, () =>
      adjuntarComprobante({ expense_id: gasto, archivo: pdf() }, almacenFalso().almacen)
    );
    adjunto = a.id;
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(attachments).where(eq(attachments.tenant_id, tenant));
      await tx.execute(sql`DELETE FROM expense_items WHERE tenant_id = ${tenant}`);
      await tx.delete(expenses).where(eq(expenses.tenant_id, tenant));
      await tx.delete(terceros).where(eq(terceros.tenant_id, tenant));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenant));
      await tx.delete(company_users).where(eq(company_users.company_id, tenant));
      await tx.delete(users).where(inArray(users.id, [duenia, contadora]));
      await tx.delete(companies).where(eq(companies.id, tenant));
    });
  });

  // ── Lo que el ítem 12 pide: que los pueda bajar ───────────────────────────

  it('🔴 la contadora VE el comprobante del gasto', async () => {
    const lista = await como(contadora, () =>
      listarAdjuntosDeGasto(gasto, almacenFalso().almacen)
    );
    expect(lista).toHaveLength(1);
    expect(lista[0]!.nombre_original).toBe('factura.pdf');
    expect(lista[0]!.archivo_presente).toBe(true);
  });

  it('🔴 la contadora BAJA el comprobante: es el punto del slice', async () => {
    const r = await como(contadora, () => urlParaDescargar(adjunto, almacenFalso().almacen));
    expect(r).toMatchObject({ nombre: 'factura.pdf' });
  });

  it('🔴 la contadora ve el clip en la lista', async () => {
    const cuenta = await como(contadora, () => contarAdjuntosPorGasto([gasto]));
    expect(cuenta[gasto]).toBe(1);
  });

  // ── B-11: los contratos, cerrados de verdad ──────────────────────────────
  // Este test decía lo CONTRARIO: que la contadora podía listar los contratos
  // del proveedor. Y el commit del slice 4 afirmaba que los contratos "no
  // salen" para ella mientras B-11 siga abierta. Las dos cosas eran ciertas a
  // la vez porque la exclusión vivía sólo en la consulta de /contador: desde
  // /gastos —a la que entra, porque ninguna ruta filtra por rol— los listaba,
  // y `urlParaDescargar` no miraba el tipo, así que con el id bajaba un
  // contrato igual. Esconderlo de una lista no es cerrarlo.

  it('🔴 la contadora NO puede listar los contratos de un proveedor', async () => {
    await expect(
      como(contadora, () =>
        listarContratosDeTercero(proveedor, '2026-09-20', almacenFalso().almacen)
      )
    ).rejects.toThrow(ContratoReservadoError);
  });

  it('🔴 la contadora NO puede bajar un contrato aunque tenga el id', async () => {
    const c = await como(duenia, () =>
      adjuntarContrato(
        {
          tercero_id: proveedor,
          archivo: pdf('contrato-con-datos-del-locador.pdf'),
          vigencia_desde: '2026-01-01',
          vigencia_hasta: '2026-12-31',
        },
        almacenFalso().almacen
      )
    );

    await expect(
      como(contadora, () => urlParaDescargar(c.id, almacenFalso().almacen))
    ).rejects.toThrow(ContratoReservadoError);

    // La mitad que se olvida: la dueña lo sigue bajando, y la contadora sigue
    // bajando COMPROBANTES — la guardia es por tipo, no por la descarga.
    await expect(
      como(duenia, () => urlParaDescargar(c.id, almacenFalso().almacen))
    ).resolves.toMatchObject({ nombre: 'contrato-con-datos-del-locador.pdf' });
    await expect(
      como(contadora, () => urlParaDescargar(adjunto, almacenFalso().almacen))
    ).resolves.toMatchObject({ nombre: 'factura.pdf' });
  });

  // ── Lo que nadie estaba impidiendo ────────────────────────────────────────

  it('🔴 la contadora NO puede subir un comprobante, y no quedan bytes arriba', async () => {
    const f = almacenFalso();
    await expect(
      como(contadora, () =>
        adjuntarComprobante({ expense_id: gasto, archivo: pdf('mia.pdf') }, f.almacen)
      )
    ).rejects.toThrow(SoloLecturaError);

    // El momento importa tanto como el rechazo: una guardia que corriera
    // DESPUÉS de subir dejaría el objeto huérfano en el bucket cada vez.
    expect(f.subidas).toHaveLength(0);
  });

  it('🔴 la contadora NO puede subir un contrato', async () => {
    const f = almacenFalso();
    await expect(
      como(contadora, () =>
        adjuntarContrato(
          {
            tercero_id: proveedor,
            archivo: pdf('contrato.pdf'),
            vigencia_desde: '2026-01-01',
            vigencia_hasta: '2026-12-31',
          },
          f.almacen
        )
      )
    ).rejects.toThrow(SoloLecturaError);
    expect(f.subidas).toHaveLength(0);
  });

  it('🔴 la contadora NO puede quitar un comprobante', async () => {
    await expect(
      como(contadora, () => quitarComprobante({ attachment_id: adjunto, motivo: 'no va' }))
    ).rejects.toThrow(SoloLecturaError);

    const [fila] = await db.select().from(attachments).where(eq(attachments.id, adjunto));
    expect(fila!.removed_at).toBeNull();
  });

  // ── La mitad que se olvida: que la guardia no sea demasiado ancha ─────────

  it('🔴 la dueña SIGUE pudiendo quitar: la guardia no le trabó la pantalla', async () => {
    const otro = await como(duenia, () =>
      adjuntarComprobante(
        { expense_id: gasto, archivo: pdf('duplicado.pdf') },
        almacenFalso().almacen
      )
    );
    await expect(
      como(duenia, () => quitarComprobante({ attachment_id: otro.id, motivo: 'subí el mismo dos veces' }))
    ).resolves.toBeUndefined();
  });

  // ── La lista que ve en /contador ─────────────────────────────────────────
  // Esto existe porque la primera versión de la consulta aliaseaba la tabla
  // como `e` mientras `GASTO_VIGENTE_SQL` nombra `expenses` adentro: no
  // compilaba, y la pantalla no mostraba NADA sin decir por qué. Lo cazó una
  // captura, que es tarde: lo tiene que cazar un test.

  it('🔴 la contadora ve los comprobantes del período, con el dato del gasto', async () => {
    const lista = await como(contadora, () =>
      listarComprobantesDelPeriodo('2026-03-01', '2026-03-31')
    );
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      nombre_original: 'factura.pdf',
      expense_id: gasto,
      fecha: '2026-03-10',
      payee_name: 'Edenor',
      comprobante_numero: '0001-00099999',
    });
  });

  it('🔴 un comprobante FUERA del período no entra', async () => {
    const lista = await como(contadora, () =>
      listarComprobantesDelPeriodo('2026-04-01', '2026-04-30')
    );
    expect(lista).toEqual([]);
  });

  it('🔴 el contrato del proveedor NO sale en la lista de la contadora', async () => {
    // B-11 sigue abierta con el abogado: un contrato de locación lleva los
    // datos personales del locador, y mostrárselo a un tercero que no es el
    // comercio contestaría esa pregunta de hecho. Se difiere a propósito.
    await como(duenia, () =>
      adjuntarContrato(
        {
          tercero_id: proveedor,
          archivo: pdf('contrato-locacion.pdf'),
          vigencia_desde: '2026-03-01',
          vigencia_hasta: '2026-12-31',
        },
        almacenFalso().almacen
      )
    );

    const lista = await como(contadora, () =>
      listarComprobantesDelPeriodo('2026-01-01', '2026-12-31')
    );
    expect(lista.some((c) => c.nombre_original === 'contrato-locacion.pdf')).toBe(false);
  });

  it('🔴 el comprobante de un gasto ANULADO deja de salir', async () => {
    // El gasto se anula insertando una fila en cero que lo apunta: el adjunto
    // sigue existiendo. Si igual se listara, el estudio cargaría el respaldo
    // de algo que ya no existe.
    const g = await como(duenia, () =>
      registerExpense({
        fecha: '2026-03-15',
        categoria: 'servicios',
        neto: '1000',
        iva: '210',
        total: '1210',
        payee_name: 'Se anula',
        comprobante_tipo: 'B',
        comprobante_numero: '0001-00088888',
        en_iva_compras: true,
        medio_pago: 'transferencia',
      })
    );
    await como(duenia, () =>
      adjuntarComprobante(
        { expense_id: g.id, archivo: pdf('de-un-anulado.pdf') },
        almacenFalso().almacen
      )
    );

    const antes = await como(contadora, () =>
      listarComprobantesDelPeriodo('2026-03-01', '2026-03-31')
    );
    expect(antes.some((c) => c.nombre_original === 'de-un-anulado.pdf')).toBe(true);

    await como(duenia, () =>
      annulExpense({ expense_id: g.id, motivo: 'lo cargué dos veces' })
    );

    const despues = await como(contadora, () =>
      listarComprobantesDelPeriodo('2026-03-01', '2026-03-31')
    );
    expect(despues.some((c) => c.nombre_original === 'de-un-anulado.pdf')).toBe(false);
  });

  it('🔴 un usuario SIN membresía en el comercio tampoco escribe', async () => {
    // El caso que una lista blanca de "roles que no escriben" deja pasar: sin
    // fila en `company_users` no hay rol que prohibir, y la guardia que
    // pregunta "¿es contador?" contestaría que no.
    const f = almacenFalso();
    await expect(
      como(crypto.randomUUID(), () =>
        adjuntarComprobante({ expense_id: gasto, archivo: pdf('intruso.pdf') }, f.almacen)
      )
    ).rejects.toThrow(SoloLecturaError);
    expect(f.subidas).toHaveLength(0);
  });
});
