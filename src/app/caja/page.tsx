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
import { computeCashBreakdown, getActiveCashSession } from '@/lib/cash/sessions';
import { db } from '@/lib/db/client';
import { and, eq, lte, sql } from 'drizzle-orm';
import { cash_sessions } from '@/lib/db/schema/cash_sessions';
import { companies } from '@/lib/db/schema/companies';
import { users } from '@/lib/db/schema/users';
import { listOrderPaymentsForSession } from '@/lib/services/orders/order.service';
import { listReliefsForSession, ROLES_QUE_RETIRAN } from '@/lib/cash/reliefs';
import { leerRolEnElComercio } from '@/lib/auth/autorizacion';
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
  CajaMovManualDTO,
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
      // El esperado sale de LA fórmula del cierre, no de una suma en pantalla.
      const desglose = cashSession
        ? await computeCashBreakdown(db, cashSession.id, cashSession.tenant_id, cashSession.initial_amount)
        : null;
      const cobrosPedidos = cashSession ? await listOrderPaymentsForSession(cashSession.id) : [];
      const alivios = cashSession ? await listReliefsForSession(cashSession.id) : [];
      // Barra de sesión (caja-editorial.html): "Sesión #00482", quién la abrió
      // y "{comercio} · PV 0001". El número es el orden de la sesión dentro del
      // comercio; no se guarda, se cuenta.
      const numeroSesion = cashSession
        ? Number(
            (
              await db
                .select({ n: sql<number>`count(*)::int` })
                .from(cash_sessions)
                .where(
                  and(
                    eq(cash_sessions.tenant_id, cashSession.tenant_id),
                    lte(cash_sessions.opened_at, cashSession.opened_at)
                  )
                )
            )[0]?.n ?? 0
          )
        : null;
      const [abrio] = cashSession
        ? await db
            .select({ nombre: sql<string>`COALESCE(${users.full_name}, ${users.email})` })
            .from(users)
            .where(eq(users.id, cashSession.opened_by))
            .limit(1)
        : [];
      const [comercio] = await db
        .select({ name: companies.name, pv: companies.afip_sale_point })
        .from(companies)
        .where(eq(companies.id, session.active_company_id ?? ''))
        .limit(1);
      const [yo] = await db
        .select({ nombre: sql<string>`COALESCE(${users.full_name}, ${users.email})` })
        .from(users)
        .where(eq(users.id, session.user_id))
        .limit(1);
      // Dentro del callback TS pierde el narrowing del redirect de arriba.
      const rol = await leerRolEnElComercio(session.active_company_id ?? "", session.user_id);
      const sales = await listTodaySales();
      const reasons = await listWithdrawalReasons();
      const empleados = await listTerceros('empleado');
      const proveedores = await listTerceros('proveedor');
      return { cashSession, summary, desglose, cobrosPedidos, alivios, rol, numeroSesion, abrio, comercio, yo, sales, reasons, empleados, proveedores };
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
        totalDeposits: data.desglose?.deposits ?? '0',
        totalWithdraws: data.desglose?.withdraws ?? '0',
        cashSales: data.desglose?.cashSales ?? '0',
        customerPayments: data.desglose?.customerPayments ?? '0',
        orderPayments: data.desglose?.orderPayments ?? '0',
        providerPayments: data.desglose?.providerPayments ?? '0',
        expected: data.desglose?.expected ?? data.cashSession.initial_amount,
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

  const manuales: CajaMovManualDTO[] = (data.summary?.movements ?? []).map((m) => ({
    id: String(m.id),
    type: m.type,
    amount: m.amount,
    reason: m.reason,
    payeeName: m.payee_name ?? null,
    timeIso: m.created_at ? m.created_at.toISOString() : null,
  }));

  return (
    <CajaClient
      cashierName={data.yo?.nombre ?? session.email}
      cajeroSesion={data.abrio?.nombre ?? null}
      numeroSesion={data.numeroSesion}
      salePointLabel={data.comercio ? `${data.comercio.name} · PV ${data.comercio.pv.padStart(4, '0')}` : `Caja ${SALE_POINT}`}
      session={sessionDto}
      movimientos={movimientos}
      movimientosManuales={manuales}
      alivios={data.alivios.map((a) => ({
        id: a.id,
        amount: a.amount,
        timeIso: a.created_at.toISOString(),
        por: a.por,
        pickedAtIso: a.picked_at ? a.picked_at.toISOString() : null,
        pickedPor: a.picked_por,
      }))}
      puedeRetirarAlivios={ROLES_QUE_RETIRAN.includes(data.rol ?? '')}
      cobrosPedidos={data.cobrosPedidos.map((c) => ({
        id: `pedido-${c.id}`,
        total: c.amount,
        // La caja agrupa transferencia con QR ("QR / Transferencia") en el arqueo.
        method: c.method === 'transferencia' ? 'mp_qr' : c.method,
        customerName: c.customer_name,
        finalizedAtIso: c.created_at.toISOString(),
        pedido: { number: c.number, kind: c.kind },
      }))}
      reasons={reasons}
      empleados={empleados}
      proveedores={proveedores}
      isOwner={session.app_role === 'owner'}
    />
  );
}
