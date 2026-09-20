/**
 * T-ADJ-04 — el contrato cuelga del proveedor, y el vencido sigue contando.
 *
 * El ítem 12 dice "alquileres (CON CONTRATO)". Un contrato NO es un
 * comprobante de pago: es uno solo que respalda doce. Colgado del gasto queda
 * grapado a un mes arbitrario —la contadora lo busca en enero y está en
 * marzo— o subido doce veces.
 *
 * Lo que más se puede equivocar acá no es guardar el archivo sino la VIGENCIA:
 * es tentador esconder los vencidos, y sería la misma confusión que "lo
 * pagado" contra "lo gastado" — *cuándo rige* no es *si vale*. Un contrato que
 * terminó en junio respaldó los seis pagos que cubrió, y el estudio los pide.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { terceros } from '@/lib/db/schema/terceros';
import { attachments } from '@/lib/db/schema/attachments';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  adjuntarContrato,
  contarContratosPorTercero,
  listarContratosDeTercero,
  quitarComprobante,
  AttachmentError,
} from '@/lib/services/expenses/attachment.service';
import type { AlmacenDeComprobantes } from '@/lib/services/expenses/attachment.storage';

function almacenFalso(existe: boolean | null = true) {
  const subidas: string[] = [];
  const borrados: string[] = [];
  const almacen: AlmacenDeComprobantes = {
    async subir(path) {
      subidas.push(path);
      return { error: null };
    },
    async borrar(path) {
      borrados.push(path);
      return { error: null };
    },
    async existe() {
      return existe;
    },
    async firmar(path) {
      return `https://firmado.test/${path}`;
    },
  };
  return { almacen, subidas, borrados };
}

const pdf = (nombre = 'contrato-locacion.pdf') => ({
  nombre,
  contentType: 'application/pdf',
  bytes: new TextEncoder().encode('%PDF-1.4 contrato de locacion'),
});

const HOY = '2026-09-20';

describe('T-ADJ-04 — el contrato del proveedor', () => {
  const tenant = crypto.randomUUID();
  const ajeno = crypto.randomUUID();
  const user = crypto.randomUUID();
  let locador: string;
  let locadorAjeno: string;

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

  beforeAll(async () => {
    await crearEmpresa(tenant, 'T-ADJ-04 Comercio');
    await crearEmpresa(ajeno, 'T-ADJ-04 Vecino');
    await db.insert(users).values({
      id: user,
      email: `t-adj-04-${tenant.slice(0, 8)}@test.local`,
      full_name: 'Dueña',
      is_support: false,
    });
    await db.insert(company_users).values([
      { id: crypto.randomUUID(), company_id: tenant, user_id: user, role: 'owner' },
      { id: crypto.randomUUID(), company_id: ajeno, user_id: user, role: 'owner' },
    ]);

    const [a] = await db
      .insert(terceros)
      .values({ tenant_id: tenant, type: 'proveedor', name: 'Inmobiliaria Del Sur', sort_order: 1 })
      .returning();
    const [b] = await db
      .insert(terceros)
      .values({ tenant_id: ajeno, type: 'proveedor', name: 'Locador del vecino', sort_order: 1 })
      .returning();
    locador = a!.id;
    locadorAjeno = b!.id;
  });

  afterAll(async () => {
    const tenants = [tenant, ajeno];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(attachments).where(inArray(attachments.tenant_id, tenants));
      await tx.delete(terceros).where(inArray(terceros.tenant_id, tenants));
      await tx.delete(audit_log).where(inArray(audit_log.tenant_id, tenants));
      await tx.delete(company_users).where(inArray(company_users.company_id, tenants));
      await tx.delete(users).where(eq(users.id, user));
      await tx.delete(companies).where(inArray(companies.id, tenants));
    });
  });

  it('🔴 el contrato queda colgado del proveedor, con su vigencia', async () => {
    const f = almacenFalso();
    const { id } = await en(tenant, () =>
      adjuntarContrato(
        {
          tercero_id: locador,
          archivo: pdf(),
          vigencia_desde: '2026-01-01',
          vigencia_hasta: '2026-12-31',
        },
        f.almacen
      )
    );

    const [fila] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(fila!.tipo).toBe('contrato');
    expect(fila!.tercero_id).toBe(locador);
    // El CHECK de la 0040 lo garantiza, pero se afirma acá igual: un contrato
    // colgando ADEMÁS de un gasto sería un contrato grapado a un mes.
    expect(fila!.expense_id).toBeNull();
    expect(fila!.vigencia_desde).toBe('2026-01-01');
    expect(fila!.storage_path.startsWith(`${tenant}/`)).toBe(true);
  });

  it('🔴 el contrato VENCIDO se sigue listando, marcado — no se esconde', async () => {
    const f = almacenFalso();
    const { id } = await en(tenant, () =>
      adjuntarContrato(
        {
          tercero_id: locador,
          archivo: pdf('contrato-2025.pdf'),
          vigencia_desde: '2025-01-01',
          vigencia_hasta: '2025-12-31',
        },
        f.almacen
      )
    );

    const lista = await en(tenant, () => listarContratosDeTercero(locador, HOY, f.almacen));
    const viejo = lista.find((c) => c.id === id);

    // Que esté es lo que importa: respaldó los doce pagos de 2025 y el estudio
    // los pide. Esconderlo sería confundir "cuándo rige" con "si vale".
    expect(viejo).toBeDefined();
    expect(viejo!.vencido).toBe(true);
    expect(lista.find((c) => c.vencido === false)).toBeDefined();
  });

  it('🔴 una vigencia que termina antes de empezar se rechaza sin subir nada', async () => {
    const f = almacenFalso();
    await expect(
      en(tenant, () =>
        adjuntarContrato(
          {
            tercero_id: locador,
            archivo: pdf(),
            vigencia_desde: '2026-12-31',
            vigencia_hasta: '2026-01-01',
          },
          f.almacen
        )
      )
    ).rejects.toThrow(AttachmentError);
    expect(f.subidas).toHaveLength(0);
  });

  it('🔴 no se puede colgar un contrato del proveedor de otro comercio', async () => {
    const f = almacenFalso();
    await expect(
      en(tenant, () =>
        adjuntarContrato(
          {
            tercero_id: locadorAjeno,
            archivo: pdf(),
            vigencia_desde: '2026-01-01',
            vigencia_hasta: '2026-12-31',
          },
          f.almacen
        )
      )
    ).rejects.toThrow(AttachmentError);
    // Y no quedaron bytes arriba: el chequeo va ANTES de subir.
    expect(f.subidas).toHaveLength(0);
  });

  it('🔴 "el archivo no está" vale igual para el contrato', async () => {
    const lista = await en(tenant, () =>
      listarContratosDeTercero(locador, HOY, almacenFalso(false).almacen)
    );
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((c) => c.archivo_presente === false)).toBe(true);
  });

  it('🔴 el contador por proveedor cuenta los contratos cargados', async () => {
    const cuenta = await en(tenant, () => contarContratosPorTercero([locador, locadorAjeno]));
    expect(cuenta[locador]).toBe(2);
    // El del vecino no se cuenta ni con el id en la mano.
    expect(cuenta[locadorAjeno]).toBeUndefined();
  });

  it('🔴 la baja del contrato deja auditado DE QUÉ colgaba', async () => {
    const f = almacenFalso();
    const { id } = await en(tenant, () =>
      adjuntarContrato(
        {
          tercero_id: locador,
          archivo: pdf('contrato-a-sacar.pdf'),
          vigencia_desde: '2026-02-01',
          vigencia_hasta: '2026-02-28',
        },
        f.almacen
      )
    );

    await en(tenant, () => quitarComprobante({ attachment_id: id, motivo: 'subí el borrador' }));

    const [evento] = await db
      .select()
      .from(audit_log)
      .where(sql`${audit_log.payload}->>'attachment_id' = ${id}
                 AND ${audit_log.event_name} = 'expense.attachment_removed'`);

    // Sin `tercero_id` en el payload, la baja de un contrato quedaba con
    // `expense_id: null` y nada más: el evento no decía de qué colgaba.
    expect(evento!.payload).toMatchObject({ tipo: 'contrato', tercero_id: locador });
    expect(f.borrados).toHaveLength(0);
  });
});
