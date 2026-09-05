/**
 * Application Service de clientes.
 *
 * Mismo patron que product.service.ts: valida con Zod, exige tenant del
 * tracing context, escribe audit_log, y NO conoce HTTP ni React.
 *
 * OJO al INSERT: enumera los campos uno por uno, igual que products. Un campo
 * nuevo que pase el Zod pero falte en ese `.values({...})` se descarta EN
 * SILENCIO (validacion OK, insert OK, dato perdido). Le paso a
 * `products.category` — ver T-INV-09.
 */
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { customers, type Customer } from '../../db/schema/customers.js';
import { CUSTOMER_DOC_TYPES } from '../../db/schema/_common.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { logger } from '../../observability/logger.js';

function requireTenantId(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'customer.service (sin tenant en el context)'
    );
  }
  return ctx.tenant_id;
}

export class CustomerValidationError extends DomainError {
  constructor(
    messageEs: string,
    public readonly fieldErrors?: Record<string, string>
  ) {
    super('CUSTOMER_VALIDATION', messageEs, 422);
  }
}

export class CustomerNotFoundError extends DomainError {
  constructor(id: string) {
    super('CUSTOMER_NOT_FOUND', `No existe el cliente ${id}`, 404);
  }
}

/** Texto opcional: '' se normaliza a undefined para no guardar vacios. */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v));

/**
 * Forma base SIN las validaciones cruzadas. Se separa porque Zod 4 no deja
 * hacer .partial() sobre un schema que ya tiene .refine(), y el update
 * necesita el parcial.
 */
const CustomerShape = z.object({
    name: z.string().trim().min(1, 'El nombre es obligatorio').max(255),
    doc_type: z.enum(CUSTOMER_DOC_TYPES).default('none'),
    doc_number: textoOpcional(32),
    tax_condition: textoOpcional(64),
    email: textoOpcional(255),
    phone: textoOpcional(64),
    address: textoOpcional(255),
    notes: textoOpcional(2000),
    /** Segmentos comerciales. Se limpian vacios y duplicados. */
    tags: z
      .array(z.string().trim().max(64))
      .optional()
      .transform((v) =>
        v === undefined ? undefined : [...new Set(v.filter((t) => t !== ''))]
      ),
    is_active: z.boolean().default(true),
});

// Un documento a medias (numero sin tipo, o al reves) rompe la factura
// despues: se rechaza en el borde. En el PATCH las mismas reglas solo aplican
// cuando el campo viene — si no se manda doc_type, no hay nada que validar.
const docCompleto = (d: { doc_type?: string; doc_number?: string }) =>
  d.doc_type === undefined || d.doc_type === 'none' || d.doc_number !== undefined;
const tipoPresente = (d: { doc_type?: string; doc_number?: string }) =>
  d.doc_number === undefined || (d.doc_type !== undefined && d.doc_type !== 'none');

export const CustomerInputSchema = CustomerShape
  .refine(docCompleto, {
    message: 'Si elegis un tipo de documento tenes que cargar el numero',
    path: ['doc_number'],
  })
  .refine(tipoPresente, {
    message: 'Elegi el tipo de documento',
    path: ['doc_type'],
  });

/** Update: todos los campos opcionales, mismas reglas cruzadas. */
export const CustomerPatchSchema = CustomerShape.partial()
  .refine(docCompleto, {
    message: 'Si elegis un tipo de documento tenes que cargar el numero',
    path: ['doc_number'],
  })
  .refine(tipoPresente, {
    message: 'Elegi el tipo de documento',
    path: ['doc_type'],
  });

export type CustomerInput = z.infer<typeof CustomerInputSchema>;

function parse(raw: unknown): CustomerInput {
  const r = CustomerInputSchema.safeParse(raw);
  if (!r.success) {
    throw new CustomerValidationError(
      'Datos de cliente invalidos',
      Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))
    );
  }
  return r.data;
}

export async function createCustomer(rawInput: unknown): Promise<Customer> {
  const tenantId = requireTenantId();
  const input = parse(rawInput);

  const creado = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(customers)
      .values({
        tenant_id: tenantId,
        name: input.name,
        doc_type: input.doc_type,
        doc_number: input.doc_number ?? null,
        tax_condition: input.tax_condition ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        tags: input.tags ?? [],
        is_active: input.is_active,
      })
      .returning();

    if (!row) throw new Error('Insert de cliente no devolvio fila');

    await writeAuditLog(
      {
        event_name: 'customer.created',
        payload: { customer_id: row.id, name: row.name },
        pii_level: 'pii_high', // nombre + documento de una persona
        severity: 'info',
      },
      tx
    );

    return row;
  });

  logger.info({ customer_id: creado.id }, 'customer.created');
  return creado;
}

