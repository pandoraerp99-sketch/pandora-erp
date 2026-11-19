'use client';

/**
 * Fijo / variable / mixto en /gastos (migration 0045): la pastilla de cada
 * fila, el selector del alta, el modal para reclasificar y la tarjeta con el
 * resumen de los últimos 6 meses.
 *
 * El gráfico es SVG propio (ADR-0014). Los montos se muestran en la tabla de
 * abajo, no sólo con el color: el color solo no alcanza para leerlo.
 */
import Decimal from 'decimal.js';
import {
  COMPORTAMIENTOS,
  COMPORTAMIENTO_TEXTO,
  comportamientoEfectivo,
  type Comportamiento,
} from '@/lib/domain/comportamiento-costo';
import type { MesFijosVariables } from '@/lib/services/expenses/cost-behaviour.service';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const mesCorto = (m: string) => MESES[parseInt(m.slice(5, 7), 10) - 1] ?? m;
const mesLargo = (m: string) => MESES_LARGOS[parseInt(m.slice(5, 7), 10) - 1] ?? m;

/** "$194.200" o "$9.999,99": sin decimales cuando son cero. Sin Number. */
function plata(valor: string | Decimal): string {
  const d = (valor instanceof Decimal ? valor : new Decimal(valor || '0')).toDecimalPlaces(2);
  const [ent, dec] = d.abs().toFixed(2).split('.') as [string, string];
  return `${d.isNegative() ? '−' : ''}$${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec === '00' ? '' : ',' + dec}`;
}

/** Para la etiqueta arriba de cada barra: "$194k", "$1,2M". Sólo presentación. */
function compacto(valor: string): string {
  const d = new Decimal(valor || '0');
  if (d.isZero()) return '';
  if (d.gte(1_000_000)) return `$${d.div(1_000_000).toDecimalPlaces(1).toString().replace('.', ',')}M`;
  if (d.gte(1_000)) return `$${d.div(1_000).toDecimalPlaces(0).toString()}k`;
  return `$${d.toDecimalPlaces(0).toString()}`;
}

export function PastillaFV({ valor, onClick }: { valor: Comportamiento | null; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`gfv ${valor ?? 'sin'}`}
      onClick={onClick}
      title="Cambiar si es fijo, variable o mixto"
      aria-label={`${valor ? COMPORTAMIENTO_TEXTO[valor] : 'Sin clasificar'}. Cambiar`}
    >
      {valor ? COMPORTAMIENTO_TEXTO[valor] : 'Sin clasificar'}
    </button>
  );
}

export function SelectorFV({
  valor,
  onElegir,
  etiquetaId,
  deshabilitado = false,
}: {
  valor: Comportamiento | null;
  onElegir: (c: Comportamiento) => void;
  etiquetaId?: string;
  deshabilitado?: boolean;
}) {
  return (
    <div className="fv-seg" role="radiogroup" aria-labelledby={etiquetaId}>
      {COMPORTAMIENTOS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={valor === c}
          className={`${c}${valor === c ? ' on' : ''}`}
          disabled={deshabilitado}
          onClick={() => onElegir(c)}
        >
          <span className="d" />
          {COMPORTAMIENTO_TEXTO[c]}
        </button>
      ))}
    </div>
  );
}

