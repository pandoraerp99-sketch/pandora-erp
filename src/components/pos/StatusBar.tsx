/**
 * StatusBar — Layer 0 status del POS.
 *
 * El componente DIFERENCIADOR de Pandora vs cualquier POS competidor argentino:
 * AFIP visible como héroe (3x mayor que cualquier otro badge). Si AFIP cae,
 * el cajero lo ve antes de empezar la venta — no al final con el cliente esperando.
 *
 * Spec: docs/POS-DESIGN-V1.md §4 Zone S + POS-DESIGN-V1.1-DIRECTION.md §6 asimetría.
 *
 * Estados AFIP renderizados (CLAUDE.md §12.2 fiscal_status mapping):
 *   - 'ok'          — verde, "CAE en Xms" (último response time)
 *   - 'degraded'    — ámbar, "Lenta: Xs" (latencia alta pero responde)
 *   - 'contingency' — rojo, "no responde" (circuit breaker abierto)
 *   - 'down'        — rojo oscuro, "Modo contingencia activado"
 */
import * as React from 'react';

export type AfipStatus = 'ok' | 'degraded' | 'contingency' | 'down';

export interface StatusBarProps {
  salePointLabel: string;
  cashierName: string;
  afipStatus: AfipStatus;
  afipLatencyMs?: number;
  cashBalanceFormatted: string;
  serverTimeIso: string;
}

const AFIP_STATUS_CONFIG: Record<
  AfipStatus,
  { dot: string; label: string; ariaLabel: string }
> = {
  ok: {
    dot: 'bg-[var(--fiscal-cae-ok)] shadow-[0_0_12px_var(--fiscal-cae-ok)]',
    label: 'AFIP operativo',
    ariaLabel: 'AFIP operativo, conexión saludable',
  },
  degraded: {
    dot: 'bg-[var(--fiscal-cae-pending)] shadow-[0_0_12px_var(--fiscal-cae-pending)] pos-anim-pulse',
    label: 'AFIP lento',
    ariaLabel: 'AFIP respondiendo con latencia elevada',
  },
  contingency: {
    dot: 'bg-[var(--fiscal-contingency)] shadow-[0_0_12px_var(--fiscal-contingency)] pos-anim-pulse',
    label: 'Sin respuesta AFIP',
    ariaLabel: 'AFIP no responde, modo contingencia',
  },
  down: {
    dot: 'bg-[var(--fiscal-cae-error)] shadow-[0_0_12px_var(--fiscal-cae-error)]',
    label: 'Contingencia activada',
    ariaLabel: 'Modo contingencia activado, no se emiten comprobantes fiscales',
  },
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function StatusBar({
  salePointLabel,
  cashierName,
  afipStatus,
  afipLatencyMs,
  cashBalanceFormatted,
  serverTimeIso,
}: StatusBarProps) {
  const cfg = AFIP_STATUS_CONFIG[afipStatus];
  const isOk = afipStatus === 'ok';
  const isCritical = afipStatus === 'contingency' || afipStatus === 'down';

  return (
    <header
      role="banner"
      className="pos-stage relative w-full flex items-stretch border-b border-[color:color-mix(in_oklch,var(--dawn-200)_55%,transparent)] h-14"
      style={{ fontFamily: 'var(--font-ui)' }}
    >
      {/* LEFT: identidad minima */}
      <div className="flex items-center gap-3 px-4 min-w-0">
        <div
          aria-hidden
          className="w-7 h-7 rounded-sm bg-gradient-to-br from-[var(--dawn-400)] to-[var(--dawn-700)] flex items-center justify-center text-white text-[10px] font-semibold tracking-tight shadow-[0_1px_3px_oklch(20%_0.04_240/0.18)]"
        >
          P
        </div>
        <div className="flex flex-col justify-center min-w-0 leading-tight">
          <span
            className="text-[color:var(--text-secondary)] truncate"
            style={{ fontSize: 'var(--text-caption)' }}
          >
            {salePointLabel}
          </span>
          <span
            className="text-[color:var(--text-muted)] truncate"
            style={{ fontSize: 'var(--text-micro)' }}
          >
            {cashierName}
          </span>
        </div>
      </div>

      {/* CENTER: AFIP HEROE — 3x mas prominente */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div
          role="status"
          aria-live="polite"
          aria-label={cfg.ariaLabel}
          className={`
            inline-flex items-center gap-3 px-4 py-1.5 rounded-md
            ${isCritical
              ? 'border border-[var(--fiscal-cae-error)] bg-[color:color-mix(in_oklch,var(--fiscal-cae-error)_8%,var(--surface-elevated))]'
              : isOk
                ? 'border border-[color:color-mix(in_oklch,var(--fiscal-cae-ok)_25%,transparent)] bg-[color:color-mix(in_oklch,var(--fiscal-cae-ok)_5%,var(--surface-elevated))]'
                : 'border border-[color:color-mix(in_oklch,var(--fiscal-cae-pending)_30%,transparent)] bg-[color:color-mix(in_oklch,var(--fiscal-cae-pending)_5%,var(--surface-elevated))]'
            }
          `}
        >
          <span className={`block rounded-full w-2 h-2 ${cfg.dot}`} aria-hidden />
          <span
            className="font-medium tracking-tight text-[color:var(--text-primary)]"
            style={{ fontSize: 'var(--text-body)' }}
          >
            {cfg.label}
          </span>
          {(isOk || afipStatus === 'degraded') && afipLatencyMs !== undefined && (
            <>
              <span
                aria-hidden
                className="block w-px h-3 bg-[color:color-mix(in_oklch,var(--dawn-300)_60%,transparent)]"
              />
              <span
                className="pos-data text-[color:var(--text-secondary)]"
                style={{ fontSize: 'var(--text-caption)' }}
              >
                {formatLatency(afipLatencyMs)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* RIGHT: cash balance + clock (secundarios) */}
      <div className="flex items-center gap-4 px-4">
        <div className="flex flex-col items-end leading-tight">
          <span
            className="text-[color:var(--text-muted)] uppercase tracking-wider"
            style={{ fontSize: 'var(--text-micro)' }}
          >
            En caja
          </span>
          <span
            className="pos-data font-medium text-[color:var(--text-primary)]"
            style={{ fontSize: 'var(--text-caption)' }}
          >
            {cashBalanceFormatted}
          </span>
        </div>
        <span
          aria-hidden
          className="block w-px h-7 bg-[color:color-mix(in_oklch,var(--dawn-300)_50%,transparent)]"
        />
        <time
          dateTime={serverTimeIso}
          className="pos-data text-[color:var(--text-secondary)]"
          style={{ fontSize: 'var(--text-caption)' }}
        >
          {formatTime(serverTimeIso)}
        </time>
      </div>
    </header>
  );
}
