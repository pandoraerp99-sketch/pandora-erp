/**
 * Fiscal Projection Layer — WSFEv1 (ADR-0022).
 *
 * ÚNICO módulo que conoce el shape del payload FECAESolicitar de WSFEv1.
 * El resto del sistema NO conoce este shape. Cambio de WS = solo nuevo archivo
 * en projection/.
 *
 *   SaleTotalsCalculated (calculation.ts) + emisor + receptor
 *      → projectToWSFEv1(...) → FECAEDetRequest (una factura)
 *
 * Función PURA: sin DB, sin HTTP, sin logs. Testeable con vectores.
 *
 * Invariantes que garantiza (fail-closed si se violan):
 *   1. ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpIVA + ImpTrib   (tol 0)
 *   2. ImpIVA   = Σ Iva[].Importe                                     (tol 0)
 *   3. Tipo C: sin Iva[], ImpIVA = 0, ImpOpEx = 0 (Manual v4.5)
 *
 * Montos hacia AFIP: 2 decimales (formato wire WSFEv1), HALF_EVEN.
 */
import type { SaleTotalsCalculated } from '../../domain/calculation.js';
import {
  money,
  moneyRound,
  moneySum,
  type MoneyInput,
} from '../../money/decimal.js';
import { FiscalIntegrityError } from '../../multi_tenant/errors.js';
import {
  CBTE_TIPO_BY_INVOICE_TYPE,
  CONCEPTO,
  MON_COTIZ_PESOS,
  MONEDA,
  ivaIdForRate,
} from '../afip-codes.js';
import type { InvoiceType } from '../invoice-type.js';

export interface Wsfev1IvaAliquot {
  Id: number;
  BaseImp: string;
  Importe: string;
}

/** FECAEDetRequest de WSFEv1 (una factura dentro de FECAESolicitar). */
export interface Wsfev1DetRequest {
  Concepto: number;
  DocTipo: number;
  DocNro: number;
  CbteDesde: number;
  CbteHasta: number;
  CbteFch: string;
  ImpTotal: string;
  ImpTotConc: string;
  ImpNeto: string;
  ImpOpEx: string;
  ImpIVA: string;
  ImpTrib: string;
  MonId: string;
  MonCotiz: string;
  CondicionIVAReceptorId?: number;
  Iva?: Wsfev1IvaAliquot[];
}

export interface Wsfev1ProjectionInput {
  totals: SaleTotalsCalculated;
  invoice_type: InvoiceType;
  sale_point: number;
  invoice_number: number;
  /** Fecha del comprobante en formato AFIP YYYYMMDD. */
  cbte_fecha: string;
  receptor: {
    doc_tipo: number;
    doc_nro: string;
    /** Opcional al 2026-07-10 (Manual v4.5). CF cash → omitir o código 5. */
    condicion_iva_id?: number | null;
  };
}

/** Monto en formato wire AFIP: 2 decimales, HALF_EVEN. */
function afip(value: MoneyInput): string {
  return moneyRound(value, 2).toFixed(2);
}

const ZERO = '0.00';

export function projectToWSFEv1(input: Wsfev1ProjectionInput): Wsfev1DetRequest {
  const { totals, invoice_type, sale_point, invoice_number, cbte_fecha, receptor } = input;

  if (!Number.isInteger(sale_point) || sale_point <= 0) {
    throw new FiscalIntegrityError('sale_point inválido', { sale_point });
  }
  if (!Number.isInteger(invoice_number) || invoice_number <= 0) {
    throw new FiscalIntegrityError('invoice_number inválido', { invoice_number });
  }
  if (!/^\d{8}$/.test(cbte_fecha)) {
    throw new FiscalIntegrityError('cbte_fecha debe ser YYYYMMDD', { cbte_fecha });
  }

  const cbteTipo = CBTE_TIPO_BY_INVOICE_TYPE[invoice_type];

  const base: Omit<
    Wsfev1DetRequest,
    'ImpTotal' | 'ImpNeto' | 'ImpOpEx' | 'ImpIVA' | 'Iva'
  > = {
    Concepto: CONCEPTO.PRODUCTOS,
    DocTipo: receptor.doc_tipo,
    DocNro: Number(receptor.doc_nro),
    CbteDesde: invoice_number,
    CbteHasta: invoice_number,
    CbteFch: cbte_fecha,
    ImpTotConc: ZERO,
    ImpTrib: ZERO,
    MonId: MONEDA.PESOS,
    MonCotiz: MON_COTIZ_PESOS,
  };

  if (receptor.condicion_iva_id != null) {
    base.CondicionIVAReceptorId = receptor.condicion_iva_id;
  }

  let det: Wsfev1DetRequest;

  if (invoice_type === 'C') {
    // Tipo C (Monotributo): no discrimina IVA. Todo el importe va a ImpNeto.
    // ImpOpEx debe ser 0 (Manual v4.5). La exención Ley 19.640 se expresa por
    // leyenda, NO por ImpOpEx (decisión A-25).
    const impNeto = afip(totals.total);
    det = {
      ...base,
      CbteDesde: invoice_number,
      ImpNeto: impNeto,
      ImpOpEx: ZERO,
      ImpIVA: ZERO,
      ImpTotal: impNeto,
    };
  } else {
    // Tipo A / B: neto gravado + IVA discriminado + exento (ImpOpEx).
    const impOpEx = afip(totals.exempt_amount);

    const iva: Wsfev1IvaAliquot[] = totals.iva_breakdown.map((entry) => ({
      Id: ivaIdForRate(entry.rate),
      BaseImp: afip(entry.base),
      Importe: afip(entry.importe),
    }));

    // ImpNeto = Σ Iva[].BaseImp — NO round2(subtotal − exento). AFIP valida
    // ImpNeto == Σ BaseImp; con ≥2 alícuotas, round2(Σ base) puede diferir de
    // Σ round2(base_i) en un centavo → rechazo. Espejamos ImpIVA = Σ Importe.
    const impNeto = afip(moneySum(iva.map((i) => i.BaseImp)));
    // ImpIVA = Σ Iva[].Importe (por construcción, garantiza invariante 2).
    const impIva = afip(moneySum(iva.map((i) => i.Importe)));

    // ImpTotal = suma de componentes (2dp) → invariante 1 exacta.
    const impTotal = afip(
      moneySum([base.ImpTotConc, impNeto, impOpEx, impIva, base.ImpTrib])
    );

    det = {
      ...base,
      ImpNeto: impNeto,
      ImpOpEx: impOpEx,
      ImpIVA: impIva,
      ImpTotal: impTotal,
      ...(iva.length > 0 ? { Iva: iva } : {}),
    };
  }

  assertWsfev1Invariants(det, totals, cbteTipo);
  return det;
}

