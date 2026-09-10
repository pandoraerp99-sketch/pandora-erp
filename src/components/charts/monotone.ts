/**
 * Interpolación cúbica MONÓTONA (Fritsch–Carlson) para las curvas del Panel.
 *
 * ── POR QUE NO UNA CURVA SUAVE CUALQUIERA ─────────────────────────────────
 * Una spline comun (Catmull-Rom, o bezier con controles a ojo) SOBREPASA: entre
 * dos puntos dibuja valores que no existen. En un grafico de plata eso no es un
 * detalle de estilo — es un numero inventado:
 *
 *   - Despues de un pico, la curva baja de mas y cruza el cero: muestra ventas
 *     NEGATIVAS a una hora en la que simplemente no se vendio.
 *   - Entre dos horas flojas dibuja una loma: sugiere un movimiento que no paso.
 *
 * Y un panel se mira de reojo: nadie va a cruzar la curva contra la tabla.
 *
 * Fritsch–Carlson limita las pendientes para que la curva sea monotona en cada
 * tramo. O sea: entre dos puntos NUNCA se sale del rango de esos dos puntos.
 * Sigue viendose suave, pero no puede inventar.
 *
 * Las funciones trabajan en las coordenadas que se les den. La monotonia se
 * conserva al invertir el eje Y, asi que sirve igual en espacio de datos (para
 * los tests) que en espacio de pantalla (para el SVG).
 */

export interface Punto {
  x: number;
  y: number;
}

/**
 * Pendientes de Fritsch–Carlson.
 *
 * Arranca de la media de las pendientes vecinas y despues las RECORTA donde
 * harian que la curva se pase. Ese recorte es todo el algoritmo.
 */
export function pendientesMonotonas(pts: Punto[]): number[] {
  const n = pts.length;
  if (n < 2) return new Array(n).fill(0);

  // Pendiente de cada tramo.
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1]!.x - pts[i]!.x;
    delta.push(dx === 0 ? 0 : (pts[i + 1]!.y - pts[i]!.y) / dx);
  }

  // Tangente inicial en cada punto: la media de sus dos tramos.
  const m: number[] = new Array(n);
  m[0] = delta[0]!;
  m[n - 1] = delta[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    // Si el tramo cambia de signo, el punto es un maximo o un minimo local:
    // tangente CERO. Sin esto la curva se pasa justo en los picos, que es
    // donde mas se nota.
    m[i] = delta[i - 1]! * delta[i]! <= 0 ? 0 : (delta[i - 1]! + delta[i]!) / 2;
  }

  // Recorte al circulo de radio 3 (Fritsch–Carlson).
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      // Tramo plano: las dos tangentes tienen que ser cero o la curva haria
      // una panza entre dos valores iguales.
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / delta[i]!;
    const b = m[i + 1]! / delta[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * delta[i]!;
      m[i + 1] = tau * b * delta[i]!;
    }
  }
  return m;
}

/**
 * Evalúa la curva en un `x` cualquiera.
 *
 * Existe sobre todo para los TESTS: es lo que permite afirmar que la curva no
 * se sale del rango, en vez de mirarla y decir que se ve bien.
 */
export function evaluarMonotona(pts: Punto[], m: number[], x: number): number {
  const n = pts.length;
  if (n === 0) return 0;
  if (n === 1) return pts[0]!.y;
  if (x <= pts[0]!.x) return pts[0]!.y;
  if (x >= pts[n - 1]!.x) return pts[n - 1]!.y;

  let i = 0;
  while (i < n - 2 && x > pts[i + 1]!.x) i++;

  const p0 = pts[i]!;
  const p1 = pts[i + 1]!;
  const h = p1.x - p0.x;
  if (h === 0) return p0.y;
  const t = (x - p0.x) / h;

  // Base de Hermite.
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * p0.y + h10 * h * m[i]! + h01 * p1.y + h11 * h * m[i + 1]!;
}

/**
 * El `d` de un `<path>` SVG.
 *
 * Los puntos de control de cada bezier salen de las mismas tangentes, así que
 * la curva DIBUJADA es exactamente la que evalúa `evaluarMonotona`. Si fueran
 * dos cálculos distintos, el test estaría probando una curva y la pantalla
 * mostrando otra.
 */
export function rutaMonotona(pts: Punto[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;

  const m = pendientesMonotonas(pts);
  const num = (v: number) => v.toFixed(2);
  let d = `M ${num(pts[0]!.x)} ${num(pts[0]!.y)}`;

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const h = p1.x - p0.x;
    const c1x = p0.x + h / 3;
    const c1y = p0.y + (m[i]! * h) / 3;
    const c2x = p1.x - h / 3;
    const c2y = p1.y - (m[i + 1]! * h) / 3;
    d += ` C ${num(c1x)} ${num(c1y)}, ${num(c2x)} ${num(c2y)}, ${num(p1.x)} ${num(p1.y)}`;
  }
  return d;
}