export function ClasificarModal({
  gasto,
  pending,
  error,
  onCancelar,
  onElegir,
}: {
  gasto: { categoria: string; comportamiento: string | null; payee_name: string | null; total: string; fecha: string };
  pending: boolean;
  error: string | null;
  onCancelar: () => void;
  onElegir: (c: Comportamiento) => void;
}) {
  const actual = comportamientoEfectivo(gasto.categoria, gasto.comportamiento);
  return (
    <div className="pmov open" onClick={onCancelar}>
      <div
        className="pmod"
        role="dialog"
        aria-modal="true"
        aria-label="Fijo, variable o mixto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-head">
          <div>
            <div className="pm-title" id="fvTitulo">¿Es fijo o variable?</div>
            <div className="pm-sub">
              {gasto.payee_name ?? 'Gasto'} · {gasto.fecha.slice(8, 10)}/{gasto.fecha.slice(5, 7)} · {plata(gasto.total)}
            </div>
          </div>
          <button type="button" className="pm-x" onClick={onCancelar} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ul className="pm-lista">
          <li><b>Fijo:</b> no cambia aunque vendas más (alquiler, seguro, honorarios).</li>
          <li><b>Variable:</b> sube cuando vendés más (comisiones del posnet, IIBB).</li>
          <li><b>Mixto:</b> tiene una parte fija y otra que depende del uso (la luz).</li>
        </ul>
        <SelectorFV valor={actual} onElegir={onElegir} etiquetaId="fvTitulo" deshabilitado={pending} />
        <p className="fv-ayuda" style={{ marginTop: 10 }}>
          El gasto no se modifica: el cambio queda registrado aparte, con quién lo hizo y cuándo.
        </p>
        {error !== null ? <div className="gerr">{error}</div> : null}
        <div className="pm-acts">
          <button type="button" className="pm-btn ghost" onClick={onCancelar}>
            {pending ? 'Guardando…' : 'Cerrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

const TIPOS: Array<{ k: 'fijo' | 'variable' | 'mixto' | 'sin_clasificar'; texto: string; clase: string }> = [
  { k: 'fijo', texto: 'Fijos', clase: 'fijo' },
  { k: 'variable', texto: 'Variables', clase: 'variable' },
  { k: 'mixto', texto: 'Mixtos', clase: 'mixto' },
  { k: 'sin_clasificar', texto: 'Sin clasificar', clase: 'sin' },
];

export function FijosVariablesCard({ meses }: { meses: MesFijosVariables[] }) {
  const actual = meses[meses.length - 1];
  if (!actual) return null;
  const max = Decimal.max(1, ...meses.map((m) => new Decimal(m.total)));
  // Geometría del SVG (sólo presentación).
  const W = 300;
  const H = 120;
  const base = 96;
  const alto = 78;
  const paso = W / meses.length;
  const ancho = Math.min(26, paso * 0.5);
  const totalActual = new Decimal(actual.total);
  const pct = (v: string) =>
    totalActual.isZero() ? '—' : `${new Decimal(v).div(totalActual).times(100).toDecimalPlaces(0).toString()}%`;

  return (
    <div className="card glass">
      <div className="card-title">
        <h3>Fijos y variables</h3>
        <span className="label-sm">últimos 6 meses</span>
      </div>
      <svg className="fv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gastos fijos, variables y mixtos de los últimos 6 meses">
        {meses.map((m, i) => {
          const x = i * paso + (paso - ancho) / 2;
          let y = base;
          const tramos = (['fijo', 'variable', 'mixto', 'sin_clasificar'] as const).map((k) => {
            const h = new Decimal(m[k]).div(max).times(alto).toNumber();
            y -= h;
            return { k, y, h };
          });
          return (
            <g key={m.mes}>
              {tramos
                .filter((t) => t.h > 0)
                .map((t) => (
                  <rect key={t.k} className={`fv-${t.k === 'sin_clasificar' ? 'sin' : t.k}`} x={x} y={t.y} width={ancho} height={t.h} rx={2} />
                ))}
              {new Decimal(m.total).gt(0) ? (
                <text className="fv-val" x={x + ancho / 2} y={y - 4} textAnchor="middle">
                  {compacto(m.total)}
                </text>
              ) : null}
              <text className={`fv-mes${i === meses.length - 1 ? ' hoy' : ''}`} x={x + ancho / 2} y={H - 6} textAnchor="middle">
                {mesCorto(m.mes)}
              </text>
            </g>
          );
        })}
        <line className="fv-eje" x1={0} x2={W} y1={base} y2={base} />
      </svg>
      <div className="fv-tabla" role="table" aria-label={`Detalle de ${mesLargo(actual.mes)}`}>
        <div className="fv-fila cab" role="row">
          <span role="columnheader">{mesLargo(actual.mes)}</span>
          <span role="columnheader">Monto</span>
          <span role="columnheader">%</span>
        </div>
        {TIPOS.filter((t) => t.k !== 'sin_clasificar' || new Decimal(actual.sin_clasificar).gt(0)).map((t) => (
          <div key={t.k} className="fv-fila" role="row">
            <span role="cell"><span className={`fv-dot ${t.clase}`} />{t.texto}</span>
            <span role="cell" className="m">{plata(actual[t.k])}</span>
            <span role="cell" className="p">{pct(actual[t.k])}</span>
          </div>
        ))}
        <div className="fv-fila tot" role="row">
          <span role="cell">Total</span>
          <span role="cell" className="m">{plata(actual.total)}</span>
          <span role="cell" className="p" />
        </div>
      </div>
      <p className="label-sm" style={{ marginTop: 10, lineHeight: 1.5 }}>
        Lo <b>gastado</b> por fecha del gasto, pagado o no, con IVA: la misma base que “Por categoría”.
        La mercadería no está: es una compra que va al stock.
        {actual.cantidad_sin_clasificar > 0 ? (
          <>
            {' '}Hay <b>{actual.cantidad_sin_clasificar} gasto{actual.cantidad_sin_clasificar === 1 ? '' : 's'} sin clasificar</b> este mes:
            tocá la pastilla en la lista para elegir.
          </>
        ) : null}
      </p>
    </div>
  );
}
