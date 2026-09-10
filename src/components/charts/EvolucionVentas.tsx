'use client';

/**
 * Evolución de ventas — curva con hover, y el toggle Día / Semana / Mes.
 *
 * SVG a mano (ADR-0014). La curva usa interpolación MONÓTONA: ver
 * `monotone.ts` para por qué una spline común dibujaría plata que no existe.
 *
 * ── LOS TRES PERIODOS VIENEN CARGADOS ─────────────────────────────────────
 * El servidor manda las tres series y el cambio de pestaña es estado local.
 * Son consultas baratas y así el toggle es instantáneo. Tampoco va en la URL:
 * a diferencia del período de /gastos, nadie comparte un link a "la vista por
 * hora".
 *
 * ── EL TOOLTIP NO ES EL UNICO CAMINO AL DATO ──────────────────────────────
 * El hover es de mouse. El pico —que es el número que importa— va SIEMPRE en el
 * pie, en texto, y el `aria-label` resume la serie. Un dato que sólo existe
 * pasando el mouse no existe para media pantalla.
 */
import { useMemo, useState } from 'react';
import { rutaMonotona, type Punto } from './monotone';

export interface PuntoSerie {
  /** Lo que se muestra en el eje y en el tooltip: '13', 'mar 9'. */
  etiqueta: string;
  valor: number;
}

export interface EvolucionVentasProps {
  dia: PuntoSerie[];
  semana: PuntoSerie[];
  mes: PuntoSerie[];
  /** Formatea la plata. Se inyecta para no duplicar el Intl de la pantalla. */
  formato: (v: number) => string;
  /**
   * Nota del pie, SÓLO para la vista de Día (ej: 'primera venta 9h · última
   * 21h'). Va atada a esa pestaña a propósito: describe la jornada, y quedaba
   * visible en Semana y Mes diciendo algo que no tenía nada que ver con lo que
   * se estaba mirando.
   */
  notaDia?: string;
}

type Periodo = 'dia' | 'semana' | 'mes';

const W = 1000;
const H = 190;
const PAD_TOP = 18;
const PAD_BOT = 26;

