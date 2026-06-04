/**
 * Money helpers con Decimal.js.
 * CLAUDE.md §9 + ADR-0005.
 *
 * Reglas:
 * - NUNCA Number JS en path money
 * - NUNCA == o === entre Decimal (usar .eq, .lt, .gt)
 * - Modo HALF_EVEN configurado globalmente al cargar este modulo
 * - Storage: string serialized con toFixed(4) para wire format
 * - Display: Intl.NumberFormat es-AR
 */
import Decimal from 'decimal.js';
import { MoneyError } from '../multi_tenant/errors.js';
import { MONEY_POLICY } from './policy.js';

Decimal.set({
  rounding: Decimal.ROUND_HALF_EVEN,
  precision: 30,
  toExpNeg: -15,
  toExpPos: 25,
});

const MAX_MONEY_VALUE = new Decimal('9999999999999999.9999');
const MIN_MONEY_VALUE = new Decimal('-9999999999999999.9999');

export type MoneyInput = string | number | Decimal;

export function money(input: MoneyInput): Decimal {
  if (input instanceof Decimal) {
    return input;
  }

  if (typeof input === 'number') {
    if (Number.isNaN(input)) {
      throw new MoneyError('Money no puede ser NaN');
    }
    if (!Number.isFinite(input)) {
      throw new MoneyError('Money no puede ser Infinity');
    }
  }

  let d: Decimal;
  try {
    d = new Decimal(input);
  } catch (err) {
    throw new MoneyError(`Money input invalido: ${String(input)}`, {
      cause: String(err),
    });
  }

  if (d.isNaN()) {
    throw new MoneyError(`Money input parseo a NaN: ${String(input)}`);
  }

  if (d.gt(MAX_MONEY_VALUE) || d.lt(MIN_MONEY_VALUE)) {
    throw new MoneyError(`Money fuera de rango permitido: ${d.toString()}`);
  }

  return d;
}

export function moneyZero(): Decimal {
  return new Decimal(0);
}

export function moneyAdd(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).plus(money(b));
}

export function moneySubtract(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).minus(money(b));
}

export function moneyMultiply(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).times(money(b));
}

export function moneyDivide(a: MoneyInput, b: MoneyInput): Decimal {
  const divisor = money(b);
  if (divisor.isZero()) {
    throw new MoneyError('Division por cero en money');
  }
  return money(a).dividedBy(divisor);
}

export function moneyRound(value: MoneyInput, decimals = 2): Decimal {
  return money(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN);
}

export function moneyEq(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).eq(money(b));
}

export function moneyLt(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).lt(money(b));
}

export function moneyLte(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).lte(money(b));
}

export function moneyGt(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).gt(money(b));
}

export function moneyGte(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).gte(money(b));
}

export function moneyIsZero(value: MoneyInput): boolean {
  return money(value).isZero();
}

export function moneyToStorage(value: MoneyInput): string {
  return money(value).toFixed(MONEY_POLICY.storage_scale);
}

export function moneyToWire(value: MoneyInput): string {
  return money(value).toFixed(MONEY_POLICY.storage_scale);
}

export function moneyToNumberLossy(value: MoneyInput): number {
  const num = money(value).toNumber();
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new MoneyError('Money to number perdio precision');
  }
  return num;
}

export function moneySum(values: ReadonlyArray<MoneyInput>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

export const TOLERANCE_RECONCILIATION = money('0.50');

export function withinTolerance(
  expected: MoneyInput,
  actual: MoneyInput,
  tolerance: MoneyInput = TOLERANCE_RECONCILIATION
): boolean {
  return money(expected).minus(money(actual)).abs().lte(money(tolerance));
}
