/**
 * T-CUST-01 — registro de clientes.
 *
 * Cubre las tres cosas que pueden salir mal en una tabla nueva:
 *   1. Que un campo pase el Zod y NO se guarde (el `.values()` enumera campos;
 *      le pasó a `products.category` — ver T-INV-09).
 *   2. Que la RLS no esté (la migración 0020 tuvo que cerrar 8 tablas que
 *      habían nacido sin ella, y era una fuga ACTIVA).
 *   3. Que las dos clasificaciones se mezclen: `tax_condition` es FISCAL y va
 *      una sola; `tags` es COMERCIAL y van varias. Un Mayorista puede ser
 *      Responsable Inscripto o Monotributo — no son el mismo eje.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { customers } from '@/lib/db/schema/customers';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  createCustomer,
  updateCustomer,
  getCustomerById,
  listCustomers,
  listCustomerTags,
  deactivateCustomer,
  CustomerValidationError,
} from '@/lib/services/customers/customer.service';

describe('T-CUST-01 — registro de clientes', () => {
  let tenantId: string;
  let userId: string;

  const ctxDe = <T,>(tid: string, uid: string, fn: () => Promise<T>): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tid,
          actor_user_id: uid,
          actor_type: 'user',
        },
        fn
      )
    );
  const withCtx = <T,>(fn: () => Promise<T>): Promise<T> =>
    ctxDe(tenantId, userId, fn);

  const seed = async (tid: string, uid: string) => {
    await db.insert(companies).values({
      id: tid,
      name: 'T-CUST-01 Co',
      legal_name: 'T-CUST-01 Co SRL',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: uid,
      email: `t-cust-${uid.slice(0, 8)}@test.local`,
      full_name: 'Owner T-CUST-01',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tid,
      user_id: uid,
      role: 'owner',
    });
  };

  const limpiar = async (tid: string, uid: string) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tid));
      await tx.delete(customers).where(eq(customers.tenant_id, tid));
      await tx.delete(company_users).where(eq(company_users.company_id, tid));
      await tx.delete(users).where(eq(users.id, uid));
      await tx.delete(companies).where(eq(companies.id, tid));
    });
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    await seed(tenantId, userId);
  });

  afterEach(async () => {
    await limpiar(tenantId, userId);
  });

  it('guarda TODOS los campos, no sólo el nombre', async () => {
    // La trampa: el .values() del insert enumera campos. Si uno falta, el Zod
    // lo acepta, el insert anda, y el dato se pierde en silencio.
    const creado = await withCtx(() =>
      createCustomer({
        name: 'Rosa Giménez',
        doc_type: 'DNI',
        doc_number: '27345678',
        tax_condition: 'consumidor_final',
        email: 'rosa@test.local',
        phone: '2964-556677',
        address: 'San Martín 123',
        notes: 'Compra los jueves',
        tags: ['Jubilados', 'Vecinos'],
      })
    );

    // Lo que quedó EN LA BASE, no lo que devolvió el service.
    const [enBase] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, creado.id));

    expect(enBase?.name).toBe('Rosa Giménez');
    expect(enBase?.doc_type).toBe('DNI');
    expect(enBase?.doc_number).toBe('27345678');
    expect(enBase?.tax_condition).toBe('consumidor_final');
    expect(enBase?.email).toBe('rosa@test.local');
    expect(enBase?.phone).toBe('2964-556677');
    expect(enBase?.address).toBe('San Martín 123');
    expect(enBase?.notes).toBe('Compra los jueves');
    expect(enBase?.tags).toEqual(['Jubilados', 'Vecinos']);
  });

  it('las dos clasificaciones son independientes', async () => {
    // Un Mayorista puede ser Responsable Inscripto...
    const a = await withCtx(() =>
      createCustomer({
        name: 'Distribuidora Austral',
        doc_type: 'CUIT',
        doc_number: '30712345678',
        tax_condition: 'responsable_inscripto',
        tags: ['Mayoristas'],
      })
    );
    // ...y otro Mayorista puede ser Monotributo. El segmento comercial NO
    // determina la condición fiscal.
    const b = await withCtx(() =>
      createCustomer({
        name: 'Kiosco El Faro',
        doc_type: 'CUIT',
        doc_number: '20987654321',
        tax_condition: 'monotributo',
        tags: ['Mayoristas', 'Vecinos'],
      })
    );

    expect(a.tags).toEqual(['Mayoristas']);
    expect(b.tags).toEqual(['Mayoristas', 'Vecinos']);
    expect(a.tax_condition).not.toBe(b.tax_condition);
  });

  it('un cliente sin documento es válido (consumidor final anónimo)', async () => {
    const creado = await withCtx(() => createCustomer({ name: 'Cliente mostrador' }));
    expect(creado.doc_type).toBe('none');
    expect(creado.doc_number).toBeNull();
  });

  it('RECHAZA un documento a medias', async () => {
    // Un doc_number sin tipo (o al revés) rompe la factura después.
    await expect(
      withCtx(() => createCustomer({ name: 'X', doc_type: 'DNI' }))
    ).rejects.toBeInstanceOf(CustomerValidationError);

    await expect(
      withCtx(() => createCustomer({ name: 'X', doc_number: '12345678' }))
    ).rejects.toBeInstanceOf(CustomerValidationError);
  });

  it('el vocabulario de segmentos se deriva de los clientes', async () => {
    await withCtx(() => createCustomer({ name: 'A', tags: ['Vecinos'] }));
    await withCtx(() => createCustomer({ name: 'B', tags: ['Jubilados', 'Vecinos'] }));

    const tags = await withCtx(() => listCustomerTags());

    // Sin duplicados y ordenado. No hay tabla de catálogo: el comerciante
    // escribe "Vecinos" y el segmento existe.
    expect(tags).toEqual(['Jubilados', 'Vecinos']);
  });

  it('los tags se limpian: sin vacíos ni repetidos', async () => {
    const c = await withCtx(() =>
      createCustomer({ name: 'C', tags: ['VIP', '', 'VIP', '  '] })
    );
    expect(c.tags).toEqual(['VIP']);
  });

  it('actualizar cambia sólo lo que se manda', async () => {
    const c = await withCtx(() =>
      createCustomer({ name: 'Original', phone: '111', tags: ['Vecinos'] })
    );

    await withCtx(() => updateCustomer(c.id, { name: 'Cambiado' }));

    const releido = await withCtx(() => getCustomerById(c.id));
    expect(releido.name).toBe('Cambiado');
    expect(releido.phone).toBe('111'); // no se pisó
    expect(releido.tags).toEqual(['Vecinos']);
  });

  it('la baja es lógica: el cliente NO se borra', async () => {
    const c = await withCtx(() => createCustomer({ name: 'A dar de baja' }));
    await withCtx(() => deactivateCustomer(c.id));

    // Sale de la lista...
    const lista = await withCtx(() => listCustomers());
    expect(lista.find((x) => x.id === c.id)).toBeUndefined();

    // ...pero la fila sigue existiendo: puede estar en ventas viejas.
    const [enBase] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(enBase).toBeDefined();
    expect(enBase?.is_active).toBe(false);
  });

  it('CROSS-TENANT: no se ve ni se edita el cliente de otro comercio', async () => {
    const otroTenant = crypto.randomUUID();
    const otroUser = crypto.randomUUID();
    await seed(otroTenant, otroUser);
    try {
      const ajeno = await ctxDe(otroTenant, otroUser, () =>
        createCustomer({ name: 'Cliente del vecino' })
      );

      // No aparece en la lista del tenant A.
      const lista = await withCtx(() => listCustomers());
      expect(lista.find((c) => c.id === ajeno.id)).toBeUndefined();

      // Leerlo por id falla.
      await expect(withCtx(() => getCustomerById(ajeno.id))).rejects.toThrow();

      // Editarlo también: el UPDATE filtra por tenant, así que no toca nada.
      await expect(
        withCtx(() => updateCustomer(ajeno.id, { name: 'Hackeado' }))
      ).rejects.toThrow();

      // Y sigue intacto.
      const [sigue] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, ajeno.id));
      expect(sigue?.name).toBe('Cliente del vecino');
    } finally {
      await limpiar(otroTenant, otroUser);
    }
  });

  it('crear un cliente deja huella en audit_log', async () => {
    const c = await withCtx(() => createCustomer({ name: 'Auditado' }));

    const filas = await db.execute<{ event_name: string; pii_level: string }>(
      sql`SELECT event_name, pii_level FROM audit_log
          WHERE tenant_id = ${tenantId} AND event_name = 'customer.created'`
    );

    expect(filas.length).toBe(1);
    // Nombre + documento de una persona: es PII alta, no 'internal'.
    expect(filas[0]?.pii_level).toBe('pii_high');
    expect(c.id).toBeTruthy();
  });
});
