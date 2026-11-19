/**
 * /pedidos — libro de encargos (pos-preview/pedidos.html), ADR-0029.
 *
 * Server Component: lee dentro del tracing context (tenant_id) el libro de
 * pedidos, si hay una caja abierta (sin caja no se puede cobrar una seña) y
 * los clientes y productos para el alta. Todo lo que es plata viaja como
 * string; el cliente sólo lo muestra.
 */
import { eq } from 'drizzle-orm';
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema/users';
import { leerRolEnElComercio } from '@/lib/auth/autorizacion';
import { getActiveCashSession } from '@/lib/cash/sessions';
import { listCustomers } from '@/lib/services/customers/customer.service';
import { listProductsPaginated } from '@/lib/inventory/queries';
import { listOrders, SALE_POINT_PEDIDOS } from '@/lib/services/orders/order.service';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import { PedidosClient, type PedidoFilaDTO } from './PedidosClient';

const ROL_VISIBLE: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Encargado',
  cashier: 'Cajero',
  accountant: 'Contadora',
};

export default async function PedidosPage() {
  const session = await requireSessionWithCompany();

  const data = await withServerActionTracing(
    async () => {
      const [pedidos, caja, clientes, productos, rol, yo] = await Promise.all([
        listOrders(),
        getActiveCashSession(SALE_POINT_PEDIDOS),
        listCustomers({ limit: 200 }),
        listProductsPaginated({ limit: 200 }),
        leerRolEnElComercio(session.active_company_id, session.user_id),
        db
          .select({ full_name: users.full_name })
          .from(users)
          .where(eq(users.id, session.user_id))
          .limit(1),
      ]);
      return { pedidos, caja, clientes, productos, rol, yo: yo[0] ?? null };
    },
    { requireAuth: true }
  );

  const filas: PedidoFilaDTO[] = data.pedidos.map((p) => ({
    id: p.id,
    number: p.number,
    createdAtIso: p.created_at.toISOString(),
    deliveredAtIso: p.delivered_at ? p.delivered_at.toISOString() : null,
    customerName: p.customer_name,
    status: p.status,
    total: p.total,
    cobrado: p.cobrado,
    sena: p.sena,
    pickupDate: p.pickup_date,
    primerItem: p.primer_item,
    cantidadItems: p.cantidad_items,
    tomadoPor: p.tomado_por,
  }));

  return (
    <PedidosClient
      pedidos={filas}
      hoy={diaDelComercio()}
      hayCajaAbierta={data.caja !== null}
      clientes={data.clientes
        .filter((c) => c.is_active)
        .map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? null }))}
      productos={data.productos
        .filter((p) => p.is_active)
        .map((p) => ({ id: p.id, name: p.name, price: p.price }))}
      userName={data.yo?.full_name?.trim() || session.email}
      userRole={ROL_VISIBLE[data.rol ?? ''] ?? 'Sin rol'}
    />
  );
}
