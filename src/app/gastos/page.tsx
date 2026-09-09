/**
 * Gastos — Server Component.
 *
 * La pantalla donde el comercio carga lo que gasta. Nace del pedido real de la
 * contadora: hoy la persona que atiende clasifica los gastos a mano todos los
 * meses y le manda al estudio los que no entran al IVA compras. Ver
 * `EVIDENCIA-pedido-contadora-2026-09.md` y `RESEARCH-BRIEF-gastos.md`.
 *
 * El período viaja en la URL, igual que en /contador: así el link de "el
 * trimestre" se puede guardar o mandar, y los totales se calculan una sola vez
 * en el servidor.
 */
import { eq } from 'drizzle-orm';
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { periodoDe, GRANOS, type Grano } from '@/lib/services/reporting/accountant.report';
import {
  getExpenseSummary,
  getExpenseTotals,
  listExpenses,
} from '@/lib/services/expenses/expense.service';
import { listTerceros } from '@/lib/cash/terceros';
import { getActiveCashSession } from '@/lib/cash/sessions';
import { GastosClient, type GastoDTO } from './GastosClient';

/** El primer día del período y el primer día del SIGUIENTE, como 'AAAA-MM-DD'. */
const soloFecha = (d: Date) => d.toISOString().slice(0, 10);

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const session = await requireSessionWithCompany();
  const { periodo: pedido } = await searchParams;

  // Un valor raro en la URL cae al mes en vez de romper: la URL la escribe
  // cualquiera. Mismo criterio que /contador.
  const grano: Grano = GRANOS.includes(pedido as Grano) ? (pedido as Grano) : 'mes';

  // El mes de cierre de ejercicio sale de la empresa (migration 0027). Se lee
  // ANTES del período porque el grano `ejercicio` depende de él: el de esta
  // empresa puede no ser diciembre, y ahí el año calendario no sirve.
  const [company] = await db
    .select({
      name: companies.name,
      mesCierre: companies.fiscal_year_end_month,
    })
    .from(companies)
    .where(eq(companies.id, session.active_company_id))
    .limit(1);

  const mesCierre = company?.mesCierre ?? 12;
  const periodo = periodoDe(grano, new Date(), mesCierre);
  const desde = soloFecha(periodo.desde);
  const hasta = soloFecha(periodo.hasta);

  const [gastos, resumen, porCategoria, proveedores, cajaAbierta] =
    await withServerActionTracing(
      async () =>
        Promise.all([
          listExpenses(desde, hasta),
          // Los totales salen de SQL y NO de sumar en el navegador: es plata
          // (CLAUDE.md §9.8), y sumar strings con `+=` da bien con importes
          // redondos y mal con centavos, que es la peor forma de estar mal.
          getExpenseSummary(desde, hasta),
          getExpenseTotals(desde, hasta),
          listTerceros('proveedor'),
          getActiveCashSession(1).then((s) => s !== null),
        ]),
      { requireAuth: true }
    );

  // DTO explícito, no la fila de Drizzle: `cash_movement_id` es un BigInt y
  // React no lo puede serializar hacia el cliente. Además la pantalla no
  // necesita el id — sólo si salió o no del cajón.
  const dtos: GastoDTO[] = gastos.map((g) => ({
    id: g.id,
    fecha: g.fecha,
    categoria: g.categoria,
    payee_name: g.payee_name,
    payee_doc: g.payee_doc,
    neto: g.neto,
    iva: g.iva,
    total: g.total,
    descripcion: g.descripcion,
    comprobante_tipo: g.comprobante_tipo,
    comprobante_numero: g.comprobante_numero,
    en_iva_compras: g.en_iva_compras,
    medio_pago: g.medio_pago,
    salio_de_caja: g.cash_movement_id !== null,
    created_at: g.created_at.toISOString(),
  }));

  return (
    <GastosClient
      gastos={dtos}
      resumen={resumen}
      porCategoria={porCategoria}
      proveedores={proveedores.map((p) => ({
        id: p.id,
        name: p.name,
        doc: p.doc,
      }))}
      grano={grano}
      periodoEtiqueta={periodo.etiqueta}
      hayCajaAbierta={cajaAbierta}
      cashierName={session.email.replace(/@.*/, '')}
      salePointLabel={company?.name ?? 'Mi comercio'}
    />
  );
}
