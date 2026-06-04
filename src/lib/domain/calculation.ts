/**
 * Calculation engine — domain logic puro.
 *
 * REGLA: este archivo NO tiene side effects (no DB, no HTTP, no logs).
 * Solo recibe inputs y devuelve outputs. Testeable con vectores.
 *
 * ADR-0005 (HALF_EVEN + numeric(19,4)) + ADR-0022 (Fiscal Projection).
 * MONEY-POLICY.md.
 *
 * Reproducibilidad historica: el engine tiene una version (CALCULATION_ENGINE_VERSION)
 * que se persiste en fiscal_snapshots para reconstruir el calculo anos despues.
 */
import Decimal from 'decimal.js';
import {
  money,
  moneyAdd,
  moneyMultiply,
  moneyRound,
  moneySum,
  moneyToStorage,
  type MoneyInput,
} from '../money/decimal.js';
import { MONEY_POLICY } from '../money/policy.js';
import { FiscalIntegrityError } from '../multi_tenant/errors.js';
import type { UnitType } from '../db/schema/products.js';

export const CALCULATION_ENGINE_VERSION = '1.0.0';
export const TAX_POLICY_VERSION = '2026-05-30';

/**
 * Unit types que NO admiten cantidades fraccionarias.
 * Una venta de "0.5 caramelos" no tiene sentido fisico.
 * Mientras que metros, kg, gramos, litros si admiten decimales.
 */
const INTEGER_QUANTITY_UNIT_TYPES: ReadonlySet<UnitType> = new Set([
  'unidad',
  'docena',
]);

export interface SaleItemInput {
  product_id: string;
  product_name_snapshot: string;
  product_sku_snapshot?: string | null;
  /**
   * Tipo de unidad del producto. Cuando es 'unidad' o 'docena',
   * la cantidad DEBE ser entera (sin decimales).
   * Default: 'unidad' (mas restrictivo) para evitar cantidades fraccionarias
   * accidentales si el caller olvida pasar el campo.
   */
  unit_type?: UnitType;
  unit_price: MoneyInput;
  quantity: MoneyInput;
  tax_rate: MoneyInput;
  tdf_exempt: boolean;
}

export interface SaleItemCalculated {
  product_id: string;
  product_name_snapshot: string;
  product_sku_snapshot: string | null;
  unit_price: string;
  quantity: string;
  tax_rate: string;
  tdf_exempt: boolean;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
}

export interface SaleTotalsCalculated {
  items: ReadonlyArray<SaleItemCalculated>;
  subtotal: string;
  tax_amount: string;
  exempt_amount: string;
  total: string;
  iva_breakdown: ReadonlyArray<IvaBreakdownEntry>;
  calculation_engine_version: string;
  tax_policy_version: string;
  rounding_mode: 'HALF_EVEN';
  rounding_stage: 'PER_LINE' | 'PER_TAX_BRACKET';
}

export interface IvaBreakdownEntry {
  rate: string;
  base: string;
  importe: string;
}

export function calculateLine(item: SaleItemInput): SaleItemCalculated {
  const unitPrice = money(item.unit_price);
  const quantity = money(item.quantity);
  const taxRate = money(item.tax_rate);
  const unitType: UnitType = item.unit_type ?? 'unidad';

  if (quantity.lte(0)) {
    throw new FiscalIntegrityError('Cantidad debe ser mayor a cero', {
      product_id: item.product_id,
      quantity: quantity.toString(),
    });
  }

  if (INTEGER_QUANTITY_UNIT_TYPES.has(unitType) && !quantity.isInteger()) {
    throw new FiscalIntegrityError(
      `Cantidad debe ser entera para unit_type '${unitType}' (no se venden fracciones)`,
      {
        product_id: item.product_id,
        product_name: item.product_name_snapshot,
        unit_type: unitType,
        quantity: quantity.toString(),
      }
    );
  }

  if (unitPrice.lt(0)) {
    throw new FiscalIntegrityError('Precio unitario no puede ser negativo', {
      product_id: item.product_id,
      unit_price: unitPrice.toString(),
    });
  }

  if (taxRate.lt(0) || taxRate.gt(100)) {
    throw new FiscalIntegrityError('Alicuota IVA fuera de rango [0,100]', {
      product_id: item.product_id,
      tax_rate: taxRate.toString(),
    });
  }

  const lineSubtotal = moneyMultiply(unitPrice, quantity);
  const lineSubtotalRounded = moneyRound(lineSubtotal, 4);

  let lineTax: Decimal;
  if (item.tdf_exempt) {
    lineTax = new Decimal(0);
  } else {
    const taxFraction = taxRate.dividedBy(100);
    const rawTax = lineSubtotalRounded.times(taxFraction);
    lineTax =
      MONEY_POLICY.rounding_stage === 'PER_LINE'
        ? moneyRound(rawTax, 2)
        : moneyRound(rawTax, 4);
  }

  const lineTotal = moneyAdd(lineSubtotalRounded, lineTax);

  return {
    product_id: item.product_id,
    product_name_snapshot: item.product_name_snapshot,
    product_sku_snapshot: item.product_sku_snapshot ?? null,
    unit_price: moneyToStorage(unitPrice),
    quantity: moneyToStorage(quantity),
    tax_rate: taxRate.toFixed(2),
    tdf_exempt: item.tdf_exempt,
    line_subtotal: moneyToStorage(lineSubtotalRounded),
    line_tax: moneyToStorage(lineTax),
    line_total: moneyToStorage(lineTotal),
  };
}

