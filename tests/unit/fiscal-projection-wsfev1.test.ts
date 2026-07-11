import { describe, expect, it } from 'vitest';
import { calculateSaleTotals, type SaleItemInput } from '@/lib/domain/calculation';
import {
  projectToWSFEv1,
  type Wsfev1ProjectionInput,
} from '@/lib/fiscal/projection/wsfev1';
import { CONDICION_IVA_RECEPTOR, DOC_TIPO } from '@/lib/fiscal/afip-codes';
import type { InvoiceType } from '@/lib/fiscal/invoice-type';

const item = (overrides: Partial<SaleItemInput> = {}): SaleItemInput => ({
  product_id: 'p1',
  product_name_snapshot: 'Producto',
  unit_price: '1000.00',
  quantity: '1',
  tax_rate: '21',
  tdf_exempt: false,
  ...overrides,
});

function project(
  items: SaleItemInput[],
  invoice_type: InvoiceType,
  receptor: Wsfev1ProjectionInput['receptor']
) {
  const totals = calculateSaleTotals(items);
  return projectToWSFEv1({
    totals,
    invoice_type,
    sale_point: 2,
    invoice_number: 1,
    cbte_fecha: '20260710',
    receptor,
  });
}

const CF = { doc_tipo: DOC_TIPO.CONSUMIDOR_FINAL, doc_nro: '0' } as const;

describe('projectToWSFEv1 — Tipo B (RI a consumidor final)', () => {
  it('venta gravada 21%: ImpNeto/ImpIVA/ImpTotal + Iva[] correctos', () => {
    const det = project([item()], 'B', {
      ...CF,
      condicion_iva_id: CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
    });

    expect(det.ImpNeto).toBe('1000.00');
    expect(det.ImpIVA).toBe('210.00');
    expect(det.ImpOpEx).toBe('0.00');
    expect(det.ImpTotal).toBe('1210.00');
    expect(det.DocTipo).toBe(99);
    expect(det.DocNro).toBe(0);
    expect(det.CondicionIVAReceptorId).toBe(5);
    expect(det.Iva).toEqual([{ Id: 5, BaseImp: '1000.00', Importe: '210.00' }]);
  });

  it('venta EXENTA Ley 19.640: todo a ImpOpEx, sin Iva[]', () => {
    const det = project([item({ tdf_exempt: true })], 'B', CF);

    expect(det.ImpNeto).toBe('0.00');
    expect(det.ImpOpEx).toBe('1000.00');
    expect(det.ImpIVA).toBe('0.00');
    expect(det.ImpTotal).toBe('1000.00');
    expect(det.Iva).toBeUndefined();
    expect(det.CondicionIVAReceptorId).toBeUndefined(); // omitido (opcional v4.5)
  });

  it('venta MIXTA (gravado + exento): ImpNeto y ImpOpEx separados', () => {
    const det = project(
      [item(), item({ product_id: 'p2', tdf_exempt: true, unit_price: '500.00' })],
      'B',
      CF
    );

    expect(det.ImpNeto).toBe('1000.00');
    expect(det.ImpOpEx).toBe('500.00');
    expect(det.ImpIVA).toBe('210.00');
    expect(det.ImpTotal).toBe('1710.00');
    expect(det.Iva).toEqual([{ Id: 5, BaseImp: '1000.00', Importe: '210.00' }]);
  });
});

describe('projectToWSFEv1 — Tipo A multi-alícuota', () => {
  it('21% + 10.5%: dos entradas Iva[], ImpIVA = suma', () => {
    const det = project(
      [item({ tax_rate: '21' }), item({ product_id: 'p2', tax_rate: '10.5' })],
      'A',
      { doc_tipo: DOC_TIPO.CUIT, doc_nro: '30111111118', condicion_iva_id: 1 }
    );

    expect(det.ImpNeto).toBe('2000.00');
    expect(det.ImpIVA).toBe('315.00'); // 210 + 105
    expect(det.ImpTotal).toBe('2315.00');
    expect(det.Iva).toEqual([
      { Id: 4, BaseImp: '1000.00', Importe: '105.00' }, // 10.5% ordenado primero
      { Id: 5, BaseImp: '1000.00', Importe: '210.00' },
    ]);
  });

  // Regresión HIGH-1 (auditoría externa 2026-07-10): con bases de centavos
  // fraccionarios y ≥2 alícuotas, ImpNeto debe ser Σ round2(BaseImp), NO
  // round2(Σ base). AFIP valida ImpNeto == Σ BaseImp (rechaza si difieren).
  it('bases con centavos: ImpNeto = Σ BaseImp (no round2 del subtotal)', () => {
    const det = project(
      [
        item({ unit_price: '10.333', tax_rate: '21' }),
        item({ product_id: 'p2', unit_price: '20.334', tax_rate: '10.5' }),
      ],
      'A',
      { doc_tipo: DOC_TIPO.CUIT, doc_nro: '30111111118', condicion_iva_id: 1 }
    );

    // Σ BaseImp = 20.33 + 10.33 = 30.66 (el bug daba round2(30.667) = 30.67).
    expect(det.ImpNeto).toBe('30.66');
    expect(det.Iva).toEqual([
      { Id: 4, BaseImp: '20.33', Importe: '2.14' },
      { Id: 5, BaseImp: '10.33', Importe: '2.17' },
    ]);
    // La invariante ImpNeto == Σ BaseImp se cumple (projectToWSFEv1 la asserta).
    const baseSum = det.Iva!.reduce((s, i) => s + Number(i.BaseImp), 0);
    expect(Number(det.ImpNeto)).toBeCloseTo(baseSum, 2);
  });
});

describe('projectToWSFEv1 — Tipo C (Monotributo)', () => {
  it('sin Iva[], ImpNeto = total, ImpIVA = 0, ImpOpEx = 0', () => {
    const det = project([item({ tax_rate: '0' })], 'C', CF);

    expect(det.ImpNeto).toBe('1000.00');
    expect(det.ImpIVA).toBe('0.00');
    expect(det.ImpOpEx).toBe('0.00');
    expect(det.ImpTotal).toBe('1000.00');
    expect(det.Iva).toBeUndefined();
  });

  it('Monotri TDF: item exento NO va a ImpOpEx (queda en ImpNeto, exención por leyenda — A-25)', () => {
    const det = project([item({ tax_rate: '0', tdf_exempt: true })], 'C', CF);

    expect(det.ImpNeto).toBe('1000.00');
    expect(det.ImpOpEx).toBe('0.00'); // Tipo C: ImpOpEx debe ser 0 (Manual v4.5)
    expect(det.ImpTotal).toBe('1000.00');
    expect(det.Iva).toBeUndefined();
  });
});

describe('projectToWSFEv1 — validaciones de entrada', () => {
  it('rechaza cbte_fecha con formato inválido', () => {
    const totals = calculateSaleTotals([item()]);
    expect(() =>
      projectToWSFEv1({
        totals,
        invoice_type: 'B',
        sale_point: 2,
        invoice_number: 1,
        cbte_fecha: '2026-07-10',
        receptor: CF,
      })
    ).toThrow();
  });

  it('rechaza invoice_number no positivo', () => {
    const totals = calculateSaleTotals([item()]);
    expect(() =>
      projectToWSFEv1({
        totals,
        invoice_type: 'B',
        sale_point: 2,
        invoice_number: 0,
        cbte_fecha: '20260710',
        receptor: CF,
      })
    ).toThrow();
  });
});
