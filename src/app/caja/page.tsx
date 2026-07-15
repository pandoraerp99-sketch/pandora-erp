/**
 * Caja — Server Component (port slice 1 del mockup public/caja.html a React).
 *
 * Carga (dentro del tracing context, para tenant_id) la sesión de caja ACTIVA
 * del punto de venta + su resumen de movimientos manuales + las ventas del día
 * (los "Últimos movimientos"). Delega el render en <CajaClient>.
 *
 * Backend YA existente (Sprint 4 Cash + Sprint 5 Sales): getActiveCashSession,
 * getCashSessionSummary, listTodaySales. Slice 1 = sólo lectura (barra de sesión
 * + movimientos). Alivios (registerCashMovement), cierre (closeCashSession) y el
 * editor de reparto por medio = slices siguientes.
 *
 * Taxonomía de medios: el backend hoy usa efectivo/tarjeta/mp_qr. La decisión
 * (arqueo separa débito/crédito — A-26 RESUELTO por investigación 2026-07-12, es
 * caja/reporting NO fiscal) se implementa extendiendo el enum en una slice aparte.
 */
import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { getActiveCashSession } from '@/lib/cash/sessions';
import { getCashSessionSummary } from '@/lib/cash/queries';
import { listWithdrawalReasons } from '@/lib/cash/reasons';
import { listTerceros } from '@/lib/cash/terceros';
import { listTodaySales } from '@/lib/services/sales/sale.service';
import { CajaClient } from './CajaClient';
import type {
  CajaSessionDTO,
  CajaMovimientoDTO,
  CajaReasonDTO,
  CajaTerceroDTO,
} from './CajaClient';
import type { BeneficiarioTipo } from '@/lib/db/schema/_common';

// F0: un único punto de venta (Caja 1), igual que el POS (page.tsx).
const SALE_POINT = 1;

export default async function CajaPage() {
  // Si la sesión venció / no hay login, redirigimos al login (en vez de tirar
  // un UnauthorizedError crudo en pantalla).
  const session = await getCurrentSession();
  if (!session?.active_company_id) {
    redirect('/login');
  }

  const data = await withServerActionTracing(
    async () => {
      const cashSession = await getActiveCashSession(SALE_POINT);
      const summary = cashSession ? await getCashSessionSummary(cashSession.id) : null;
      const sales = await listTodaySales();
      const reasons = await listWithdrawalReasons();
      const empleados = await listTerceros('empleado');
      const proveedores = await listTerceros('proveedor');
      return { cashSession, summary, sales, reasons, empleados, proveedores };
    },
    { requireAuth: true }
  );

  const sessionDto: CajaSessionDTO | null = data.cashSession
    ? {
        id: data.cashSession.id,
        salePoint: data.cashSession.sale_point,
        openedAtIso: data.cashSession.opened_at
          ? data.cashSession.opened_at.toISOString()
          : null,
        initialAmount: data.cashSession.initial_amount,
        totalDeposits: data.summary?.totals.total_deposits ?? '0',
        totalWithdraws: data.summary?.totals.total_withdraws ?? '0',
        expectedFromMovements:
          data.summary?.totals.expected_from_movements ??
          data.cashSession.initial_amount,
      }
    : null;

  const movimientos: CajaMovimientoDTO[] = data.sales.map((s) => ({
    id: s.id,
    total: s.total,
    method: s.payment_method,
    customerName: s.customer_name_snapshot,
    finalizedAtIso: s.finalized_at ? s.finalized_at.toISOString() : null,
  }));

  const reasons: CajaReasonDTO[] = data.reasons.map((r) => ({
    id: r.id,
    label: r.label,
    beneficiarioTipo: r.beneficiario_tipo as BeneficiarioTipo,
  }));

  const toTercero = (t: (typeof data.empleados)[number]): CajaTerceroDTO => ({
    id: t.id,
    type: t.type as CajaTerceroDTO['type'],
    name: t.name,
    doc: t.doc,
  });
  const empleados: CajaTerceroDTO[] = data.empleados.map(toTercero);
  const proveedores: CajaTerceroDTO[] = data.proveedores.map(toTercero);

  return (
    <CajaClient
      cashierName={session.email}
      salePointLabel={`Caja ${SALE_POINT}`}
      session={sessionDto}
      movimientos={movimientos}
      reasons={reasons}
      empleados={empleados}
      proveedores={proveedores}
      isOwner={session.app_role === 'owner'}
    />
  );
}
