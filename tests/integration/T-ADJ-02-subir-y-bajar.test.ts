/**
 * T-ADJ-02 — subir y bajar el comprobante (ítem 12, slice 2).
 *
 * ── QUÉ PRUEBA ESTO QUE T-ADJ-01 NO PODÍA ────────────────────────────────
 * T-ADJ-01 inserta las filas de `storage.objects` A MANO, con el path ya
 * escrito. Lo que probó, entonces, es "la policy es correcta **si** el path es
 * correcto". Que el que sube escriba `{tenant_id}/...` —y no algo que venga
 * del usuario— no lo garantizaba nada.
 *
 * Eso es lo que se prueba acá, y es la garantía que más pesa: el path es el
 * ÚNICO lugar donde se decide de qué comercio son esos bytes. La FK compuesta
 * de la 0041 atrapa un `expense_id` ajeno pero no mira el path; y si algún día
 * alguien sube con el service role, la policy del bucket deja de correr sin un
 * solo error visible.
 *
 * El almacén es falso a propósito: lo que se mide es QUÉ PATH RECIBE, no que
 * Supabase sepa guardar un archivo. Y la prueba está en que ni el nombre del
 * archivo ni ningún argumento pueden cambiarlo — no hay parámetro de tenant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses } from '@/lib/db/schema/expenses';
import { attachments } from '@/lib/db/schema/attachments';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { registerExpense } from '@/lib/services/expenses/expense.service';
import {
  adjuntarComprobante,
  listarAdjuntosDeGasto,
  quitarComprobante,
  urlParaDescargar,
  AttachmentError,
} from '@/lib/services/expenses/attachment.service';
import type { AlmacenDeComprobantes } from '@/lib/services/expenses/attachment.storage';

interface OpcionesDelFalso {
  errorAlSubir?: string;
  /** Corre DESPUÉS de registrar la subida — sirve para romper el INSERT. */
  alSubir?: () => Promise<void>;
  existe?: boolean | null;
  firma?: string | null;
}

function almacenFalso(op: OpcionesDelFalso = {}) {
  const subidas: { path: string; contentType: string; bytes: number }[] = [];
  const borrados: string[] = [];
  const firmados: { path: string; segundos: number }[] = [];

  const almacen: AlmacenDeComprobantes = {
    async subir(path, bytes, contentType) {
      subidas.push({ path, contentType, bytes: bytes.byteLength });
      if (op.alSubir) await op.alSubir();
      return { error: op.errorAlSubir ?? null };
    },
    async borrar(path) {
      borrados.push(path);
      return { error: null };
    },
    async existe() {
      return op.existe === undefined ? true : op.existe;
    },
    async firmar(path, segundos) {
      firmados.push({ path, segundos });
      return op.firma === undefined ? `https://firmado.test/${path}` : op.firma;
    },
  };

  return { almacen, subidas, borrados, firmados };
}

const pdf = (nombre = 'factura-luz.pdf') => ({
  nombre,
  contentType: 'application/pdf',
  bytes: new TextEncoder().encode('%PDF-1.4 esto es un comprobante'),
});

