'use client';

/**
 * CajaClient — UI de la caja (port slice 1 del mockup a React).
 *
 * Slice 1: barra de sesión (real) + "Últimos movimientos" (ventas reales del día).
 * Sólo lectura. Los medios se muestran con la taxonomía REAL del backend
 * (efectivo/tarjeta/mp_qr/mixto); la separación débito/crédito del arqueo (A-26,
 * caja/reporting no fiscal) llega al extender el enum en una slice posterior.
 *
 * Estilo Dawn Sky (glass sobre gradiente amanecer), coherente con el mockup.
 */
import { useMemo, useState } from 'react';

export interface CajaSessionDTO {
  salePoint: number;
  openedAtIso: string | null;
  initialAmount: string;
  totalDeposits: string;
  totalWithdraws: string;
  expectedFromMovements: string;
}

export interface CajaMovimientoDTO {
  id: string;
  total: string;
  method: string | null;
  customerName: string | null;
  finalizedAtIso: string | null;
}

interface CajaClientProps {
  cashierName: string;
  salePointLabel: string;
  session: CajaSessionDTO | null;
  movimientos: CajaMovimientoDTO[];
}

const MEDIOS: Record<string, { label: string; color: string }> = {
  efectivo: { label: 'Efectivo', color: '#34c77d' },
  tarjeta: { label: 'Tarjeta', color: '#5b8cff' },
  mp_qr: { label: 'QR / MercadoPago', color: '#6b5fff' },
  mixto: { label: 'Mixto', color: '#9088ff' },
};

function money(raw: string): string {
  const n = Math.round(parseFloat(raw || '0'));
  return '$ ' + (Number.isFinite(n) ? n : 0).toLocaleString('es-AR');
}

function hora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function medioOf(m: string | null): { label: string; color: string } {
  if (!m) return { label: 'Sin asignar', color: '#e8973a' };
  return MEDIOS[m] ?? { label: m, color: '#7681a0' };
}