export function EvolucionVentas({
  dia,
  semana,
  mes,
  formato,
  notaDia,
}: EvolucionVentasProps) {
  const [periodo, setPeriodo] = useState<Periodo>('dia');
  const [activo, setActivo] = useState<number | null>(null);

  const serie = periodo === 'dia' ? dia : periodo === 'semana' ? semana : mes;

  const { puntos, max, pico, ruta, area } = useMemo(() => {
    const valores = serie.map((p) => p.valor);
    const maxV = Math.max(...valores, 0);
    const paso = serie.length > 1 ? W / (serie.length - 1) : W;
    // Base en CERO, no en el mínimo: escalar al rango convierte una caída del
    // 5% en un derrumbe visual. Mismo criterio que el Sparkline.
    const pts: Punto[] = serie.map((p, i) => ({
      x: i * paso,
      y:
        maxV === 0
          ? H - PAD_BOT
          : PAD_TOP + (1 - p.valor / maxV) * (H - PAD_TOP - PAD_BOT),
    }));
    const d = rutaMonotona(pts);
    const iPico = valores.reduce((mejor, v, i) => (v > valores[mejor]! ? i : mejor), 0);
    return {
      puntos: pts,
      max: maxV,
      pico: serie.length === 0 ? null : { i: iPico, punto: serie[iPico]! },
      ruta: d,
      // El área cierra contra la línea de base, no contra el borde del SVG.
      area: d === '' ? '' : `${d} L ${W} ${H - PAD_BOT} L 0 ${H - PAD_BOT} Z`,
    };
  }, [serie]);

  if (serie.length === 0) {
    return (
      <div className="ev-vacio">
        Todavía no hay ventas para mostrar en este período.
      </div>
    );
  }

  const activoPunto = activo === null ? null : serie[activo];
  const activoXY = activo === null ? null : puntos[activo];

  /** Índice más cercano a la posición del mouse dentro del SVG. */
  const alMover = (e: React.MouseEvent<SVGSVGElement>) => {
    const caja = e.currentTarget.getBoundingClientRect();
    if (caja.width === 0) return;
    const rel = ((e.clientX - caja.left) / caja.width) * W;
    const paso = serie.length > 1 ? W / (serie.length - 1) : W;
    const i = Math.max(0, Math.min(serie.length - 1, Math.round(rel / paso)));
    setActivo(i);
  };

  // Cada cuántas etiquetas se dibuja una, para que no se pisen.
  const cadaCuantas = Math.max(1, Math.ceil(serie.length / 13));

  const resumen =
    pico === null
      ? 'Sin ventas en el período'
      : `Evolución de ventas. Pico en ${pico.punto.etiqueta} con ${formato(pico.punto.valor)}.`;

  return (
    <>
      <div className="ev-head">
        <h3>
          <span className="ic" style={{ background: 'rgba(107,95,255,0.13)', color: 'var(--purple)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 7-7" />
            </svg>
          </span>
          Evolución de ventas
        </h3>
        <div className="ev-seg" role="tablist" aria-label="Período del gráfico">
          {(
            [
              ['dia', 'Día'],
              ['semana', 'Semana'],
              ['mes', 'Mes'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={periodo === v}
              className={periodo === v ? 'on' : undefined}
              onClick={() => {
                setPeriodo(v);
                setActivo(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="ev-caja">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="ev-svg"
          role="img"
          aria-label={resumen}
          onMouseMove={alMover}
          onMouseLeave={() => setActivo(null)}
        >
          <defs>
            <linearGradient id="evGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(107,95,255,0.30)" />
              <stop offset="100%" stopColor="rgba(107,95,255,0)" />
            </linearGradient>
          </defs>

          {/* Dos guías horizontales. Sin números: el eje Y exacto está en el
              tooltip y en el pie, y una grilla numerada acá competiría con los
              KPIs de arriba. */}
          {[0.33, 0.66].map((f) => (
            <line
              key={f}
              x1="0"
              x2={W}
              y1={PAD_TOP + f * (H - PAD_TOP - PAD_BOT)}
              y2={PAD_TOP + f * (H - PAD_TOP - PAD_BOT)}
              className="ev-guia"
            />
          ))}

          <path d={area} fill="url(#evGrad)" />
          <path d={ruta} className="ev-linea" fill="none" />

          {activoXY ? (
            <>
              <line
                x1={activoXY.x}
                x2={activoXY.x}
                y1={PAD_TOP - 8}
                y2={H - PAD_BOT}
                className="ev-vertical"
              />
              <circle cx={activoXY.x} cy={activoXY.y} r="5" className="ev-punto" />
            </>
          ) : (
            // Sin hover, se marca el ÚLTIMO punto: es "dónde estás ahora".
            <circle
              cx={puntos[puntos.length - 1]!.x}
              cy={puntos[puntos.length - 1]!.y}
              r="5"
              className="ev-punto"
            />
          )}
        </svg>

        {/* El tooltip va en HTML y no en el SVG: el SVG usa preserveAspectRatio
            'none' y estira todo lo que tenga adentro, incluida la tipografía. */}
        {activoPunto && activoXY ? (
          <div
            className="ev-tip"
            style={{
              left: `${(activoXY.x / W) * 100}%`,
              top: `${(activoXY.y / H) * 100}%`,
            }}
          >
            <div className="ev-tip-h">{activoPunto.etiqueta}</div>
            <div className="ev-tip-v">{formato(activoPunto.valor)}</div>
          </div>
        ) : null}

        <div className="ev-eje">
          {serie.map((p, i) =>
            i % cadaCuantas === 0 || i === serie.length - 1 ? (
              <span
                key={p.etiqueta + i}
                className="ev-eje-t"
                style={{ left: `${(i / Math.max(1, serie.length - 1)) * 100}%` }}
              >
                {p.etiqueta}
              </span>
            ) : null
          )}
        </div>
      </div>

      <div className="ev-pie">
        <span>
          {pico === null || max === 0 ? (
            'Sin ventas en el período'
          ) : (
            <>
              Pico en <b>{pico.punto.etiqueta}</b> con{' '}
              <b className="tnum">{formato(pico.punto.valor)}</b>
            </>
          )}
        </span>
        {periodo === 'dia' && notaDia !== undefined ? (
          <span className="ev-nota">{notaDia}</span>
        ) : null}
      </div>
    </>
  );
}