export async function updateCustomer(
  id: string,
  rawInput: unknown
): Promise<Customer> {
  const tenantId = requireTenantId();
  // El patch manda solo lo que cambia, pero igual se validan las reglas
  // cruzadas: no puede entrar un doc_number sin doc_type.
  const parsed = CustomerPatchSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new CustomerValidationError(
      'Datos de cliente invalidos',
      Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.'), i.message])
      )
    );
  }
  const input = parsed.data;

  const actualizado = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(customers)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.doc_type !== undefined ? { doc_type: input.doc_type } : {}),
        ...(input.doc_number !== undefined ? { doc_number: input.doc_number } : {}),
        ...(input.tax_condition !== undefined
          ? { tax_condition: input.tax_condition }
          : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
        updated_at: new Date(),
      })
      .where(and(eq(customers.tenant_id, tenantId), eq(customers.id, id)))
      .returning();

    if (!row) throw new CustomerNotFoundError(id);

    // A Pino, NO a audit_log: el catalogo de eventos es CERRADO
    // (EVENT-TAXONOMY) y no incluye 'customer.updated'. Es el mismo criterio
    // que 'product.updated', que la taxonomia manda explicitamente a Pino por
    // ser edicion de campos triviales. Agregar un evento nuevo requiere PR +
    // actualizar la taxonomia, no decidirlo desde un service.
    logger.info(
      { customer_id: id, campos: Object.keys(input) },
      'customer.updated'
    );

    return row;
  });

  return actualizado;
}

export async function getCustomerById(id: string): Promise<Customer> {
  const tenantId = requireTenantId();
  const [row] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenant_id, tenantId), eq(customers.id, id)))
    .limit(1);
  if (!row) throw new CustomerNotFoundError(id);
  return row;
}

export interface ListCustomersOptions {
  /** Texto libre: busca por nombre o documento. */
  query?: string;
  limit?: number;
  activeOnly?: boolean;
}

export async function listCustomers(
  options: ListCustomersOptions = {}
): Promise<Customer[]> {
  const tenantId = requireTenantId();

  // Cap duro, igual que listProductsPaginated: una query sin limite es
  // anti-patron. Un padron mas grande necesita paginado de verdad.
  const limit = Math.min(options.limit ?? 200, 200);
  const q = (options.query ?? '').trim();
  const activeOnly = options.activeOnly !== false;

  const filtroTexto =
    q === ''
      ? undefined
      : or(ilike(customers.name, `%${q}%`), ilike(customers.doc_number, `%${q}%`));

  return db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.tenant_id, tenantId),
        activeOnly ? eq(customers.is_active, true) : undefined,
        filtroTexto
      )
    )
    .orderBy(asc(customers.name))
    .limit(limit);
}

/**
 * Baja logica. NO borra: un cliente puede estar referenciado por ventas
 * viejas y borrarlo rompe el historico.
 */
export async function deactivateCustomer(id: string): Promise<void> {
  const tenantId = requireTenantId();
  const [row] = await db
    .update(customers)
    .set({ is_active: false, updated_at: new Date() })
    .where(and(eq(customers.tenant_id, tenantId), eq(customers.id, id)))
    .returning({ id: customers.id });
  if (!row) throw new CustomerNotFoundError(id);

  // Tampoco esta en el catalogo. OJO: NO se reusa 'customer.deletion_requested'
  // aunque exista — ese evento es el pedido de BORRADO por derecho ARCO
  // (Ley 25.326), no un cliente que el comercio archiva. Usarlo ensuciaria un
  // evento que despues hay que poder mostrarle a la AAIP.
  logger.info({ customer_id: id }, 'customer.deactivated');
}

/**
 * Vocabulario de segmentos en uso. Se DERIVA de los clientes, no hay tabla de
 * catalogo (ver header de la migration 0023).
 */
export async function listCustomerTags(): Promise<string[]> {
  const tenantId = requireTenantId();
  const filas = await db.execute<{ tag: string }>(
    sql`SELECT DISTINCT unnest(tags) AS tag
        FROM customers
        WHERE tenant_id = ${tenantId} AND is_active = true
        ORDER BY 1`
  );
  return filas.map((f) => f.tag);
}
