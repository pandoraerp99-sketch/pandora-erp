/**
 * Productos — Server Component.
 *
 * Carga el catálogo del tenant dentro del tracing context (que es lo que le da
 * el `tenant_id` a `listProductsPaginated`) y delega la interacción en
 * <ProductosClient>. Sin lógica de negocio: eso vive en `product.service.ts`.
 *
 * Visual: maqueta `pos-preview/productos-v3.html` — lista maestra a la
 * izquierda, detalle a la derecha, chips de rubro arriba.
 */
import { eq } from 'drizzle-orm';
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { listProductsPaginated } from '@/lib/inventory/queries';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { ProductosClient, type ProductoDTO } from './ProductosClient';

export default async function ProductosPage() {
  const session = await requireSessionWithCompany();

  // 200 es el TOPE de listProductsPaginated, no un número elegido: pedir más
  // tira QueryValidationError (el cap existe a propósito — una query sin
  // límite es anti-patrón). Un catálogo más grande necesita paginado de
  // verdad, con scroll infinito o páginas; eso es otra tarea, no subir el cap.
  const productos = await withServerActionTracing(
    () => listProductsPaginated({ limit: 200 }),
    { requireAuth: true }
  );

  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, session.active_company_id))
    .limit(1);

  const dtos: ProductoDTO[] = productos.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    category: p.category,
    price: p.price,
    cost: p.cost,
    stock_current: p.stock_current,
    stock_minimum: p.stock_minimum,
    tdf_exempt: p.tdf_exempt,
    stock_tracking_enabled: p.stock_tracking_enabled,
    unit_type: p.unit_type,
  }));

  return (
    <ProductosClient
      productos={dtos}
      cashierName={session.email.replace(/@.*/, '')}
      salePointLabel={company?.name ?? 'Mi comercio'}
    />
  );
}
