/**
 * Clientes — Server Component.
 *
 * Carga el padrón + un agregado de compras por cliente. Las compras se
 * cuentan de `sales` vía `sales.customer_id`, que es columna NUEVA (migration
 * 0023): las ventas anteriores no la tienen, así que van a dar 0 hasta que se
 * empiece a asociar el cliente al cobrar. Es un cero REAL, no un placeholder.
 */
import { eq } from 'drizzle-orm';
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import {
  getMonthlyPurchasesByCustomer,
  getPurchaseStatsByCustomer,
  MESES_SERIE,
  listCustomers,
} from '@/lib/services/customers/customer.service';
import { getDebtorsWithAge } from '@/lib/services/customers/account.service';
import { ClientesClient, type ClienteDTO } from './ClientesClient';

export default async function ClientesPage() {
  const session = await requireSessionWithCompany();
  const tenantId = session.active_company_id;

  const clientes = await withServerActionTracing(() => listCustomers({ limit: 200 }), {
    requireAuth: true,
  });

  // Un solo agregado para todos, en vez de una consulta por cliente (N+1).
  // Vive en el servicio y no acá para poder testearlo: la primera versión
  // contaba carritos abandonados como compras (ver T-CUST-02).
  const porCliente = await withServerActionTracing(
    () => getPurchaseStatsByCustomer(),
    { requireAuth: true }
  );

  // Saldos de cuenta corriente + ANTIGUEDAD de la deuda (ADR-0027). El saldo
  // no esta guardado: se calcula del libro, y los dias salen de imputar los
  // pagos a los cargos mas viejos primero.
  const deudas = await withServerActionTracing(() => getDebtorsWithAge(), {
    requireAuth: true,
  });

  // Serie de 12 meses para el grafico del panel de detalle.
  const series = await withServerActionTracing(
    () => getMonthlyPurchasesByCustomer(),
    { requireAuth: true }
  );
  const SERIE_VACIA = Array.from({ length: MESES_SERIE }, () => 0);

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
      tickets: agg?.cantidad ?? 0,
      compras_monto: agg?.monto ?? '0',
      ultima_compra: agg?.ultima ?? null,
      saldo: (deudas.get(c.id)?.saldo ?? 0).toString(),
      dias_deuda: deudas.get(c.id)?.dias ?? null,
      serie: series.get(c.id) ?? SERIE_VACIA,
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
