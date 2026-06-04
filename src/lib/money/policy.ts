/**
 * Money policy canonica para Pandora.
 * ADR-0005 cerrado: HALF_EVEN modo redondeo + numeric(19,4) storage.
 * ADR-0021: cliente recibe policy via Context, NO lee env directo.
 *
 * Lee desde env validado por Zod (src/lib/env.ts).
 */
import { env } from '../env.js';

export interface MoneyPolicy {
  readonly rounding_mode: 'HALF_EVEN';
  readonly rounding_stage: 'PER_LINE' | 'PER_TAX_BRACKET';
  readonly currency: 'ARS';
  readonly storage_precision: 19;
  readonly storage_scale: 4;
  readonly display_decimals: 2;
}

export const MONEY_POLICY: MoneyPolicy = {
  rounding_mode: env.MONEY_ROUNDING_MODE,
  rounding_stage: env.MONEY_ROUNDING_STAGE,
  currency: env.MONEY_CURRENCY,
  storage_precision: 19,
  storage_scale: 4,
  display_decimals: 2,
};

export function getMoneyPolicy(): MoneyPolicy {
  return MONEY_POLICY;
}
