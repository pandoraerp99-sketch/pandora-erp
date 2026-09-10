/**
 * Sparkline — línea + área, SVG puro.
 *
 * SVG a mano y no una librería: ADR-0014 (charts SVG puros, sin Recharts / D3 /
 * Chart.js). Para una serie de N números eso no es purismo, es que la librería
 * pesa más que el gráfico.
 *
 * ── POR QUE VIVE ACA Y NO EN LA PANTALLA ──────────────────────────────────
 * Nació dentro de `ClientesClient`. Cuando el Panel necesitó el mismo gráfico,
 * copiarlo habría dejado dos versiones que se separan sin que ningún test lo
 * note — el mismo problema que tenía el CSV antes de `csv.ts`. Y acá lo que se
 * separaría no es un formato: son los tres casos degenerados de abajo, que son
 * lo único que hace que este gráfico no mienta.
 */

export interface SparklineProps {
  /** De la más vieja a la más nueva. */
  serie: number[];
  w?: number;
  h?: number;
  className?: string;
  /** Color de la línea. Por defecto el violeta del sistema. */
  color?: string;
  /** Color base del degradado del área. Debe ser el mismo tono que `color`. */
  fill?: string;
  ariaLabel?: string;
  /** Marca el último punto con un círculo. Útil cuando el gráfico es el foco. */
  marcarUltimo?: boolean;
}

export function Sparkline({
  serie,
  w = 252,
  h = 52,
  className,
  color = 'var(--purple)',
  fill = '107,95,255',
  ariaLabel,
  marcarUltimo = false,
}: SparklineProps) {
  const W = w;
  const H = h;
  const TECHO = 8; // margen arriba, para que el pico no toque el borde
  const max = Math.max(...serie, 0);
  const min = Math.min(...serie, max);
  const paso = serie.length > 1 ? W / (serie.length - 1) : W;

  const puntos = serie.map((v, i) => {
    const x = i * paso;
    // Tres casos, y los dos degenerados importan:
    //   sin datos    -> plana ABAJO (una linea al medio se leeria como "algo
    //                   constante", que es lo contrario de "no hubo nada")
    //   todo igual   -> plana AL MEDIO (escalar al maximo la pegaria arriba,
    //                   como si estuviera siempre en su techo)
    //   normal       -> escalada al maximo, con la BASE EN CERO. No al rango:
    //                   escalar al rango convierte una caida de 100 a 95 en un
    //                   derrumbe visual, y este grafico se mira de reojo.
    const y =
      max === 0
        ? H - 2
        : max === min
          ? H / 2
          : TECHO + (1 - v / max) * (H - TECHO - 2);
    return { x, y };
  });

  const d = puntos.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  const linea = 'M ' + d.join(' L ');
  const area = `M 0 ${H} L ${d.join(' L ')} L ${W} ${H} Z`;
  // El id del degradado tiene que ser único por instancia: dos <svg> con el
  // mismo id hacen que el segundo use el degradado del primero.
  const id = `spk-${W}-${H}-${serie.length}-${fill.replace(/[^0-9]/g, '')}`;
  const ultimo = puntos[puntos.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      width={className ? W : undefined}
      height={className ? H : undefined}
      style={className ? undefined : { width: '100%', height: h, display: 'block' }}
      role="img"
      aria-label={ariaLabel ?? (max === 0 ? 'Sin movimiento en el período' : 'Evolución del período')}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`rgba(${fill},0.26)`} />
          <stop offset="100%" stopColor={`rgba(${fill},0)`} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={linea}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {marcarUltimo && ultimo !== undefined && max > 0 ? (
        <circle cx={ultimo.x} cy={ultimo.y} r="3" fill={color} />
      ) : null}
    </svg>
  );
}
