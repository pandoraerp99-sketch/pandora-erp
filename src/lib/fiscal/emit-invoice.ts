/**
 * emitInvoice — emisión del comprobante electrónico (CAE) para una venta ya
 * cobrada. Sprint 6 slice 4. ADR-0022 + ADR-0006 + RECONCILIATION-ENGINE + §8.5.
 *
 * Se llama DESPUÉS de finalizeSale (que deja la venta `cobrada` + `pending`).
 * Separar el cobro de la emisión mantiene el cobro rápido y hace la emisión
 * reintentable por el worker (RECONCILIATION-ENGINE). El Wsfev1Client se INYECTA
 * → testeable con fake; el cliente real (con cert) enchufa igual.
 *
 * ── Frontera transaccional (decisión consciente, §8.5) ──────────────────────
 * AFIP exige numeración ESTRICTAMENTE correlativa (CbteDesde = último autorizado
 * + 1; error 10016 "no correlativo" — Manual v4.5). Por eso el número local solo
 * puede avanzar cuando AFIP AUTORIZA. Diseño:
 *   BEGIN → SELECT next_number FOR UPDATE (serializa por PtoVta+CbteTipo) →
 *   transición → requesting → llamar AFIP (dentro de la tx) →
 *     · issued/observed → next_number+1 + snapshot + issued + audit → COMMIT
 *     · rejected/error  → NO incrementa (número reusable) + manual + audit → COMMIT
 *     · timeout/red     → NO incrementa + requires_reconciliation + audit → COMMIT
 *                         (el worker recupera vía FECompUltimoAutorizado)
 * NO se usa "reserve-first" porque incrementar antes de AFIP rompería la
 * correlatividad ante un rechazo. Mantener la tx abierta durante la llamada AFIP
 * requiere una conexión session-mode/directa (NO el pooler transaccional 6543 de
 * Supabase). Dev/homologación usa 5432 directo. **Constraint de deploy productivo:
 * DATABASE_URL de la ruta fiscal debe ser conexión directa/session, no 6543.**
 *
 * Snapshot: SOLO en éxito (fiscal_snapshots es UNIQUE(sale_id) + inmutable; un
 * snapshot de un intento rechazado rompería el retry exitoso posterior).
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { AfipEnvironment, FiscalStatus } from '../db/schema/_common.js';
import { companies } from '../db/schema/companies.js';
import { fiscal_snapshots } from '../db/schema/fiscal_snapshots.js';
import { invoice_sequences } from '../db/schema/invoice_sequences.js';
import { sale_items, sales } from '../db/schema/sales.js';
import type { UnitType } from '../db/schema/products.js';
import {
  CALCULATION_ENGINE_VERSION,
  TAX_POLICY_VERSION,
  calculateSaleTotals,
  validateFiscalInvariant,
} from '../domain/calculation.js';
import { assertFiscalTransition } from '../domain/state-machines.js';
import { MONEY_POLICY } from '../money/policy.js';
import { writeAuditLog } from '../audit/audit-writer.js';
import { logger } from '../observability/logger.js';
import {
  FiscalIntegrityError,
  NotFoundError,
  StateTransitionError,
} from '../multi_tenant/errors.js';
import { requireTenantId } from '../tracing/context.js';
import type { RequestCaeResult } from '../integrations/afip/wsfev1-client.js';
import { CBTE_TIPO_BY_INVOICE_TYPE } from './afip-codes.js';
import { formatArIso } from '../integrations/afip/wsaa-tra.js';
import { selectInvoiceType, type InvoiceType } from './invoice-type.js';
import { projectToWSFEv1, type Wsfev1DetRequest } from './projection/wsfev1.js';
import { buildReceptor } from './receptor.js';
import type { FiscalMessage } from '../integrations/afip/wsfev1-response.js';

/**
 * Interfaz estrecha del cliente WSFEv1 que emitInvoice necesita (DIP): solo
 * `requestCae`. El `Wsfev1Client` real la satisface estructuralmente; los tests
 * inyectan un fake sin cert ni red.
 */
