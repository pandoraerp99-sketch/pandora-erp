/**
 * Panel de la contadora — Server Component.
 *
 * Maqueta: `pos-preview/contador-v2.html`.
 *
 * Muestra SÓLO lo que se puede calcular hoy. Las siete secciones de la maqueta
 * que no tienen dato detrás (IVA crédito, asientos, retenciones, IIBB,
 * conciliación bancaria, estado de resultados, recategorización) no se dibujan
 * vacías: se listan aparte diciendo qué falta para cada una. Un panel en cero
 * se lee como "no hubo movimiento", que a un contador le dice algo muy
 * distinto de "todavía no lo calculamos".
 */
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { listCompaniesForUser } from '@/lib/services/identity/accountant.service';
import {
  getResumenContable,
  mesDe,
} from '@/lib/services/reporting/accountant.report';
import { ContadorClient } from './ContadorClient';

export default async function ContadorPage() {
  const session = await requireSessionWithCompany();

  const empresas = await listCompaniesForUser(session.user_id);
  const periodo = mesDe();
  const resumen = await withServerActionTracing(
    () => getResumenContable(periodo),
    { requireAuth: true }
  );

  const activa = empresas.find((e) => e.id === session.active_company_id);

  return (
    <ContadorClient
      empresas={empresas}
      empresaActivaId={session.active_company_id}
      empresaActivaNombre={activa?.name ?? 'Mi comercio'}
      // Sólo un contador ve el selector: el dueño de un comercio tiene una
      // sola empresa y una fila de chips con un chip es ruido.
      esContador={session.app_role === 'accountant'}
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
