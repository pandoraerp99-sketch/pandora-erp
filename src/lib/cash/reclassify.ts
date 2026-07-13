/**
 * Reclasificación de medio de pago (ADR-0026) — corrección APPEND-ONLY.
 *
 * Caso real: el cajero clasificó mal el medio de una venta ("efectivo cobrado,
 * marcado como débito"). El arqueo separa medios y el cierre deriva el efectivo
 * de `sale_payments`, así que la corrección tiene que reflejarse en esa tabla.
 *
 * Pero `sale_payments` es append-only (trigger `sale_payments_immutable` bloquea
 * UPDATE/DELETE a nivel DB). Entonces la corrección NO muta la fila original:
 * INSERTA una fila nueva con el método corregido y `corrects_id = <original>`.
 * "Activo" = fila que nadie apunta con su `corrects_id`. El UNIQUE parcial sobre
 * `corrects_id` garantiza ≤1 corrección por fila (mata el doble-click concurrente).
 *
 * Solo se recomputa el denormalizado `sales.payment_method` (cache, sin trigger
 * de inmutabilidad). El cierre (`computeExpectedAmountFromActivity`) filtra las
 * filas superseded, así el descuadre igual-y-opuesto se cierra automáticamente.
 *
 * **Alcance F0:** ventas de UN solo pago, en la sesión de caja ABIERTA. Mixto y
 * ventas de sesiones cerradas = F1+ (ver ADR-0026 §3).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sale_payments, type SalePayment } from '../db/schema/sale_payments.js';
import { sales } from '../db/schema/sales.js';
import { cash_sessions } from '../db/schema/cash_sessions.js';
import { SALE_PAYMENT_METHODS, type SalePaymentMethod } from '../db/schema/_common.js';
import { requireTracingContext } from '../tracing/context.js';
import { CrossTenantAccessError } from '../multi_tenant/errors.js';
import { isValidUuid } from '../tracing/ids.js';
import { writeAuditLog } from '../audit/audit-writer.js';

export type ReclassifyErrorCode =
  | 'invalid_sale_id'
  | 'invalid_method'
  | 'missing_reason'
  | 'sale_not_found'
  | 'sale_not_finalized'
  | 'no_open_session'
  | 'sale_not_in_open_session'
  | 'no_active_payment'
  | 'multi_payment_unsupported'
  | 'same_method'
  | 'already_reclassified';

export class ReclassifyValidationError extends Error {
  constructor(
    public readonly code: ReclassifyErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ReclassifyValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ReclassifySalePaymentInput {
  sale_id: string;
  new_method: SalePaymentMethod;
  /** Motivo obligatorio (defensa anti mutable-audit, igual que cash_movements). */
  reason: string;
}

export interface ReclassifyResult {
  correction: SalePayment;
  from_method: string;
  to_method: string;
  sale_id: string;
}

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === '23505'
  );
}

/**
 * Reclasifica el medio de una venta de UN pago finalizada en la sesión abierta.
 *
 * @throws ReclassifyValidationError input inválido / precondición no cumplida
 * @throws CrossTenantAccessError tenant_id ausente en context
 */