describe('T-ADJ-02 — el comprobante sube, baja y no se va de comercio', () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const user = crypto.randomUUID();
  let gastoA: string;
  let gastoB: string;

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

  // Un número distinto por carga: cargar dos veces el MISMO comprobante es lo
  // que ahora se rechaza (T-GASTO-DUP-01), y acá no es lo que se prueba.
  let nroComprobante = 0;
  const otroNumero = () => `0001-${String(99000 + ++nroComprobante).padStart(8, '0')}`;

  const gastoDeServicios = (tenantId: string) =>
    en(tenantId, () =>
      registerExpense({
        fecha: '2026-03-10',
        categoria: 'servicios',
        neto: '10000',
        iva: '2100',
        total: '12100',
        payee_name: 'Edenor',
        comprobante_tipo: 'B',
        comprobante_numero: otroNumero(),
        en_iva_compras: true,
        medio_pago: 'transferencia',
      })
    );

  beforeAll(async () => {
    await crearEmpresa(tenantA, 'T-ADJ-02 Comercio A');
    await crearEmpresa(tenantB, 'T-ADJ-02 Comercio B');
    await db.insert(users).values({
      id: user,
      email: `t-adj-02-${tenantA.slice(0, 8)}@test.local`,
      full_name: 'Dueña',
      is_support: false,
    });
    await db.insert(company_users).values([
      { id: crypto.randomUUID(), company_id: tenantA, user_id: user, role: 'owner' },
      { id: crypto.randomUUID(), company_id: tenantB, user_id: user, role: 'owner' },
    ]);

    gastoA = (await gastoDeServicios(tenantA)).id;
    gastoB = (await gastoDeServicios(tenantB)).id;
  });

  afterAll(async () => {
    const tenants = [tenantA, tenantB];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(attachments).where(inArray(attachments.tenant_id, tenants));
      await tx.execute(
        sql`DELETE FROM expense_items WHERE tenant_id IN (${tenantA}, ${tenantB})`
      );
      await tx.delete(expenses).where(inArray(expenses.tenant_id, tenants));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, tenants));
      await tx.delete(company_users).where(inArray(company_users.company_id, tenants));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(inArray(companies.id, tenants));
    });
  });

  // ── El path ───────────────────────────────────────────────────────────────

  it('🔴 el path lo arma el CONTEXT: el mismo llamado en dos comercios guarda en dos carpetas', async () => {
    const fa = almacenFalso();
    const fb = almacenFalso();

    // Input idéntico salvo el gasto. NO hay parámetro de tenant que tocar:
    // si lo hubiera, esta prueba no diría nada.
    const a = await en(tenantA, () =>
      adjuntarComprobante({ expense_id: gastoA, archivo: pdf() }, fa.almacen)
    );
    const b = await en(tenantB, () =>
      adjuntarComprobante({ expense_id: gastoB, archivo: pdf() }, fb.almacen)
    );

    expect(fa.subidas[0]!.path.startsWith(`${tenantA}/`)).toBe(true);
    expect(fb.subidas[0]!.path.startsWith(`${tenantB}/`)).toBe(true);

    // Y lo que quedó guardado es EXACTAMENTE lo que recibió el almacén: si la
    // fila dijera otra cosa, la descarga buscaría donde no está.
    expect(a.storage_path).toBe(fa.subidas[0]!.path);
    expect(b.storage_path).toBe(fb.subidas[0]!.path);

    const [fila] = await db.select().from(attachments).where(eq(attachments.id, a.id));
    expect(fila!.storage_path).toBe(`${tenantA}/${a.id}`);
    expect(fila!.tenant_id).toBe(tenantA);
  });

  it('🔴 el nombre del archivo NO entra al path', async () => {
    const f = almacenFalso();
    const malicioso = '../../../' + tenantB + '/robado.pdf';

    const { id } = await en(tenantA, () =>
      adjuntarComprobante(
        { expense_id: gastoA, archivo: { ...pdf(), nombre: malicioso } },
        f.almacen
      )
    );

    // El path es tenant + uuid y nada más. El nombre del usuario se guarda
    // aparte, para mostrarlo.
    expect(f.subidas[0]!.path).toBe(`${tenantA}/${id}`);
    expect(f.subidas[0]!.path).not.toContain('..');

    const [fila] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(fila!.nombre_original).toBe(malicioso);
  });

  it('🔴 no se puede adjuntar al gasto de otro comercio, y no queda nada subido', async () => {
    const f = almacenFalso();

    await expect(
      en(tenantA, () =>
        adjuntarComprobante({ expense_id: gastoB, archivo: pdf() }, f.almacen)
      )
    ).rejects.toThrow(AttachmentError);

    // Lo que importa tanto como el rechazo: NO se subieron los bytes. Si el
    // chequeo fuera sólo al insertar, el archivo quedaría huérfano arriba.
    expect(f.subidas).toHaveLength(0);
  });

  // ── Validación ────────────────────────────────────────────────────────────

  it('🔴 un archivo vacío, uno enorme y un tipo no permitido se rechazan SIN subir', async () => {
    const casos = [
      { ...pdf(), bytes: new Uint8Array(0) },
      { ...pdf(), bytes: new Uint8Array(15 * 1024 * 1024 + 1) },
      { ...pdf('virus.exe'), contentType: 'application/x-msdownload' },
    ];

    for (const archivo of casos) {
      const f = almacenFalso();
      await expect(
        en(tenantA, () => adjuntarComprobante({ expense_id: gastoA, archivo }, f.almacen))
      ).rejects.toThrow(AttachmentError);
      expect(f.subidas).toHaveLength(0);
    }
  });

  // ── Compensación ──────────────────────────────────────────────────────────

  it('🔴 si el INSERT falla después de subir, el objeto se borra (no queda huérfano)', async () => {
    // Se rompe el gasto JUSTO entre la subida y el insert. Es la carrera real:
    // alguien anula el gasto en otra pestaña mientras esto sube.
    const gastoEfimero = (await gastoDeServicios(tenantA)).id;

    const f = almacenFalso({
      alSubir: async () => {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
          await tx.delete(expenses).where(eq(expenses.id, gastoEfimero));
        });
      },
    });

    await expect(
      en(tenantA, () =>
        adjuntarComprobante({ expense_id: gastoEfimero, archivo: pdf() }, f.almacen)
      )
    ).rejects.toThrow();

    expect(f.subidas).toHaveLength(1);
    expect(f.borrados).toEqual([f.subidas[0]!.path]);

    // Y no quedó fila prometiendo un comprobante.
    const filas = await db
      .select()
      .from(attachments)
      .where(eq(attachments.expense_id, gastoEfimero));
    expect(filas).toHaveLength(0);
  });

  // ── "El archivo no está" ──────────────────────────────────────────────────

  it('🔴 si el objeto no está en el bucket, la lista lo DICE en vez de mostrarlo entero', async () => {
    const { id } = await en(tenantA, () =>
      adjuntarComprobante({ expense_id: gastoA, archivo: pdf('poliza.pdf') }, almacenFalso().almacen)
    );

    const presentes = await en(tenantA, () =>
      listarAdjuntosDeGasto(gastoA, almacenFalso({ existe: true }).almacen)
    );
    expect(presentes.find((a) => a.id === id)!.archivo_presente).toBe(true);

    const faltantes = await en(tenantA, () =>
      listarAdjuntosDeGasto(gastoA, almacenFalso({ existe: false }).almacen)
    );
    expect(faltantes.find((a) => a.id === id)!.archivo_presente).toBe(false);

    // Y si NO se puede preguntar, tampoco se afirma que está: decir "está" sin
    // saberlo devuelve el 404 que esto viene a evitar.
    const enDuda = await en(tenantA, () =>
      listarAdjuntosDeGasto(gastoA, almacenFalso({ existe: null }).almacen)
    );
    expect(enDuda.find((a) => a.id === id)!.archivo_presente).toBe(false);
  });

  it('🔴 si no se puede firmar, se devuelve un estado y no un link roto', async () => {
    const { id } = await en(tenantA, () =>
      adjuntarComprobante({ expense_id: gastoA, archivo: pdf() }, almacenFalso().almacen)
    );

    const sinArchivo = await en(tenantA, () =>
      urlParaDescargar(id, almacenFalso({ firma: null }).almacen)
    );
    expect(sinArchivo).toEqual({ falta: true });

    const f = almacenFalso();
    const ok = await en(tenantA, () => urlParaDescargar(id, f.almacen));
    expect(ok).toHaveProperty('url');
    // El link es un bearer token: tiene que vencer, y pronto.
    expect(f.firmados[0]!.segundos).toBeLessThanOrEqual(300);
  });

  // ── Bajar lo ajeno ────────────────────────────────────────────────────────

  it('🔴 el vecino no puede pedir el link de un comprobante que no es suyo', async () => {
    const { id } = await en(tenantA, () =>
      adjuntarComprobante({ expense_id: gastoA, archivo: pdf() }, almacenFalso().almacen)
    );

    const f = almacenFalso();
    await expect(en(tenantB, () => urlParaDescargar(id, f.almacen))).rejects.toThrow(
      AttachmentError
    );
    // No se firmó nada: el chequeo va ANTES de firmar, porque una URL firmada
    // ya no pregunta de quién es.
    expect(f.firmados).toHaveLength(0);
  });

  // ── Quitar ────────────────────────────────────────────────────────────────

  it('🔴 quitar es LÓGICO: sale de la lista, el archivo no se borra y queda auditado', async () => {
    const f = almacenFalso();
    const { id } = await en(tenantA, () =>
      adjuntarComprobante({ expense_id: gastoA, archivo: pdf('tasa.pdf') }, f.almacen)
    );

    await en(tenantA, () => quitarComprobante({ attachment_id: id, motivo: 'subí el que no era' }));

    const quedan = await en(tenantA, () => listarAdjuntosDeGasto(gastoA, f.almacen));
    expect(quedan.map((a) => a.id)).not.toContain(id);

    // El archivo NO se toca: mientras A-31 no se responda, la copia digital se
    // trata como el respaldo del gasto.
    expect(f.borrados).toHaveLength(0);

    const [fila] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(fila!.removed_at).not.toBeNull();
    expect(fila!.removed_by).toBe(user);
    expect(fila!.removed_reason).toBe('subí el que no era');

    // Quitarlo de nuevo no pisa la fecha ni el autor de la primera baja.
    await expect(
      en(tenantA, () => quitarComprobante({ attachment_id: id, motivo: 'otra vez' }))
    ).rejects.toThrow(AttachmentError);
    const [otraVez] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(otraVez!.removed_reason).toBe('subí el que no era');
  });

  it('🔴 los dos eventos del catálogo quedan en audit_log', async () => {
    const f = almacenFalso();
    const { id } = await en(tenantA, () =>
      adjuntarComprobante({ expense_id: gastoA, archivo: pdf('honorarios.pdf') }, f.almacen)
    );
    await en(tenantA, () => quitarComprobante({ attachment_id: id, motivo: 'duplicado' }));

    const eventos = await db
      .select()
      .from(audit_log)
      .where(sql`${audit_log.payload}->>'attachment_id' = ${id}`);

    const nombres = eventos.map((e) => e.event_name).sort();
    expect(nombres).toEqual(['expense.attachment_added', 'expense.attachment_removed']);

    const alta = eventos.find((e) => e.event_name === 'expense.attachment_added')!;
    // El hash identifica el contenido sin guardar el archivo en el log.
    expect(alta.payload).toMatchObject({ expense_id: gastoA, nombre_original: 'honorarios.pdf' });
    expect(String((alta.payload as Record<string, unknown>).sha256)).toHaveLength(64);
    expect(alta.pii_level).toBe('pii_high');
  });
});
