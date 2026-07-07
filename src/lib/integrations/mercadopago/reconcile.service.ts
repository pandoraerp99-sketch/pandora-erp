/**
 * Reconciliación de un pago MercadoPago tras recibir un webhook.
 * Sprint 5 ROADMAP Sales+MP — Integrations context (Fase B, handler del worker
 * mp.reconcile_webhook). Es un handler-función (se testea directo); el loop es
 * un cron Vercel aparte (CLAUDE.md §20.12 — no background jobs descontrolados).
 *
 * **"VERIFY, don't trust":** re-consulta el status AUTORITATIVO a la API de MP
 * (`deps.fetchPayment`) — NUNCA confía en el body del webhook — y actualiza
 * `mp_payments.status` + `reconciled_at` dentro de una transacción, idempotente.
 *
 * **Idempotencia sin regresión:** un webhook re-entregado o fuera de orden siempre
 * dispara un re-fetch a la API, que devuelve el status verdadero ACTUAL. Por eso no
 * hay riesgo de regresión desde datos stale (a diferencia de confiar en el body).
 * Si el status ya coincide → noop.
 *
 * **Tenant:** del tracing context (`requireTenantId`). El caller (route/worker) corre
 * esto dentro de `withTracingContext` con el company_id del path per-tenant.
 *
 * **Slice fino:** esta versión actualiza `mp_payments` (+ audit). La transición de
 * `sale.commercial_status` (approved→cobrada, rejected→cancelada) es la próxima rama;
 * se construye encima de esto sin re-tocarlo.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { mp_payments } from '../../db/schema/mp_payments.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { requireTenantId } from '../../tracing/context.js';
import { type GetMpPaymentResult } from './mp-api-client.js';

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Fuente del status autoritativo — inyectable para tests (sin keys ni red).
 * Real: `(id) => getMpPayment(id, { accessToken: <token del tenant via vault> })`.
 */
export interface ReconcileMpDeps {
  fetchPayment: (mpPaymentId: string) => Promise<GetMpPaymentResult>;
}

export type ReconcileMpOutcome =
  | { outcome: 'updated'; from: string; to: string; reclassified: boolean }
  | { outcome: 'noop_same_status'; status: string }
  | { outcome: 'mp_payment_not_found'; mpPaymentId: string }
  | { outcome: 'fetch_failed'; reason: string };

export async function reconcileMpPayment(
  mpPaymentId: string,
  deps: ReconcileMpDeps
): Promise<ReconcileMpOutcome> {
  const tenant_id = requireTenantId();

  // 1. VERIFY — status autoritativo desde la API de MP (no el body del webhook).
  const fetched = await deps.fetchPayment(mpPaymentId);
  if (!fetched.ok) {
    // transient (network/http) o unauthorized/not_found → el worker reintenta / manual.
    return { outcome: 'fetch_failed', reason: fetched.reason };
  }
  const authoritative = fetched.payment;

  const runInTx = async (tx: DbOrTransaction): Promise<ReconcileMpOutcome> => {
    const rows = await tx
      .select()
      .from(mp_payments)
      .where(
        and(
          eq(mp_payments.tenant_id, tenant_id),
          eq(mp_payments.mp_payment_id, mpPaymentId)
        )
      )
      .for('update')
      .limit(1);

    const row = rows[0];
    if (!row) {
      // El POS aún no insertó el mp_payments inicial (race raro) → el worker reintenta.
      return { outcome: 'mp_payment_not_found', mpPaymentId };
    }
    if (row.status === authoritative.status) {
      return { outcome: 'noop_same_status', status: row.status };
    }

    const isTerminal = authoritative.status !== 'pending';
    const now = new Date();

    await tx
      .update(mp_payments)
      .set({
        status: authoritative.status,
        webhook_received_at: now,
        // reconciled_at se sella al llegar a terminal y no se pisa uno previo.
        reconciled_at:
          isTerminal && row.reconciled_at === null ? now : row.reconciled_at,
        updated_at: now,
      })
      .where(
        and(eq(mp_payments.tenant_id, tenant_id), eq(mp_payments.id, row.id))
      );

    // Audit: el catálogo F0 tiene payment.mp.confirmed (approved) y payment.mp.refunded.
    // rejected/cancelled no tienen evento audit F0 dedicado → van a Pino, no a audit_log.
    if (authoritative.status === 'approved') {
      await writeAuditLog(
        {
          event_name: 'payment.mp.confirmed',
          payload: {
            mp_payment_id: mpPaymentId,
            from_status: row.status,
            to_status: authoritative.status,
            raw_status: authoritative.rawStatus,
            reclassified: authoritative.statusReclassified,
            amount: authoritative.amount,
            external_reference: authoritative.externalReference,
          },
          pii_level: 'internal',
          severity: 'info',
        },
        tx
      );
    } else if (authoritative.status === 'refunded') {
      await writeAuditLog(
        {
          event_name: 'payment.mp.refunded',
          payload: {
            mp_payment_id: mpPaymentId,
            from_status: row.status,
            to_status: authoritative.status,
            amount: authoritative.amount,
            external_reference: authoritative.externalReference,
          },
          pii_level: 'internal',
          severity: 'warning',
        },
        tx
      );
    }

    return {
      outcome: 'updated',
      from: row.status,
      to: authoritative.status,
      reclassified: authoritative.statusReclassified,
    };
  };

  return await db.transaction(runInTx);
}