export interface CaeRequester {
  requestCae(
    tenantId: string,
    environment: AfipEnvironment,
    ptoVta: number,
    cbteTipo: number,
    det: Wsfev1DetRequest
  ): Promise<RequestCaeResult>;
}

export interface EmitInvoiceDeps {
  client: CaeRequester;
  now?: () => Date;
}

export type EmitOutcome =
  | 'issued'
  | 'already_issued'
  | 'rejected'
  | 'reconciliation_pending';

export interface EmitInvoiceResult {
  outcome: EmitOutcome;
  fiscal_status: FiscalStatus;
  invoice_type?: InvoiceType;
  invoice_number?: number;
  cae?: string | null;
  cae_vto?: string | null;
  observaciones?: FiscalMessage[];
  errors?: FiscalMessage[];
}

/** Fecha del comprobante en formato AFIP YYYYMMDD, en hora de Argentina. */
function cbteFchAr(now: Date): string {
  return formatArIso(now).slice(0, 10).replace(/-/g, '');
}

/** '20260720' (AFIP) → '2026-07-20' (columna date). */
function afipDateToIso(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

export async function emitInvoice(
  saleId: string,
  deps: EmitInvoiceDeps
): Promise<EmitInvoiceResult> {
  const tenantId = requireTenantId();
  const now = deps.now ?? (() => new Date());

  // ── 1. Cargar venta + validar precondiciones ──────────────────────────────
  const saleRows = await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, saleId)))
    .limit(1);
  const sale = saleRows[0];
  if (!sale) throw new NotFoundError('Venta', saleId);

  const currentFiscal = sale.fiscal_status as FiscalStatus;

  // Idempotente: ya emitida → no-op (devuelve el estado). El worker o un
  // doble-click no re-emiten.
  if (currentFiscal === 'issued' || currentFiscal === 'reconciled_issued') {
    return { outcome: 'already_issued', fiscal_status: currentFiscal };
  }
  if (sale.commercial_status !== 'cobrada') {
    throw new StateTransitionError('fiscal.emit', sale.commercial_status, 'cobrada');
  }
  if (currentFiscal !== 'pending' && currentFiscal !== 'requires_reconciliation') {
    // not_required, requesting (en vuelo), failed, etc. → no corresponde emitir acá.
    throw new StateTransitionError('fiscal.emit', currentFiscal, 'requesting');
  }

  // ── 2. Cargar company + items, recomputar totales (no confiar en persistido) ─
  const companyRows = await db
    .select()
    .from(companies)
    .where(eq(companies.id, tenantId))
    .limit(1);
  const company = companyRows[0];
  if (!company) throw new NotFoundError('Company', tenantId);

  const items = await db
    .select()
    .from(sale_items)
    .where(and(eq(sale_items.tenant_id, tenantId), eq(sale_items.sale_id, saleId)))
    .orderBy(sale_items.created_at);
  if (items.length === 0) {
    throw new FiscalIntegrityError('Venta sin items no se puede emitir', { saleId });
  }

  const totals = calculateSaleTotals(
    items.map((it) => ({
      product_id: it.product_id,
      product_name_snapshot: it.product_name_snapshot,
      product_sku_snapshot: it.product_sku_snapshot,
      unit_type: it.product_unit_type_snapshot as UnitType,
      unit_price: it.unit_price,
      quantity: it.quantity,
      tax_rate: it.tax_rate,
      tdf_exempt: it.tdf_exempt,
    }))
  );
  validateFiscalInvariant(totals);

  const receptor = buildReceptor({
    doc_type: sale.customer_doc_type,
    doc_number: sale.customer_doc_number,
    tax_condition: sale.customer_tax_condition_snapshot,
  });
  const invoiceType = selectInvoiceType(
    company.tax_regime as Parameters<typeof selectInvoiceType>[0],
    receptor.condition
  );
  const cbteTipo = CBTE_TIPO_BY_INVOICE_TYPE[invoiceType];
  const ptoVta = Number(company.afip_sale_point);
  if (!Number.isInteger(ptoVta) || ptoVta <= 0) {
    throw new FiscalIntegrityError('afip_sale_point de la company inválido', {
      afip_sale_point: company.afip_sale_point,
    });
  }
  const environment = company.afip_environment as AfipEnvironment;
  const cbteFch = cbteFchAr(now());

  // ── 3. Emisión (§8.5: lock sostenido durante AFIP; incrementa solo en éxito) ─
  const result = await db.transaction(async (tx): Promise<EmitInvoiceResult> => {
    // Race del primer número: asegurar la row antes del lock (ON CONFLICT).
    await tx
      .insert(invoice_sequences)
      .values({ tenant_id: tenantId, sale_point: ptoVta, invoice_type: invoiceType, next_number: 1 })
      .onConflictDoNothing();

    const seqRows = await tx
      .select()
      .from(invoice_sequences)
      .where(
        and(
          eq(invoice_sequences.tenant_id, tenantId),
          eq(invoice_sequences.sale_point, ptoVta),
          eq(invoice_sequences.invoice_type, invoiceType)
        )
      )
      .for('update')
      .limit(1);
    const seq = seqRows[0];
    if (!seq) throw new FiscalIntegrityError('invoice_sequences no encontrada tras upsert', {});
    const invoiceNumber = seq.next_number;

    // Guard anti-doble-emisión: re-leer el estado BAJO el lock.
    const freshRows = await tx
      .select({ fiscal_status: sales.fiscal_status })
      .from(sales)
      .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, saleId)))
      .limit(1);
    const fresh = freshRows[0]!.fiscal_status as FiscalStatus;
    if (fresh === 'issued' || fresh === 'reconciled_issued') {
      return { outcome: 'already_issued', fiscal_status: fresh };
    }
    if (fresh !== 'pending' && fresh !== 'requires_reconciliation') {
      throw new StateTransitionError('fiscal.emit', fresh, 'requesting');
    }

    // Transición → requesting.
    assertFiscalTransition(fresh, 'requesting');
    await tx
      .update(sales)
      .set({ fiscal_status: 'requesting', updated_at: now() })
      .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, saleId)));

    const det = projectToWSFEv1({
      totals,
      invoice_type: invoiceType,
      sale_point: ptoVta,
      invoice_number: invoiceNumber,
      cbte_fecha: cbteFch,
      receptor: {
        doc_tipo: receptor.doc_tipo,
        doc_nro: receptor.doc_nro,
        condicion_iva_id: receptor.condicion_iva_id,
      },
    });

    // Llamada AFIP DENTRO de la tx. Un fallo de transporte (timeout/red) NO
    // hace rollback: lo capturamos y commiteamos requires_reconciliation (el
    // número NO se incrementó → el worker reusa el mismo).
    let cae;
    try {
      cae = await deps.client.requestCae(tenantId, environment, ptoVta, cbteTipo, det);
    } catch (transportErr) {
      assertFiscalTransition('requesting', 'requires_reconciliation');
      await tx
        .update(sales)
        .set({ fiscal_status: 'requires_reconciliation', updated_at: now() })
        .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, saleId)));
      await writeAuditLog(
        {
          event_name: 'fiscal.invoice.requires_reconciliation',
          payload: {
            sale_id: saleId,
            invoice_type: invoiceType,
            attempted_number: invoiceNumber,
            reason: 'afip_transport_error',
            error: String(transportErr),
          },
          pii_level: 'internal',
          severity: 'warning',
        },
        tx
      );
      return {
        outcome: 'reconciliation_pending',
        fiscal_status: 'requires_reconciliation',
        invoice_type: invoiceType,
      };
    }

    if (cae.outcome === 'issued' || cae.outcome === 'observed') {
      if (!cae.cae || !cae.caeVto) {
        // Defensa: classifyCaeResult ya garantiza CAE en issued/observed.
        throw new FiscalIntegrityError('AFIP aprobó sin CAE/vencimiento', {
          outcome: cae.outcome,
        });
      }
      // Incrementa el número SOLO ahora (AFIP autorizó → correlatividad OK).
      await tx
        .update(invoice_sequences)
        .set({ next_number: invoiceNumber + 1, updated_at: now() })
        .where(eq(invoice_sequences.id, seq.id));

      // Snapshot inmutable (solo en éxito).
      await tx.insert(fiscal_snapshots).values({
        tenant_id: tenantId,
        sale_id: saleId,
        calculation_engine_version: CALCULATION_ENGINE_VERSION,
        tax_policy_version: TAX_POLICY_VERSION,
        rounding_mode: 'HALF_EVEN',
        rounding_stage: MONEY_POLICY.rounding_stage,
        iva_rates_applied: totals.iva_breakdown,
        currency_code: 'ARS',
        jurisdiction_context: {
          merchant_jurisdiction_province: company.merchant_jurisdiction_province,
          merchant_special_regime: company.merchant_special_regime,
        },
        fiscal_breakdown: {
          ImpNeto: det.ImpNeto,
          ImpOpEx: det.ImpOpEx,
          ImpIVA: det.ImpIVA,
          ImpTotal: det.ImpTotal,
          Iva: det.Iva ?? [],
        },
        wsfe_version: 'WSFEv1',
        wsfe_request_payload: det,
        wsfe_response_raw: { raw: cae.raw, observaciones: cae.observaciones },
        sale_point: ptoVta,
        invoice_type: invoiceType,
        invoice_number: invoiceNumber,
        cae: cae.cae,
        cae_expiry_date: afipDateToIso(cae.caeVto),
      });

      assertFiscalTransition('requesting', 'issued');
      await tx
        .update(sales)
        .set({ fiscal_status: 'issued', updated_at: now() })
        .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, saleId)));

      await writeAuditLog(
        {
          event_name: 'fiscal.invoice.cae_received',
          payload: {
            sale_id: saleId,
            invoice_type: invoiceType,
            invoice_number: invoiceNumber,
            cae: cae.cae,
            cae_vto: cae.caeVto,
            observed: cae.outcome === 'observed',
            observaciones: cae.observaciones,
          },
          pii_level: 'internal',
          severity: 'info',
        },
        tx
      );

      return {
        outcome: 'issued',
        fiscal_status: 'issued',
        invoice_type: invoiceType,
        invoice_number: invoiceNumber,
        cae: cae.cae,
        cae_vto: cae.caeVto,
        observaciones: cae.observaciones,
      };
    }

    // rejected | error → NO incrementa (número reusable) → manual_resolution_required.
    assertFiscalTransition('requesting', 'failed');
    assertFiscalTransition('failed', 'manual_resolution_required');
    await tx
      .update(sales)
      .set({ fiscal_status: 'manual_resolution_required', updated_at: now() })
      .where(and(eq(sales.tenant_id, tenantId), eq(sales.id, saleId)));

    await writeAuditLog(
      {
        event_name: 'fiscal.invoice.cae_rejected',
        payload: {
          sale_id: saleId,
          invoice_type: invoiceType,
          attempted_number: invoiceNumber,
          outcome: cae.outcome,
          errors: cae.errors,
          observaciones: cae.observaciones,
        },
        pii_level: 'internal',
        severity: 'error',
      },
      tx
    );

    return {
      outcome: 'rejected',
      fiscal_status: 'manual_resolution_required',
      invoice_type: invoiceType,
      errors: cae.errors,
      observaciones: cae.observaciones,
    };
  });

  logger.info(
    {
      sale_id: saleId,
      outcome: result.outcome,
      fiscal_status: result.fiscal_status,
      invoice_type: result.invoice_type,
      invoice_number: result.invoice_number,
    },
    'fiscal.emit_invoice'
  );

  return result;
}
