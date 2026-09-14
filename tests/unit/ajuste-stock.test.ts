/**
 * T-AJU-01 — La regla del ajuste manual de stock, pura.
 *
 * El comerciante elige un MOTIVO de una lista cerrada, dice cuánto suma o resta
 * y opcionalmente un detalle. De ahí sale el movimiento del libro:
 *
 *   Merma      (rotura, vencimiento, robo)  → type 'loss', SÓLO resta
 *   Corrección (recuento, error de carga, otro) → type 'adjustment', suma o resta
 *
 * Lo que se protege acá:
 *  1. Una merma que "suma" no existe. La pantalla no la ofrece, pero el libro es
 *     append-only: si entra una, no se borra.
 *  2. "Otro" sin detalle es un ajuste sin motivo con otro nombre.
 *  3. El texto que queda en el libro es legible y siempre dice el motivo.
 *
 * Decisiones: RESEARCH-BRIEF-ajuste-de-stock.md §5.
 */
import { describe, expect, it } from 'vitest';
import {
  MOTIVOS_AJUSTE,
  MOTIVOS_CORRECCION,
  MOTIVOS_MERMA,
  planDeAjuste,
  AjusteInvalidoError,
} from '@/lib/domain/ajuste-stock';
import {
  MOTIVOS_AJUSTE_CORRECCION_DB,
  MOTIVOS_AJUSTE_MERMA_DB,
} from '@/lib/db/schema/_common';

describe('T-AJU-01 — planDeAjuste', () => {
  it('una rotura es merma: loss, sale, con el motivo en el texto', () => {
    const p = planDeAjuste({ motivo: 'rotura', delta: '-2' });
    expect(p).toEqual({
      type: 'loss',
      direction: 'out',
      qty: '2',
      motivo: 'rotura',
      reason: 'Rotura',
    });
  });

  it('el detalle se agrega al motivo, recortado', () => {
    const p = planDeAjuste({
      motivo: 'vencimiento',
      delta: '-3',
      detalle: '  lácteos de la heladera  ',
    });
    expect(p.reason).toBe('Vencimiento · lácteos de la heladera');
  });

  it('🔴 una merma que SUMA se rechaza', () => {
    // "Rotura +2" no significa nada, y el libro no se puede corregir después.
    expect(() => planDeAjuste({ motivo: 'robo', delta: '2' })).toThrow(
      expect.objectContaining({ campo: 'delta' })
    );
  });

  it('un recuento puede sumar o restar, y es corrección', () => {
    expect(planDeAjuste({ motivo: 'recuento', delta: '4' })).toMatchObject({
      type: 'adjustment',
      direction: 'in',
      qty: '4',
    });
    expect(planDeAjuste({ motivo: 'recuento', delta: '-1.5' })).toMatchObject({
      type: 'adjustment',
      direction: 'out',
      qty: '1.5',
    });
  });

  it('🔴 "Otro" sin detalle se rechaza: sería un ajuste sin motivo', () => {
    expect(() => planDeAjuste({ motivo: 'otro', delta: '1' })).toThrow(
      expect.objectContaining({ campo: 'detalle' })
    );
    expect(() => planDeAjuste({ motivo: 'otro', delta: '1', detalle: '   ' })).toThrow(
      AjusteInvalidoError
    );
    expect(
      planDeAjuste({ motivo: 'otro', delta: '1', detalle: 'devolución de un vecino' }).reason
    ).toBe('Otro · devolución de un vecino');
  });

  it('un ajuste de cero no es un ajuste', () => {
    expect(() => planDeAjuste({ motivo: 'recuento', delta: '0' })).toThrow(
      expect.objectContaining({ campo: 'delta' })
    );
  });

  it('un motivo fuera de la lista se rechaza', () => {
    expect(() =>
      // @ts-expect-error probando el guard en runtime
      planDeAjuste({ motivo: 'regalo', delta: '-1' })
    ).toThrow(expect.objectContaining({ campo: 'motivo' }));
  });

  it('un delta que no es número se rechaza, sin pasar por float', () => {
    expect(() => planDeAjuste({ motivo: 'recuento', delta: 'abc' })).toThrow(
      expect.objectContaining({ campo: 'delta' })
    );
    expect(() => planDeAjuste({ motivo: 'recuento', delta: '1e3' })).toThrow(
      AjusteInvalidoError
    );
  });

  it('🔴 la lista de la pantalla y la de la DB son la misma', () => {
    // Viven en dos archivos a propósito (ver _common.ts). Si una cambia sola, la
    // pantalla ofrece un motivo que la CHECK de la DB rechaza, o al revés.
    expect([...MOTIVOS_MERMA]).toEqual([...MOTIVOS_AJUSTE_MERMA_DB]);
    expect([...MOTIVOS_CORRECCION]).toEqual([...MOTIVOS_AJUSTE_CORRECCION_DB]);
    expect(Object.keys(MOTIVOS_AJUSTE).sort()).toEqual(
      [...MOTIVOS_AJUSTE_MERMA_DB, ...MOTIVOS_AJUSTE_CORRECCION_DB].sort()
    );
  });

  it('la lista es la del brief: tres de merma, tres de corrección', () => {
    const grupos = Object.values(MOTIVOS_AJUSTE).map((m) => m.grupo);
    expect(grupos.filter((g) => g === 'merma')).toHaveLength(3);
    expect(grupos.filter((g) => g === 'correccion')).toHaveLength(3);
    // El type sale del grupo, sin excepciones: es lo que lee el Panel.
    for (const m of Object.values(MOTIVOS_AJUSTE)) {
      expect(m.type).toBe(m.grupo === 'merma' ? 'loss' : 'adjustment');
    }
  });
});
