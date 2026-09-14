'use client';

/**
 * Historial de movimientos de un producto.
 *
 * Filas como las de la maqueta de Stock ("Ajuste por rotura · Agus"): qué fue,
 * de dónde salió, quién, y cuánto sumó o restó.
 *
 * ── LA FECHA ES EL DÍA EN QUE PASÓ ────────────────────────────────────────
 * Y cuando el movimiento se cargó otro día —un comprobante de julio cargado en
 * septiembre— se dice debajo. Sin eso, una compra "de julio" que el comerciante
 * sabe que tipeó ayer lo haría desconfiar de la pantalla.
 *
 * Las fechas llegan como 'AAAA-MM-DD' ya en el día del comercio y se formatean
 * como texto: pasarlas por `new Date()` las correría un día en UTC.
 */
import type { HistorialDelProducto, MovimientoDelHistorial } from '@/lib/inventory/queries';
import { cantidadLegible } from './AjusteStockModal';

export type EstadoHistorial =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'listo'; data: HistorialDelProducto };

interface Props {
  productoNombre: string;
  historial: EstadoHistorial;
  onCerrar: () => void;
}

const TIPO: Record<MovimientoDelHistorial['type'], string> = {
  sale: 'Venta',
  purchase: 'Compra',
  loss: 'Merma',
  adjustment: 'Ajuste',
  return: 'Devolución',
};

/** 'AAAA-MM-DD' → 'DD/MM/AAAA', sin pasar por Date. */
function dma(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export function HistorialModal({ productoNombre, historial, onCerrar }: Props) {
  return (
    <div className="pmov open" onClick={onCerrar}>
      <div
        className="pmod hs-mod"
        role="dialog"
        aria-modal="true"
        aria-label={`Historial de ${productoNombre}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-head">
          <div>
            <div className="pm-title">Historial</div>
            <div className="pm-sub">
              {productoNombre} · ventas, compras y ajustes, del más nuevo al más viejo
            </div>
          </div>
          <button type="button" className="pm-x" onClick={onCerrar} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {historial.estado === 'cargando' ? (
          <div className="pm-note" role="status">Cargando movimientos…</div>
        ) : historial.estado === 'error' ? (
          <div className="pm-warn show" role="alert">{historial.mensaje}</div>
        ) : historial.data.movimientos.length === 0 ? (
          <div className="pm-note">
            Este producto todavía no tiene movimientos: ni ventas, ni compras, ni ajustes.
          </div>
        ) : (
          <>
            <div className="hs-lista">
              {historial.data.movimientos.map((m) => (
                <div key={m.id} className="hs-row">
                  <div className="hs-fecha">
                    {dma(m.fecha)}
                    {m.cargado !== m.fecha ? (
                      <small title="El comprobante tiene una fecha; se cargó otro día">
                        cargado el {dma(m.cargado)}
                      </small>
                    ) : (
                      <small>{m.hora}</small>
                    )}
                  </div>
                  <div>
                    <div className="hs-que" title={m.origen ?? undefined}>
                      <span className={`hs-tag ${m.type}`}>{TIPO[m.type]}</span>
                      {m.origen}
                    </div>
                    {m.quien ? <span className="hs-quien">{m.quien}</span> : null}
                  </div>
                  <div className={`hs-q ${m.direction}`}>
                    {m.direction === 'in' ? '+' : '−'}
                    {cantidadLegible(m.qty)}
                  </div>
                </div>
              ))}
            </div>
            {historial.data.total > historial.data.movimientos.length ? (
              <div className="pm-note" style={{ marginTop: 10 }}>
                Mostrando los últimos {historial.data.movimientos.length} de{' '}
                {historial.data.total} movimientos.
              </div>
            ) : null}
          </>
        )}

        <div className="pm-acts">
          <button type="button" className="pm-btn ghost" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
