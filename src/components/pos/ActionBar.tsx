/**
 * ActionBar — barra de acciones inferior (Zone A, Layer 2 glass).
 *
 * Es la ÚNICA superficie glass del POS junto con el pay sheet
 * (POS-DESIGN-V1.1-DIRECTION.md §5). Degrada a solid en hardware sin
 * backdrop-filter vía [data-glass="degraded"] (ver globals.css).
 *
 * Dos bandas:
 *   1. Keyboard hints — los atajos siempre visibles (cajero novato opera
 *      sin training; CLAUDE.md §14.13 "iconos sin label prohibidos en POS").
 *   2. CTA Cobrar — alineado a la DERECHA (no centrado): la asimetría es
 *      deliberada (§6 del doc de dirección). Muestra el total para que el
 *      cajero confirme la cifra antes de cobrar.
 *
 * Shell presentacional: el botón no tiene wiring todavía. `disabled` lo
 * apaga cuando el carrito está vacío (no se puede cobrar nada).
 *
 * Spec: docs/POS-DESIGN-V1.md §4 Zone A + POS-DESIGN-V1.1-DIRECTION.md §5/§9.
 */
import * as React from 'react';

export interface ActionBarHint {
  /** Tecla de función (ej: "F2"). */
  key: string;
  /** Acción que dispara (ej: "Buscar"). */
  label: string;
}

export interface ActionBarProps {
  /** Atajos de teclado visibles en la banda superior. */
  hints: ActionBarHint[];
  /** Total a cobrar ya formateado (es-AR). */
  totalFormatted: string;
  /** Atajo del CTA principal. Default "F5". */
  chargeHotkey?: string;
  /** Etiqueta del CTA principal. Default "Cobrar". */
  chargeLabel?: string;
  /** Carrito vacío → no se puede cobrar. Apaga el CTA. */
  disabled?: boolean;
}

export function ActionBar({
  hints,
  totalFormatted,
  chargeHotkey = 'F5',
  chargeLabel = 'Cobrar',
  disabled = false,
}: ActionBarProps) {
  return (
    <footer
      aria-label="Acciones de venta"
      className="pos-surface-action flex flex-col gap-0.5 px-4 py-3 sticky bottom-0"
    >
      {/* Banda 1 — keyboard hints siempre visibles */}
      <div
        className="flex items-center gap-4 text-[color:var(--text-muted)] overflow-x-auto"
        style={{ fontSize: 'var(--text-micro)' }}
      >
        {hints.map((hint) => (
          <span key={hint.key} className="inline-flex items-center gap-1 shrink-0">
            <kbd
              className="pos-data px-1 py-px rounded bg-[color:var(--surface-elevated)] border border-[color:color-mix(in_oklch,var(--dawn-200)_55%,transparent)] text-[color:var(--text-secondary)]"
              style={{ fontSize: '10px' }}
            >
              {hint.key}
            </kbd>
            <span>{hint.label}</span>
          </span>
        ))}
      </div>

      {/* Banda 2 — CTA Cobrar, alineado derecha */}
      <div className="flex items-center justify-end mt-1">
        <button
          type="button"
          disabled={disabled}
          aria-keyshortcuts={chargeHotkey}
          className={
            disabled
              ? 'inline-flex items-center gap-3 pl-6 pr-5 py-3.5 rounded-lg bg-[color:var(--surface-sunken)] text-[color:var(--text-muted)] cursor-not-allowed border border-[color:color-mix(in_oklch,var(--dawn-200)_50%,transparent)]'
              : 'pos-focusable inline-flex items-center gap-3 pl-6 pr-5 py-3.5 rounded-lg bg-gradient-to-br from-[var(--dawn-500)] to-[var(--dawn-700)] text-white font-medium tracking-tight shadow-[0_4px_16px_oklch(60%_0.195_218/0.32)] transition-all hover:translate-y-[-1px] hover:shadow-[0_6px_20px_oklch(60%_0.195_218/0.42)] active:translate-y-0'
          }
          style={{ fontSize: 'var(--text-body-lg)' }}
        >
          <kbd
            className={
              disabled
                ? 'pos-data px-1.5 py-0.5 rounded bg-[color:color-mix(in_oklch,var(--dawn-200)_30%,transparent)] text-[color:var(--text-muted)]'
                : 'pos-data px-1.5 py-0.5 rounded bg-white/15 text-white'
            }
            style={{ fontSize: 'var(--text-micro)' }}
          >
            {chargeHotkey}
          </kbd>
          <span>{chargeLabel}</span>
          <span className="pos-data tnum" style={{ fontSize: 'var(--text-body-lg)' }}>
            {totalFormatted}
          </span>
          {!disabled && (
            <span aria-hidden className="ml-1">
              →
            </span>
          )}
        </button>
      </div>
    </footer>
  );
}