export function CajaClient({
  cashierName,
  salePointLabel,
  session,
  movimientos,
}: CajaClientProps) {
  const [medioFilter, setMedioFilter] = useState<string>('todos');

  const totalDia = useMemo(
    () => movimientos.reduce((acc, m) => acc + Math.round(parseFloat(m.total || '0')), 0),
    [movimientos]
  );

  const visibles = useMemo(
    () =>
      medioFilter === 'todos'
        ? movimientos
        : movimientos.filter((m) => (m.method ?? 'sin') === medioFilter),
    [movimientos, medioFilter]
  );

  const filterChips: Array<{ key: string; label: string }> = [
    { key: 'todos', label: 'Todos los medios' },
    { key: 'efectivo', label: 'Efectivo' },
    { key: 'tarjeta', label: 'Tarjeta' },
    { key: 'mp_qr', label: 'QR / MP' },
    { key: 'mixto', label: 'Mixto' },
  ];

  return (
    <div className="caja-root">
      <style>{CAJA_CSS}</style>

      <header className="caja-topbar">
        <div className="caja-brand">
          <span className="caja-logo">◆</span> Pandora <span className="caja-sep">·</span> Caja
        </div>
        <div className="caja-user">{cashierName}</div>
      </header>

      <main className="caja-main">
        {/* Barra de sesión */}
        {session ? (
          <section className="glass session-bar">
            <div className="sb-head">
              <div>
                <div className="sb-title">{salePointLabel}</div>
                <div className="sb-sub">
                  Abierta {session.openedAtIso ? `desde ${hora(session.openedAtIso)}` : ''} ·{' '}
                  <span className="sb-live">● en curso</span>
                </div>
              </div>
              <div className="sb-stats">
                <Stat k="Fondo inicial" v={money(session.initialAmount)} />
                <Stat k="Ingresos manuales" v={'+ ' + money(session.totalDeposits)} tone="green" />
                <Stat k="Retiros" v={'− ' + money(session.totalWithdraws)} tone="red" />
                <Stat k="Efectivo esperado (mov.)" v={money(session.expectedFromMovements)} strong />
              </div>
            </div>
          </section>
        ) : (
          <section className="glass session-closed">
            <div className="sc-ic">🔒</div>
            <div>
              <div className="sc-title">No hay caja abierta</div>
              <div className="sc-sub">
                Abrí la caja con el fondo inicial para empezar a operar en {salePointLabel}.
              </div>
            </div>
          </section>
        )}

        {/* Últimos movimientos (ventas del día) */}
        <section className="glass movimientos">
          <div className="mv-head">
            <h2>Últimos movimientos</h2>
            <span className="mv-total">
              {movimientos.length} ventas · {money(String(totalDia))}
            </span>
          </div>

          <div className="mv-filters">
            {filterChips.map((c) => (
              <button
                key={c.key}
                type="button"
                className={'mv-chip' + (medioFilter === c.key ? ' on' : '')}
                onClick={() => setMedioFilter(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>

          {visibles.length === 0 ? (
            <div className="mv-empty">
              {movimientos.length === 0
                ? 'Todavía no hay ventas registradas hoy.'
                : 'Ninguna venta con el medio seleccionado.'}
            </div>
          ) : (
            <div className="mv-scroll">
              <table className="mv-table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Cliente</th>
                    <th>Medio de pago</th>
                    <th className="r">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((m) => {
                    const md = medioOf(m.method);
                    return (
                      <tr key={m.id}>
                        <td className="mono">{hora(m.finalizedAtIso)}</td>
                        <td>{m.customerName || 'Consumidor final'}</td>
                        <td>
                          <span className="medio">
                            <span className="sw" style={{ background: md.color }} />
                            {md.label}
                          </span>
                        </td>
                        <td className="r mono strong">{money(m.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="caja-note">
          Datos reales del día. Alivios, cierre y el editor de reparto por medio
          (débito/crédito) llegan en las próximas slices del port.
        </p>
      </main>
    </div>
  );
}

function Stat({
  k,
  v,
  tone,
  strong,
}: {
  k: string;
  v: string;
  tone?: 'green' | 'red';
  strong?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-k">{k}</div>
      <div className={'stat-v' + (strong ? ' strong' : '') + (tone ? ' ' + tone : '')}>{v}</div>
    </div>
  );
}

const CAJA_CSS = `
.caja-root{ min-height:100dvh; color:#0d1424; font-family:'Inter',ui-sans-serif,system-ui,sans-serif;
  background:linear-gradient(175deg,#b8c8e8 0%,#c8d4ea 25%,#e0d4e0 60%,#f0d8d2 100%); background-attachment:fixed; }
.caja-topbar{ display:flex; align-items:center; justify-content:space-between; padding:14px 22px; }
.caja-brand{ font-weight:700; font-size:15px; display:flex; align-items:center; gap:7px; }
.caja-logo{ color:#6b5fff; }
.caja-sep{ color:#a8b0c5; }
.caja-user{ font-size:12.5px; color:#4a5570; background:rgba(255,255,255,0.55); padding:6px 12px; border-radius:999px;
  border:1px solid rgba(255,255,255,0.8); }
.caja-main{ max-width:1000px; margin:0 auto; padding:8px 20px 60px; display:flex; flex-direction:column; gap:16px; }
.glass{ background:rgba(255,255,255,0.6); backdrop-filter:blur(24px) saturate(140%); -webkit-backdrop-filter:blur(24px) saturate(140%);
  border:1px solid rgba(255,255,255,0.85); border-radius:20px; box-shadow:0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 32px rgba(54,70,120,0.1); }
.session-bar{ padding:20px 24px; }
.sb-head{ display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap; }
.sb-title{ font-size:19px; font-weight:800; }
.sb-sub{ font-size:12px; color:#4a5570; margin-top:3px; }
.sb-live{ color:#1a8e5a; font-weight:600; }
.sb-stats{ display:flex; gap:26px; flex-wrap:wrap; }
.stat-k{ font-size:9.5px; text-transform:uppercase; letter-spacing:0.07em; color:#7681a0; font-weight:600; }
.stat-v{ font-family:'JetBrains Mono',ui-monospace,monospace; font-size:15px; font-weight:600; margin-top:2px; }
.stat-v.strong{ font-size:18px; font-weight:700; }
.stat-v.green{ color:#1a8e5a; } .stat-v.red{ color:#c93545; }
.session-closed{ padding:22px 24px; display:flex; align-items:center; gap:16px; }
.sc-ic{ font-size:26px; } .sc-title{ font-size:16px; font-weight:700; } .sc-sub{ font-size:12.5px; color:#4a5570; margin-top:3px; }
.movimientos{ padding:20px 24px; }
.mv-head{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:14px; }
.mv-head h2{ margin:0; font-size:16px; font-weight:700; }
.mv-total{ font-family:'JetBrains Mono',ui-monospace,monospace; font-size:12.5px; color:#4a5570; font-weight:600; }
.mv-filters{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.mv-chip{ font-size:11.5px; font-weight:600; padding:6px 12px; border-radius:999px; cursor:pointer; color:#4a5570;
  background:rgba(255,255,255,0.4); border:1px solid rgba(13,20,36,0.08); transition:all 150ms; }
.mv-chip:hover{ border-color:rgba(107,95,255,0.35); }
.mv-chip.on{ background:rgba(255,255,255,0.85); border-color:#6b5fff; color:#1f2a44; box-shadow:0 2px 8px rgba(54,70,120,0.1); }
.mv-empty{ text-align:center; padding:30px 10px; color:#7681a0; font-size:12.5px; }
.mv-scroll{ max-height:440px; overflow-y:auto; }
.mv-table{ width:100%; border-collapse:collapse; }
.mv-table th{ text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#7681a0;
  font-family:'JetBrains Mono',ui-monospace,monospace; font-weight:500; padding:0 0 11px; }
.mv-table th.r, .mv-table td.r{ text-align:right; }
.mv-table td{ padding:12px 0; border-top:1px solid rgba(13,20,36,0.05); font-size:13px; color:#1f2a44; }
.mono{ font-family:'JetBrains Mono',ui-monospace,monospace; }
.strong{ font-weight:600; }
.medio{ display:inline-flex; align-items:center; gap:7px; color:#4a5570; }
.medio .sw{ width:8px; height:8px; border-radius:2.5px; }
.caja-note{ font-size:11px; color:#7681a0; text-align:center; margin:4px 0 0; }
`;
