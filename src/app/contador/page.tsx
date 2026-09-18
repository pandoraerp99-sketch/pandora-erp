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
  getResumenContable,
  periodoDe,
  GRANOS,
  type Grano,
} from '@/lib/services/reporting/accountant.report';
import { getInventarioAlCierre } from '@/lib/services/reporting/inventario.report';
import {
  getCajaAlCierre,
  getAcreedoresAlCierre,
  getDeudoresAlCierre,
} from '@/lib/services/reporting/cierre.report';
import { fechaDeLaFoto } from '@/lib/domain/inventario';
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

  // El inventario, la caja y los deudores son FOTOS, no flujos: valen a un día,
  // no a un rango. La regla (último día del período acotado a hoy, con "hoy"
  // leído en la zona del comercio) vive en `fechaDeLaFoto`, que se prueba sola.
  //
  // Las CUATRO usan LA MISMA fecha a propósito: son cuatro columnas de un mismo
  // balance, y con fechas distintas no cerrarían entre sí.
  const fechaCierre = fechaDeLaFoto(periodo.hasta);

  const [resumen, inventario, caja, deudores, acreedores] =
    await withServerActionTracing(
      async () =>
        Promise.all([
          getResumenContable(periodo),
          getInventarioAlCierre(fechaCierre),
          getCajaAlCierre(fechaCierre),
          getDeudoresAlCierre(fechaCierre),
          // Ítem 9 (ADR-0028): la otra cara de los deudores.
          getAcreedoresAlCierre(fechaCierre),
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
      fechaCierre={fechaCierre}
      caja={caja}
      deudores={deudores}
      acreedores={acreedores}
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