export function calculateSaleTotals(
  items: ReadonlyArray<SaleItemInput>
): SaleTotalsCalculated {
  if (items.length === 0) {
    throw new FiscalIntegrityError('La venta no tiene items');
  }

  const calculated = items.map(calculateLine);

  const exemptAmount = moneySum(
    calculated.filter((c) => c.tdf_exempt).map((c) => c.line_subtotal)
  );

  const taxableSubtotal = moneySum(
    calculated.filter((c) => !c.tdf_exempt).map((c) => c.line_subtotal)
  );

  const subtotal = moneyAdd(exemptAmount, taxableSubtotal);

  const taxAmount =
    MONEY_POLICY.rounding_stage === 'PER_LINE'
      ? moneySum(calculated.map((c) => c.line_tax))
      : computePerBracketTax(calculated);

  const total = moneyAdd(subtotal, taxAmount);

  const ivaBreakdown = buildIvaBreakdown(calculated);

  return {
    items: calculated,
    subtotal: moneyToStorage(subtotal),
    tax_amount: moneyToStorage(taxAmount),
    exempt_amount: moneyToStorage(exemptAmount),
    total: moneyToStorage(total),
    iva_breakdown: ivaBreakdown,
    calculation_engine_version: CALCULATION_ENGINE_VERSION,
    tax_policy_version: TAX_POLICY_VERSION,
    rounding_mode: 'HALF_EVEN',
    rounding_stage: MONEY_POLICY.rounding_stage,
  };
}

function computePerBracketTax(items: ReadonlyArray<SaleItemCalculated>): Decimal {
  const buckets = new Map<string, Decimal>();
  for (const item of items) {
    if (item.tdf_exempt) continue;
    const rate = item.tax_rate;
    const current = buckets.get(rate) ?? new Decimal(0);
    buckets.set(rate, current.plus(money(item.line_subtotal)));
  }

  let total = new Decimal(0);
  for (const [rate, base] of buckets) {
    const taxFraction = money(rate).dividedBy(100);
    const bucketTax = moneyRound(base.times(taxFraction), 2);
    total = total.plus(bucketTax);
  }
  return total;
}

function buildIvaBreakdown(
  items: ReadonlyArray<SaleItemCalculated>
): ReadonlyArray<IvaBreakdownEntry> {
  const buckets = new Map<string, { base: Decimal; importe: Decimal }>();

  for (const item of items) {
    if (item.tdf_exempt) continue;
    const rate = item.tax_rate;
    const entry = buckets.get(rate) ?? { base: new Decimal(0), importe: new Decimal(0) };
    entry.base = entry.base.plus(money(item.line_subtotal));
    entry.importe = entry.importe.plus(money(item.line_tax));
    buckets.set(rate, entry);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([rate, { base, importe }]) => ({
      rate,
      base: moneyToStorage(base),
      importe: moneyToStorage(importe),
    }));
}

export function validateFiscalInvariant(totals: SaleTotalsCalculated): void {
  const breakdownSum = moneySum(totals.iva_breakdown.map((e) => e.importe));
  const taxAmount = money(totals.tax_amount);

  if (!breakdownSum.eq(taxAmount)) {
    throw new FiscalIntegrityError(
      'Invariante fiscal violada: sum(Iva[].Importe) != ImpIVA. ' +
        'Esto bloquearia el envio a WSFEv1.',
      {
        breakdown_sum: breakdownSum.toString(),
        tax_amount: taxAmount.toString(),
        difference: breakdownSum.minus(taxAmount).toString(),
      }
    );
  }

  const subtotalPlusTax = moneyAdd(totals.subtotal, totals.tax_amount);
  const total = money(totals.total);

  if (!subtotalPlusTax.eq(total)) {
    throw new FiscalIntegrityError(
      'Invariante fiscal violada: subtotal + tax_amount != total',
      {
        subtotal: totals.subtotal,
        tax_amount: totals.tax_amount,
        expected_total: subtotalPlusTax.toString(),
        actual_total: totals.total,
      }
    );
  }
}