export async function reclassifySalePaymentMethod(
  input: ReclassifySalePaymentInput,
  txOrDb: DbOrTransaction = db
): Promise<ReclassifyResult> {
  const ctx = requireTracingContext();
  const tenant_id = ctx.tenant_id;
  if (!tenant_id) {
    throw new CrossTenantAccessError(
      'unknown',
      null,
      'cash.payment.reclassify: tenant_id ausente en context'
    );
  }

  if (!isValidUuid(input.sale_id)) {
    throw new ReclassifyValidationError(
      'invalid_sale_id',
      `sale_id no es UUID válido ("${input.sale_id}")`
    );
  }
  if (!SALE_PAYMENT_METHODS.includes(input.new_method)) {
    throw new ReclassifyValidationError(
      'invalid_method',
      `new_method "${input.new_method}" no válido. Valores: ${SALE_PAYMENT_METHODS.join(', ')}`
    );
  }
  const reason = (input.reason ?? '').trim();
  if (reason.length === 0) {
    throw new ReclassifyValidationError(
      'missing_reason',
      'reason es OBLIGATORIO para reclasificar un medio (defensa anti mutable-audit, ADR-0026).'
    );
  }

  const runInTx = async (tx: DbOrTransaction): Promise<ReclassifyResult> => {
    // 1. Venta del tenant, finalizada (cobrada).
    const saleRows = await tx
      .select({
        id: sales.id,
        sale_point: sales.sale_point,
        finalized_at: sales.finalized_at,
        commercial_status: sales.commercial_status,
      })
      .from(sales)
      .where(and(eq(sales.id, input.sale_id), eq(sales.tenant_id, tenant_id)))
      .limit(1);
    const sale = saleRows[0];
    if (!sale) {
      throw new ReclassifyValidationError(
        'sale_not_found',
        `Venta ${input.sale_id} no existe o pertenece a otro tenant.`
      );
    }
    if (!sale.finalized_at || sale.commercial_status !== 'cobrada') {
      throw new ReclassifyValidationError(
        'sale_not_finalized',
        'Solo se puede reclasificar el medio de una venta ya cobrada.'
      );
    }

    // 2. Sesión ABIERTA del punto de venta + la venta ocurrió durante ella.
    const sessRows = await tx
      .select({ id: cash_sessions.id, opened_at: cash_sessions.opened_at })
      .from(cash_sessions)
      .where(
        and(
          eq(cash_sessions.tenant_id, tenant_id),
          eq(cash_sessions.sale_point, sale.sale_point),
          isNull(cash_sessions.closed_at)
        )
      )
      .limit(1);
    const session = sessRows[0];
    if (!session) {
      throw new ReclassifyValidationError(
        'no_open_session',
        'No hay una caja abierta en este punto de venta. Reclasificar ventas de sesiones cerradas es F1+.'
      );
    }
    if (sale.finalized_at < session.opened_at) {
      throw new ReclassifyValidationError(
        'sale_not_in_open_session',
        'La venta es de una sesión de caja anterior (ya cerrada). Reclasificar historia cerrada es F1+.'
      );
    }

    // 3. Pagos ACTIVOS de la venta (no superseded). F0: exactamente uno.
    const active = await tx
      .select()
      .from(sale_payments)
      .where(
        and(
          eq(sale_payments.tenant_id, tenant_id),
          eq(sale_payments.sale_id, input.sale_id),
          sql`NOT EXISTS (SELECT 1 FROM sale_payments c WHERE c.corrects_id = ${sale_payments.id})`
        )
      );
    if (active.length === 0) {
      throw new ReclassifyValidationError(
        'no_active_payment',
        `La venta ${input.sale_id} no tiene pagos activos para reclasificar.`
      );
    }
    if (active.length > 1) {
      throw new ReclassifyValidationError(
        'multi_payment_unsupported',
        'Reclasificar ventas de pago múltiple (mixto) es F1+ con el editor de reparto.'
      );
    }
    const original = active[0]!;
    if (original.method === input.new_method) {
      throw new ReclassifyValidationError(
        'same_method',
        `La venta ya está registrada como ${input.new_method}.`
      );
    }

    // 4. INSERT de la corrección (append-only). El UNIQUE(corrects_id) es el
    // backstop de concurrencia: un 2do INSERT sobre la misma original falla.
    const newCashSessionId =
      input.new_method === 'efectivo' ? session.id : null;
    let inserted: SalePayment[];
    try {
      inserted = await tx
        .insert(sale_payments)
        .values({
          tenant_id,
          sale_id: input.sale_id,
          method: input.new_method,
          amount: original.amount,
          cash_session_id: newCashSessionId,
          mp_payment_external_id: null,
          corrects_id: original.id,
        })
        .returning();
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ReclassifyValidationError(
          'already_reclassified',
          'Esta venta ya fue reclasificada (posible doble click). Refrescá para ver el estado actual.'
        );
      }
      throw e;
    }
    const correction = inserted[0]!;

    // 5. Recompute denormalizado. F0 (un solo pago activo) → el nuevo método.
    await tx
      .update(sales)
      .set({
        payment_method: input.new_method,
        cash_session_id: newCashSessionId,
        updated_at: new Date(),
      })
      .where(and(eq(sales.id, input.sale_id), eq(sales.tenant_id, tenant_id)));

    // 6. Auditoría obligatoria (la reclasificación es corrección de un registro
    // financiero — auditabilidad sin opción, CLAUDE.md §1.7).
    await writeAuditLog(
      {
        event_name: 'payment.method_reclassified',
        payload: {
          sale_id: input.sale_id,
          sale_point: sale.sale_point,
          original_payment_id: original.id,
          correction_payment_id: correction.id,
          from_method: original.method,
          to_method: input.new_method,
          amount: original.amount,
          cash_session_id: newCashSessionId,
          reason,
        },
        pii_level: 'internal',
        severity: 'info',
      },
      tx
    );

    return {
      correction,
      from_method: original.method,
      to_method: input.new_method,
      sale_id: input.sale_id,
    };
  };

  if (txOrDb === db) {
    return await db.transaction(runInTx);
  }
  return await runInTx(txOrDb);
}
