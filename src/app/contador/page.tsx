/**
 * Panel de la contadora — Server Component.
 *
 * Maqueta: `pos-preview/contador-v2.html`.
 *
 * El período (mes / trimestre / año) viaja en la URL, no en estado del
 * cliente: así el contador puede guardar el link de "el trimestre" o mandarlo
 * por mail, y el resumen se calcula en el servidor una sola vez.
 */
import { eq } from 'drizzle-orm';
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { listCompaniesForUser } from '@/lib/services/identity/accountant.service';
import {
  getDeudores,
  getResumenContable,
  periodoDe,
  GRANOS,
  type Grano,
} from '@/lib/services/reporting/accountant.report';
import { getInventarioAlCierre } from '@/lib/services/reporting/inventario.report';
import { ContadorClient } from './ContadorClient';

export default async function ContadorPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const session = await requireSessionWithCompany();
  const { periodo: pedido } = await searchParams;

  // Un valor raro en la URL cae al mes, no rompe la pantalla: la URL la
  // escribe cualquiera.
  const grano: Grano = GRANOS.includes(pedido as Grano)
    ? (pedido as Grano)
    : 'mes';

  const empresas = await listCompaniesForUser(session.user_id);

  // El mes de cierre de ejercicio de la empresa ACTIVA (migration 0027). Sin
  // esto el grano `ejercicio` caería en el default 12 y le mostraría a la
  // contadora un año calendario diciendo que es el ejercicio.
  const [empresa] = await db
    .select({ mesCierre: companies.fiscal_year_end_month })
    .from(companies)
    .where(eq(companies.id, session.active_company_id))
    .limit(1);

  const periodo = periodoDe(grano, new Date(), empresa?.mesCierre ?? 12);

  // ── La fecha del inventario ──────────────────────────────────────────────
  //
  // El inventario es una FOTO, no un flujo: se valoriza a un día, no a un
  // rango. Se usa el último día del período **acotado a hoy**, porque valorizar
  // el futuro sería mostrar el stock de hoy con la etiqueta del 30 de
  // septiembre. Para el grano "ejercicio" —el que le importa al estudio— ese
  // día ya pasó, y ahí la foto es exactamente la del cierre.
  const finPeriodo = new Date(periodo.hasta.getTime() - 86400000);
  const hoy = new Date();
  const fechaInventario = (finPeriodo < hoy ? finPeriodo : hoy)
    .toISOString()
    .slice(0, 10);

  const [resumen, deudores, inventario] = await withServerActionTracing(
    async () =>
      Promise.all([
        getResumenContable(periodo),
        getDeudores(),
        getInventarioAlCierre(fechaInventario),
      ]),
    { requireAuth: true }
  );

  const activa = empresas.find((e) => e.id === session.active_company_id);

  return (
    <ContadorClient
      empresas={empresas}
      empresaActivaId={session.active_company_id}
      empresaActivaNombre={activa?.name ?? 'Mi comercio'}
      // Sólo un contador ve el selector con varias: el dueño tiene una sola.
      esContador={session.app_role === 'accountant'}
      grano={grano}
      deudores={deudores}
      inventario={{
        fecha: inventario.fecha,
        metodo: inventario.metodo,
        total: inventario.total,
        con_compra_total: inventario.con_compra_total,
        sin_compra_total: inventario.sin_compra_total,
        sin_valorizar_qty: inventario.sin_valorizar_qty,
        sin_valorizar_productos: inventario.sin_valorizar_productos,
        sin_tracking: inventario.sin_tracking,
        con_unidades_sin_compra: inventario.con_unidades_sin_compra,
        productos: inventario.filas.length,
        filas: inventario.filas.map((f) => ({
          name: f.name,
          cantidad: f.cantidad,
          con_compra_qty: f.con_compra_qty,
          sin_compra_qty: f.sin_compra_qty,
          total: f.total,
          sin_costo: f.sin_costo,
          anomalia: f.anomalia,
          ultima_compra: f.lotes[0]?.fecha ?? null,
        })),
      }}
      resumen={{
        ...resumen,
        periodo: {
          etiqueta: periodo.etiqueta,
          desde: periodo.desde.toISOString(),
        },
      }}
      usuario={session.email.replace(/@.*/, '')}
    />
  );
}
