/**
 * Money display formatting — locale es-AR.
 * CLAUDE.md §9: presentation con Intl.NumberFormat.
 * Reemplaza el fmt$ del JSX de Claude Design.
 */
import Decimal from 'decimal.js';
import { money, type MoneyInput } from './decimal.js';

const ARS_WITH_DECIMALS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ARS_NO_DECIMALS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const NUMBER_AR = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const NUMBER_AR_INT = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export interface FormatARSOptions {
  decimals?: boolean;
  emptyDash?: boolean;
}

export function formatARS(
  amount: MoneyInput | null | undefined,
  options: FormatARSOptions = {}
): string {
  const { decimals = true, emptyDash = true } = options;

  if (amount === null || amount === undefined) {
    return emptyDash ? '—' : '';
  }

  let value: number;
  try {
    value = money(amount).toNumber();
  } catch {
    return emptyDash ? '—' : '';
  }

  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return emptyDash ? '—' : '';
  }

  return decimals ? ARS_WITH_DECIMALS.format(value) : ARS_NO_DECIMALS.format(value);
}

export function formatNumber(
  value: number | Decimal | null | undefined,
  options: { decimals?: boolean } = {}
): string {
  const { decimals = false } = options;
  if (value === null || value === undefined) return '—';

  const n = value instanceof Decimal ? value.toNumber() : value;
  if (Number.isNaN(n) || !Number.isFinite(n)) return '—';

  return decimals ? NUMBER_AR.format(n) : NUMBER_AR_INT.format(n);
}

export function formatPercent(
  value: number | Decimal | null | undefined,
  decimals = 1
): string {
  if (value === null || value === undefined) return '—';

  const n = value instanceof Decimal ? value.toNumber() : value;
  if (Number.isNaN(n) || !Number.isFinite(n)) return '—';

  return new Intl.NumberFormat('es-AR', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n / 100);
}
