/**
 * Clientes — Server Component.
 *
 * Carga el padrón + un agregado de compras por cliente. Las compras se
 * cuentan de `sales` vía `sales.customer_id`, que es columna NUEVA (migration
 * 0023): las ventas anteriores no la tienen, así que van a dar 0 hasta que se
 * empiece a asociar el cliente al cobrar. Es un cero REAL, no un placeholder.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { sales } from '@/lib/db/schema/sales';
import { listCustomers } from '@/lib/services/customers/customer.service';
import { ClientesClient, type ClienteDTO } from './ClientesClient';

export default async function ClientesPage() {
  const session = await requireSessionWithCompany();
  const tenantId = session.active_company_id;

  const clientes = await withServerActionTracing(() => listCustomers({ limit: 200 }), {
    requireAuth: true,
  });

  // Un solo agregado para todos, en vez de una consulta por cliente (N+1).
  const compras = await db
    .select({
      customer_id: sales.customer_id,
      cantidad: sql<number>`count(*)::int`,
      ultima: sql<string | null>`max(${sales.created_at})::text`,
    })
    .from(sales)
    .where(and(eq(sales.tenant_id, tenantId), isNotNull(sales.customer_id)))
    .groupBy(sales.customer_id);

  const porCliente = new Map(
    compras.map((c) => [c.customer_id, { cantidad: c.cantidad, ultima: c.ultima }])
  );

  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, tenantId))
    .limit(1);

  const dtos: ClienteDTO[] = clientes.map((c) => {
    const agg = porCliente.get(c.id);
    return {
      id: c.id,
      name: c.name,
      doc_type: c.doc_type,
      doc_number: c.doc_number,
      tax_condition: c.tax_condition,
      email: c.email,
      phone: c.phone,
      address: c.address,
      notes: c.notes,
      tags: c.tags,
      created_at: c.created_at.toISOString(),
      compras: agg?.cantidad ?? 0,
      ultima_compra: agg?.ultima ?? null,
    };
  });

  return (
    <ClientesClient
      clientes={dtos}
      cashierName={session.email.replace(/@.*/, '')}
      salePointLabel={company?.name ?? 'Mi comercio'}
    />
  );
}
