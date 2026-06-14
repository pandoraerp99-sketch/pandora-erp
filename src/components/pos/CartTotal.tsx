/**
 * CartTotal — el número héroe que el cliente mira.
 *
 * El UNICO lugar (junto con <CaeNumber>) donde usamos Instrument Serif
 * display. Esto es deliberado: el Total es lo que transmite "valor" al
 * cliente final. En serif editorial display, el número se ve con autoridad
 * y carácter — no como un campo más de una grilla.
 *
 * Spec: docs/POS-DESIGN-V1.md §4 Zone C + POS-DESIGN-V1.1-DIRECTION.md §4.
 *
 * Renderiza el breakdown fiscal alineado con Ley 27.743 (CLAUDE.md §8.6):
 *   - Subtotal sin impuestos
 *   - IVA (21%)
 *   - Otros impuestos nacionales indirectos
 *   - Exento (Ley 19.640) cuando aplique
 *   - TOTAL grande en serif display
 *   - Leyenda Ley 27.743 obligatoria
 *
 * Los montos vienen ya formateados desde el server (es-AR locale,
 * Decimal.js → string). El componente NO hace math — solo renderiza.
 */
import * as React from 'react';

export interface CartTotalProps {
  /** Subtotal sin impuestos (formateado, ej: "$6.100,00") */
  subtotalFormatted: string;
  /** IVA total (formateado, ej: "$1.281,00") */
  ivaFormatted: string;
  /** Etiqueta IVA con porcentaje (ej: "IVA (21%)") */
  ivaLabel: string;
  /** Otros impuestos nacionales indirectos (formateado) */
  otherTaxesFormatted: string;
  /** Monto exento Ley 19.640 (formateado, opcional — solo TDF) */
  exemptFormatted?: string;
  /** Total final (formateado, ej: "$7.759,00") */
  totalFormatted: string;
  /** Hay items en el carrito (controla empty state) */
  hasItems: boolean;
}

export function CartTotal({
  subtotalFormatted,
  ivaFormatted,
  ivaLabel,
  otherTaxesFormatted,
  exemptFormatted,
  totalFormatted,
  hasItems,
}: CartTotalProps) {
  if (!hasItems) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 px-6 text-center"
        style={{ fontFamily: 'var(--font-ui)' }}
      >
        <p
          className="text-[color:var(--text-muted)] mb-1"
          style={{ fontSize: 'var(--text-body)' }}
        >
          Carrito vacío
        </p>
        <p
          className="text-[color:var(--text-muted)]"
          style={{ fontSize: 'var(--text-caption)' }}
        >
          Buscá un producto o escaneá un código.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Resumen y total del carrito"
      className="flex flex-col gap-3"
      style={{ fontFamily: 'var(--font-ui)' }}
    >
      {/* Breakdown fiscal — Ley 27.743 (CLAUDE.md §8.6) */}
      <dl
        className="
          flex flex-col gap-1.5
          pb-3
          border-b border-[color:color-mix(in_oklch,var(--dawn-200)_55%,transparent)]
        "
        style={{ fontSize: 'var(--text-caption)' }}
      >
        <div className="flex justify-between items-baseline">
          <dt className="text-[color:var(--text-secondary)]">Subtotal sin impuestos</dt>
          <dd className="pos-data text-[color:var(--text-primary)]">{subtotalFormatted}</dd>
        </div>
        <div className="flex justify-between items-baseline">
          <dt className="text-[color:var(--text-secondary)]">{ivaLabel}</dt>
          <dd className="pos-data text-[color:var(--text-primary)]">{ivaFormatted}</dd>
        </div>
        <div className="flex justify-between items-baseline">
          <dt className="text-[color:var(--text-secondary)] max-w-[60%] leading-tight">
            Otros impuestos nacionales indirectos
          </dt>
          <dd className="pos-data text-[color:var(--text-primary)]">{otherTaxesFormatted}</dd>
        </div>
        {exemptFormatted && (
          <div className="flex justify-between items-baseline">
            <dt
              className="leading-tight max-w-[60%] flex items-center gap-1.5"
              style={{ color: 'var(--fiscal-tdf)' }}
            >
              <span
                aria-hidden
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--fiscal-tdf)' }}
              />
              Exento Ley 19.640 (TDF)
            </dt>
            <dd className="pos-data" style={{ color: 'var(--fiscal-tdf)' }}>
              {exemptFormatted}
            </dd>
          </div>
        )}
      </dl>

      {/* TOTAL — el momento editorial. Serif display, grande, con autoridad. */}
      <div className="flex flex-col gap-1">
        <span
          className="uppercase text-[color:var(--text-muted)] tracking-[0.18em]"
          style={{ fontSize: 'var(--text-micro)' }}
        >
          Total a cobrar
        </span>
        <span
          className="pos-hero-number tnum text-[color:var(--text-primary)] block"
          style={{ fontSize: 'var(--text-display-hero)' }}
        >
          {totalFormatted}
        </span>
      </div>

      {/* Leyenda Ley 27.743 — obligatoria en comprobante (CLAUDE.md §8.6, A-11 pendiente texto literal) */}
      <p
        className="
          mt-1 pt-3
          border-t border-[color:color-mix(in_oklch,var(--dawn-200)_55%,transparent)]
          text-[color:var(--text-muted)] leading-snug
        "
        style={{ fontSize: 'var(--text-micro)' }}
      >
        Régimen de Transparencia Fiscal
        <br />
        al Consumidor — Ley 27.743
      </p>
    </section>
  );
}
