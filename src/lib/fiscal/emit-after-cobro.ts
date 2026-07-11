/**
 * emitAfterCobro — orquestación post-cobro de la emisión del CAE.
 *
 * Se llama DESPUÉS de finalizeSale (que ya commiteó la venta como cobrada). Es
 * **best-effort y NUNCA lanza**: el cobro ya está hecho (plata + stock), así que
 * un fallo de emisión NO puede romper la respuesta del cobro. Ante cualquier
 * problema, la venta queda en su estado fiscal (`pending` / `requires_reconciliation`)
 * para que el worker o el operador la resuelvan.
 *
 * Casos:
 *   - Venta no requiere factura (fiscal_status != pending/requires_reconciliation)
 *     → no-op (`not_pending`).
 *   - No hay cliente AFIP configurado (sin cert todavía) → skip (`fiscal_client_unavailable`),
 *     la venta queda en `pending` (fail-closed A-2).
 *   - Cliente disponible → delega en emitInvoice (que decide issued/rejected/etc.).
 *   - emitInvoice lanza (bug/edge) → se captura, se loguea, la venta queda en su
 *     estado (emitInvoice hace rollback de su tx ante throw → vuelve a pending).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { FiscalStatus } from '../db/schema/_common.js';
import { sales } from '../db/schema/sales.js';
import { logger } from '../observability/logger.js';
import { requireTenantId } from '../tracing/context.js';
import { emitInvoice, type CaeRequester, type EmitOutcome } from './emit-invoice.js';
import { getCaeRequester } from './fiscal-client-factory.js';
import type { InvoiceType } from './invoice-type.js';
import type { FiscalMessage } from '../integrations/afip/wsfev1-response.js';

export type EmitAfterCobroReason =
  | 'not_pending'
  | 'fiscal_client_unavailable'
  | 'emit_error';

export interface EmitAfterCobroResult {
  /** true solo si se llamó a AFIP (haya salido issued o no). */
  emitted: boolean;
  reason?: EmitAfterCobroReason;
  fiscal_status: FiscalStatus;
  outcome?: EmitOutcome;
  invoice_type?: InvoiceType;
  invoice_number?: number;
  cae?: string | null;
  cae_vto?: string | null;
  observaciones?: FiscalMessage[];
}

export interface EmitAfterCobroDeps {
  /** Factory inyectable del cliente AFIP (default: getCaeRequester real). */
  getClient?: (tenantId: string) => Promise<CaeRequester | null>;
  now?: () => Date;
}

async function currentFiscalStatus(
  tenantId: string,
  saleId: string
): Promise<FiscalStatus | null> {
  const rows = await db
    .select({ fs: sales.fiscal_status })
    .from(sales)
    .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, saleId)))
    .limit(1);
  return (rows[0]?.fs as FiscalStatus | undefined) ?? null;
}

export async function emitAfterCobro(
  saleId: string,
  deps: EmitAfterCobroDeps = {}
): Promise<EmitAfterCobroResult> {
  const tenantId = requireTenantId();

  const fiscalStatus = await currentFiscalStatus(tenantId, saleId);
  if (fiscalStatus === null) {
    // Venta inexistente para el tenant — best-effort, no lanzamos.
    return { emitted: false, reason: 'not_pending', fiscal_status: 'not_required' };
  }
  if (fiscalStatus !== 'pending' && fiscalStatus !== 'requires_reconciliation') {
    return { emitted: false, reason: 'not_pending', fiscal_status: fiscalStatus };
  }

  const getClient = deps.getClient ?? getCaeRequester;
  let client: CaeRequester | null = null;
  try {
    client = await getClient(tenantId);
  } catch (err) {
    logger.warn({ sale_id: saleId, err: String(err) }, 'fiscal.client_factory_failed');
    client = null;
  }
  if (!client) {
    return {
      emitted: false,
      reason: 'fiscal_client_unavailable',
      fiscal_status: fiscalStatus,
    };
  }

  try {
    const r = await emitInvoice(saleId, { client, now: deps.now });
    return {
      emitted: true,
      fiscal_status: r.fiscal_status,
      outcome: r.outcome,
      invoice_type: r.invoice_type,
      invoice_number: r.invoice_number,
      cae: r.cae,
      cae_vto: r.cae_vto,
      observaciones: r.observaciones,
    };
  } catch (err) {
    // Bug/edge en la emisión: el cobro ya está commiteado, no rompemos la
    // respuesta. emitInvoice hace rollback de SU tx ante throw → la venta queda
    // en pending. Releemos el estado real para reportarlo.
    logger.error(
      { sale_id: saleId, err: String(err) },
      'fiscal.emit_after_cobro_failed'
    );
    const after = (await currentFiscalStatus(tenantId, saleId)) ?? fiscalStatus;
    return { emitted: false, reason: 'emit_error', fiscal_status: after };
  }
}
