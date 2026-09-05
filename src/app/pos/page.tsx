/**
 * POS funcional (Slice 5) — Server Component.
 *
 * Carga la sesión (ruta protegida por el proxy) + el catálogo real del tenant
 * (dentro del tracing context vía el bridge, para que listProductsPaginated
 * tenga el tenant_id) y delega la interacción en <POSClient>.
 *
 * NO tiene lógica de negocio: el POSClient llama las Server Actions (actions.ts)
 * que orquestan el service de ventas. Dawn Industrial Editorial.
 */
import { eq } from 'drizzle-orm';
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { listProductsPaginated } from '@/lib/inventory/queries';
import { listCustomers } from '@/lib/services/customers/customer.service';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { POSClient, type PosProductDTO } from './POSClient';

export default async function POSPage() {
  const session = await requireSessionWithCompany();

  // El catálogo se lee dentro del tracing context (tenant_id) que monta el
  // bridge — listProductsPaginated usa requireTenantId().
  const products = await withServerActionTracing(
    () => listProductsPaginated({ limit: 200 }),
    { requireAuth: true }
  );

  // Padron para el selector de cliente del carrito. Mismo tracing context.
  const clientes = await withServerActionTracing(() => listCustomers({ limit: 200 }), {
    requireAuth: true,
  });

  // Nombre del comercio para el pill de la topbar (la maqueta muestra el
  // comercio, no la caja). Se lee por id de la sesión, así que no hace falta
  // el tracing context.
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, session.active_company_id))
    .limit(1);

  const productDtos: PosProductDTO[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    tax_rate: p.tax_rate,
    tdf_exempt: p.tdf_exempt,
    stock_current: p.stock_current,
    // Necesario para el badge "STOCK BAJO" de la maqueta: el umbral es por
    // producto (no un número fijo), así que tiene que viajar al cliente.
    stock_minimum: p.stock_minimum,
  }));

  return (
    <POSClient
      products={productDtos}
      customers={clientes.map((c) => ({
        id: c.id,
        name: c.name,
        doc_type: c.doc_type,
        doc_number: c.doc_number,
        tax_condition: c.tax_condition,
        tags: c.tags,
      }))}
      // Sólo la parte antes del @: el chip de la topbar muestra un NOMBRE,
      // como en la maqueta. Mandar el email entero lo desbalanceaba (Caja ya
      // lo recortaba y el POS no).
      cashierName={session.email.replace(/@.*/, '')}
      // La maqueta muestra el NOMBRE DEL COMERCIO en la topbar ("Tienda
      // Ushuaia"), no la caja. La caja ya se ve en la barra de sesión de /caja.
      salePointLabel={company?.name ?? 'Mi comercio'}
      serverTimeIso={new Date().toISOString()}
    />
  );
}