function assertWsfev1Invariants(
  det: Wsfev1DetRequest,
  totals: SaleTotalsCalculated,
  cbteTipo: number
): void {
  // Invariante 1: ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpIVA + ImpTrib
  const componentsSum = moneySum([
    det.ImpTotConc,
    det.ImpNeto,
    det.ImpOpEx,
    det.ImpIVA,
    det.ImpTrib,
  ]);
  if (!componentsSum.eq(money(det.ImpTotal))) {
    throw new FiscalIntegrityError(
      'Invariante WSFEv1 violada: ImpTotal != Σ componentes',
      { impTotal: det.ImpTotal, componentsSum: componentsSum.toString(), cbteTipo }
    );
  }

  // Invariante 2: ImpIVA = Σ Iva[].Importe
  const ivaSum = moneySum((det.Iva ?? []).map((i) => i.Importe));
  if (!ivaSum.eq(money(det.ImpIVA))) {
    throw new FiscalIntegrityError(
      'Invariante WSFEv1 violada: ImpIVA != Σ Iva[].Importe',
      { impIva: det.ImpIVA, ivaSum: ivaSum.toString() }
    );
  }

  // Invariante 2b: ImpNeto = Σ Iva[].BaseImp (AFIP lo valida en A/B; en Tipo C
  // no hay Iva[] y ImpNeto = ImpTotal, por eso se saltea).
  if (det.Iva && det.Iva.length > 0) {
    const baseSum = moneySum(det.Iva.map((i) => i.BaseImp));
    if (!baseSum.eq(money(det.ImpNeto))) {
      throw new FiscalIntegrityError(
        'Invariante WSFEv1 violada: ImpNeto != Σ Iva[].BaseImp',
        { impNeto: det.ImpNeto, baseSum: baseSum.toString() }
      );
    }
  }

  // Invariante 3: Tipo C → sin Iva[], ImpIVA = 0, ImpOpEx = 0.
  if (cbteTipo === CBTE_TIPO_BY_INVOICE_TYPE.C) {
    if (det.Iva !== undefined) {
      throw new FiscalIntegrityError('Tipo C no debe informar array Iva[]', {});
    }
    if (!money(det.ImpIVA).isZero() || !money(det.ImpOpEx).isZero()) {
      throw new FiscalIntegrityError(
        'Tipo C debe tener ImpIVA = 0 y ImpOpEx = 0 (Manual v4.5)',
        { impIva: det.ImpIVA, impOpEx: det.ImpOpEx }
      );
    }
  }

  // Sanity: el ImpTotal proyectado no debe alejarse del total comercial más allá
  // de la tolerancia de redondeo a 2 decimales. Cada componente redondeado aporta
  // hasta ~medio centavo; con N alícuotas + exento la deriva legítima llega a
  // ~(N+1) centavos. Más que eso = bug, no redondeo. (AFIP igual es autoridad del
  // ImpTotal; esto solo caza discrepancias groseras vs lo cobrado.)
  const bracketCount = det.Iva?.length ?? 0;
  const maxGap = money('0.01').times(bracketCount + 1);
  const commercialTotal = moneyRound(totals.total, 2);
  const gap = commercialTotal.minus(money(det.ImpTotal)).abs();
  if (gap.gt(maxGap)) {
    throw new FiscalIntegrityError(
      'ImpTotal proyectado difiere del total comercial más allá de la tolerancia de redondeo',
      {
        impTotal: det.ImpTotal,
        commercialTotal: commercialTotal.toFixed(2),
        gap: gap.toString(),
        maxGap: maxGap.toString(),
      }
    );
  }
}
