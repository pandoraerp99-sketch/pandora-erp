/**
 * CartRail — shell del riel de carrito (Zone C, Layer 1 operational).
 *
 * Estructura en 3 bandas verticales:
 *   1. Header cliente — slot fiscal (Consumidor final / Cliente B2B).
 *   2. Items — región scrollable. Si hay items renderiza children;
 *      si está vacío renderiza el empty state (calmante, con hint útil).
 *   3. Footer total — slot del <CartTotal>, sólo cuando hay items.
 *
 * Es un SHELL presentacional: no conoce el modelo de venta ni hace math.
 * Los items y el total llegan ya armados desde el caller (children / footer).
 * El wiring interactivo (agregar cliente, quitar item) llega en un sprint
 * posterior cuando exista estado real de venta.
 *
 * Spec: docs/POS-DESIGN-V1.md §4 Zone C + POS-DESIGN-V1.1-DIRECTION.md §9.
 */
import * as React from 'react';

export interface CartRailProps {
  /** Etiqueta del cliente activo (ej: "Consumidor final"). */
  customerLabel: string;
  /** Hay items en el carrito — controla items vs empty state + footer. */
  hasItems: boolean;
  /** Lista de items del carrito (sólo se usa cuando hasItems). */
  children?: React.ReactNode;
  /** Resumen + total (típicamente <CartTotal>); sólo se muestra con items. */
  footer?: React.ReactNode;
}

/**
 * Borde hairline como valor CSS (inline style, NO clase Tailwind).
 * Tailwind 4 sólo detecta strings de clase estáticos; interpolar una clase
 * arbitraria con template literal NO genera el CSS. Por eso va por style.
 */
const HAIRLINE_BORDER = '1px solid color-mix(in oklch, var(--dawn-200) 50%, transparent)';

/** Empty state del carrito — calmante, con la próxima acción clara. */
function CartEmptyState() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-6 text-center select-none"
      role="status"
    >
      <span
        aria-hidden
        className="mb-4 flex items-center justify-center w-14 h-14 rounded-full"
        style={{
          background: 'color-mix(in oklch, var(--dawn-100) 60%, transparent)',
        }}
      >
        <svg
          className="w-6 h-6 text-[color:var(--dawn-500)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="9" cy="20" r="1" />
          <circle cx="18" cy="20" r="1" />
          <path d="M2 3h2.5l1.6 12.3a1.5 1.5 0 0 0 1.5 1.3h9.1a1.5 1.5 0 0 0 1.5-1.2L21 7H6" />
        </svg>
      </span>
      <p
        className="text-[color:var(--text-secondary)] font-medium mb-1"
        style={{ fontSize: 'var(--text-body)' }}
      >
        Carrito vacío
      </p>
      <p
        className="text-[color:var(--text-muted)] leading-snug max-w-[15rem]"
        style={{ fontSize: 'var(--text-caption)' }}
      >
        Buscá un producto{' '}
        <kbd
          className="pos-data px-1 py-px rounded border border-[color:color-mix(in_oklch,var(--dawn-200)_55%,transparent)] text-[color:var(--text-secondary)]"
          style={{ fontSize: 'var(--text-micro)' }}
        >
          F2
        </kbd>{' '}
        o escaneá un código.
      </p>
    </div>
  );
}

export function CartRail({
  customerLabel,
  hasItems,
  children,
  footer,
}: CartRailProps) {
  return (
    <aside
      aria-label="Carrito de venta"
      className="pos-surface-operational flex flex-col w-full rounded-lg overflow-hidden"
    >
      {/* Banda 1 — header cliente (slot fiscal) */}
      <div
        className="px-4 py-3 flex items-center justify-between shrink-0"
        style={{ borderBottom: HAIRLINE_BORDER }}
      >
        <div className="flex flex-col leading-tight min-w-0">
          <span
            className="uppercase tracking-wider text-[color:var(--text-muted)]"
            style={{ fontSize: 'var(--text-micro)' }}
          >
            Cliente
          </span>
          <span
            className="text-[color:var(--text-primary)] font-medium truncate"
            style={{ fontSize: 'var(--text-body)' }}
          >
            {customerLabel}
          </span>
        </div>
        <button
          type="button"
          className="pos-focusable shrink-0 text-[color:var(--dawn-600)] hover:text-[color:var(--dawn-700)] transition-colors"
          style={{ fontSize: 'var(--text-caption)' }}
        >
          + Cliente
        </button>
      </div>

      {/* Banda 2 — items o empty state */}
      {hasItems ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <ul className="flex flex-col gap-2">{children}</ul>
        </div>
      ) : (
        <CartEmptyState />
      )}

      {/* Banda 3 — footer total (sólo con items) */}
      {hasItems && footer && (
        <div
          className="px-4 py-4 bg-[color:var(--surface-raised)] shrink-0"
          style={{ borderTop: HAIRLINE_BORDER }}
        >
          {footer}
        </div>
      )}
    </aside>
  );
}
