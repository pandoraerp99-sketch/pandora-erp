/**
 * Panel de la contadora — Server Component.
 *
 * Maqueta: `pos-preview/contador-v2.html`.
 *
 * El período (mes / trimestre / año) viaja en la URL, no en estado del
 * cliente: así el contador puede guardar el link de "el trimestre" o mandarlo
 * por mail, y el resumen se calcula en el servidor una sola vez.
 */
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { listCompaniesForUser } from '@/lib/services/identity/accountant.service';
import {
  getDeudores,
  getResumenContable,
  periodoDe,
  GRANOS,
  type Grano,
} from '@/lib/services/reporting/accountant.report';
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
  const periodo = periodoDe(grano);

  const [resumen, deudores] = await withServerActionTracing(
    async () =>
      Promise.all([getResumenContable(periodo), getDeudores()]),
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
