import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionBar, type ActionBarProps } from '@/components/pos/ActionBar';

/**
 * ActionBar es presentacional (sin wiring). Se testea con renderToStaticMarkup
 * (no jsdom): el entorno de vitest es 'node', y react-dom/server ya es dep del
 * proyecto Next. Chequeamos comportamiento observable (hints, total, estado
 * disabled) y accesibilidad, no clases de Tailwind (frágiles). La regresión
 * visual la cubre Playwright según las reglas web del repo.
 */
const render = (overrides: Partial<ActionBarProps> = {}): string =>
  renderToStaticMarkup(
    <ActionBar
      hints={[
        { key: 'F2', label: 'Buscar' },
        { key: 'F4', label: 'Cliente' },
      ]}
      totalFormatted="$ 12.500,00"
      {...overrides}
    />
  );

describe('ActionBar', () => {
  it('renderiza cada atajo de teclado con su tecla y su label', () => {
    const html = render();
    expect(html).toContain('F2');
    expect(html).toContain('Buscar');
    expect(html).toContain('F4');
    expect(html).toContain('Cliente');
  });

  it('muestra el total ya formateado para que el cajero confirme la cifra', () => {
    expect(render()).toContain('$ 12.500,00');
  });

  it('usa F5 / "Cobrar" como CTA por defecto', () => {
    const html = render();
    expect(html).toContain('F5');
    expect(html).toContain('Cobrar');
  });

  it('permite override del atajo y la etiqueta del CTA', () => {
    const html = render({ chargeHotkey: 'F9', chargeLabel: 'Finalizar' });
    expect(html).toContain('F9');
    expect(html).toContain('Finalizar');
    expect(html).not.toContain('Cobrar');
  });

  it('apaga el CTA (button disabled) cuando el carrito está vacío', () => {
    const html = render({ disabled: true });
    expect(html).toContain('disabled=""');
  });

  it('habilita el CTA por defecto (sin atributo disabled)', () => {
    expect(render()).not.toContain('disabled=""');
  });

  it('muestra la flecha del CTA solo cuando está habilitado', () => {
    expect(render()).toContain('→');
    expect(render({ disabled: true })).not.toContain('→');
  });

  it('expone accesibilidad: footer etiquetado y atajo del CTA', () => {
    const html = render();
    expect(html).toContain('aria-label="Acciones de venta"');
    expect(html).toContain('aria-keyshortcuts="F5"');
  });

  it('renderiza sin atajos (lista vacía) sin romper', () => {
    const html = render({ hints: [] });
    expect(html).toContain('$ 12.500,00');
    expect(html).toContain('Cobrar');
  });
});
