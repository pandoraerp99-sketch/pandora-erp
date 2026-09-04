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
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { listProductsPaginated } from '@/lib/inventory/queries';
import { POSClient, type PosProductDTO } from './POSClient';

export default async function POSPage() {
  const session = await requireSessionWithCompany();

  // El catálogo se lee dentro del tracing context (tenant_id) que monta el
  // bridge — listProductsPaginated usa requireTenantId().
  const products = await withServerActionTracing(
    () => listProductsPaginated({ limit: 200 }),
    { requireAuth: true }
  );

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
      cashierName={session.email}
      salePointLabel="Punto de venta · Caja 1"
      serverTimeIso={new Date().toISOString()}
    />
  );
}
