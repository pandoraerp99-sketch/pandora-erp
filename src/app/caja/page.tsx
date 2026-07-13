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
import { requireSessionWithCompany } from '@/lib/auth/session';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { getActiveCashSession } from '@/lib/cash/sessions';
import { getCashSessionSummary } from '@/lib/cash/queries';
import { listWithdrawalReasons } from '@/lib/cash/reasons';
import { listTodaySales } from '@/lib/services/sales/sale.service';
import { CajaClient } from './CajaClient';
import type { CajaSessionDTO, CajaMovimientoDTO, CajaReasonDTO } from './CajaClient';

// F0: un único punto de venta (Caja 1), igual que el POS (page.tsx).
const SALE_POINT = 1;

export default async function CajaPage() {
  const session = await requireSessionWithCompany();

  const data = await withServerActionTracing(
    async () => {
      const cashSession = await getActiveCashSession(SALE_POINT);
      const summary = cashSession ? await getCashSessionSummary(cashSession.id) : null;
      const sales = await listTodaySales();
      const reasons = await listWithdrawalReasons();
      return { cashSession, summary, sales, reasons };
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
  }));

  return (
    <CajaClient
      cashierName={session.email}
      salePointLabel={`Caja ${SALE_POINT}`}
      session={sessionDto}
      movimientos={movimientos}
      reasons={reasons}
      isOwner={session.app_role === 'owner'}
    />
  );
}
