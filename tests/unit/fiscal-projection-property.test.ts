import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  calculateSaleTotals,
  type SaleItemInput,
} from '@/lib/domain/calculation';
import { projectToWSFEv1 } from '@/lib/fiscal/projection/wsfev1';
import { money, moneySum } from '@/lib/money/decimal';

/**
 * Property tests de la proyección WSFEv1 (HIGH-1).
 *
 * El test de ejemplo (fiscal-projection-wsfev1.test.ts) prueba UN caso de
 * redondeo multi-bracket. Acá demostramos las invariantes cross-field que AFIP
 * valida (tol 0) sobre canastas ALEATORIAS — que es donde vivía el bug
 * `ImpNeto = round2(Σ base)` vs `Σ round2(BaseImp)`:
 *
 *   1.  ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpIVA + ImpTrib
 *   2.  ImpIVA   = Σ Iva[].Importe
 *   2b. ImpNeto  = Σ Iva[].BaseImp                (A/B)
 *   3.  Tipo C   → sin Iva[], ImpIVA = 0, ImpOpEx = 0, ImpTotal = ImpNeto
 *
 * Precios con hasta 3 decimales generan bases con sub-centavos: exactamente el
 * borde que dispara la divergencia de redondeo entre ≥2 alícuotas. Si alguna
 * invariante se rompe, `projectToWSFEv1` lanza FiscalIntegrityError → el test
 * falla mostrando el contraejemplo que fast-check shrinkea al mínimo.
 */

const KNOWN_RATES = ['0', '2.5', '5', '10.5', '21', '27'] as const;

const itemArb = fc
  .record({
    tax_rate: fc.constantFrom(...KNOWN_RATES),
    // 1..9_999_999 milésimos → precio "0.001".."9999.999" (sub-centavos).
    unitPriceMilli: fc.integer({ min: 1, max: 9_999_999 }),
    quantity: fc.integer({ min: 1, max: 25 }),
    tdf_exempt: fc.boolean(),
  })
  .map(
    ({ tax_rate, unitPriceMilli, quantity, tdf_exempt }, ): SaleItemInput => ({
      product_id: 'p',
      product_name_snapshot: 'prod',
      unit_type: 'unidad',
      unit_price: (unitPriceMilli / 1000).toFixed(3),
      quantity: String(quantity),
      tax_rate,
      tdf_exempt,
    })
  );

const basketArb = fc.array(itemArb, { minLength: 1, maxLength: 8 });

const baseInput = (invoice_type: 'A' | 'B' | 'C') =>
  ({
    invoice_type,
    sale_point: 1,
    invoice_number: 1,
    cbte_fecha: '20260101',
    receptor: { doc_tipo: 99, doc_nro: '0' },
  }) as const;

const RUNS = { numRuns: 500 } as const;

describe('projectToWSFEv1 — property tests (invariantes AFIP)', () => {
  it('A/B: ImpTotal = Σ componentes, ImpIVA = Σ Importe, ImpNeto = Σ BaseImp', () => {
    fc.assert(
      fc.property(
        basketArb,
        fc.constantFrom('A', 'B') as fc.Arbitrary<'A' | 'B'>,
        (items, invoiceType) => {
          const totals = calculateSaleTotals(items);
          // No lanza ⇒ las 3 invariantes internas se cumplen para esta canasta.
          const det = projectToWSFEv1({ ...baseInput(invoiceType), totals });

          const componentes = moneySum([
            det.ImpTotConc,
            det.ImpNeto,
            det.ImpOpEx,
            det.ImpIVA,
            det.ImpTrib,
          ]);
          expect(componentes.eq(money(det.ImpTotal))).toBe(true);

          const iva = det.Iva ?? [];
          expect(moneySum(iva.map((i) => i.Importe)).eq(money(det.ImpIVA))).toBe(true);
          expect(moneySum(iva.map((i) => i.BaseImp)).eq(money(det.ImpNeto))).toBe(true);
        }
      ),
      RUNS
    );
  });

  it('C: sin Iva[], ImpIVA = 0, ImpOpEx = 0, ImpTotal = ImpNeto', () => {
    fc.assert(
      fc.property(basketArb, (items) => {
        const totals = calculateSaleTotals(items);
        const det = projectToWSFEv1({ ...baseInput('C'), totals });

        expect(det.Iva).toBeUndefined();
        expect(money(det.ImpIVA).isZero()).toBe(true);
        expect(money(det.ImpOpEx).isZero()).toBe(true);
        expect(money(det.ImpTotal).eq(money(det.ImpNeto))).toBe(true);
      }),
      RUNS
    );
  });

  it('nunca lanza para una canasta válida (todas las invariantes se sostienen)', () => {
    fc.assert(
      fc.property(
        basketArb,
        fc.constantFrom('A', 'B', 'C') as fc.Arbitrary<'A' | 'B' | 'C'>,
        (items, invoiceType) => {
          const totals = calculateSaleTotals(items);
          expect(() =>
            projectToWSFEv1({ ...baseInput(invoiceType), totals })
          ).not.toThrow();
        }
      ),
      RUNS
    );
  });
});
