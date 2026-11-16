/**
 * Guardia estática: toda pantalla resuelve el período con la fecha de HOY.
 *
 * El bug de "el período vuelve un año corrido" pasó DOS veces (H-02 de la
 * auditoría, 2026-11-16): primero en la lista de comprobantes de /contador y
 * después en el CSV de ventas. Las dos veces fue el mismo patrón: el cliente
 * mandaba `periodo.desde` y el servidor lo usaba como fecha de referencia de
 * `periodoDe`. Como `periodo.desde` es medianoche UTC y `periodoDe` resuelve
 * en el calendario del comercio (UTC−3), el primer instante del período cae
 * en el período de ANTES — sin un error, con un archivo bien formado.
 * El mecanismo está pinchado en `periodo-no-es-su-propia-referencia.test.ts`;
 * esto impide que el patrón vuelva a entrar.
 *
 * Es estático a propósito: probar cada action necesitaría una sesión real,
 * y el error está en UNA expresión que se puede leer. Si algún día hace falta
 * pedir un período que no sea el corriente, la forma correcta es pasar un día
 * de ADENTRO del período (no su borde) y agregar el archivo a PERMITIDOS con
 * el motivo — no aflojar el patrón.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = join(__dirname, '..', '..');
// Todo `src`, no sólo `src/app`: un helper de reporting en `src/lib` que
// llame a periodoDe con un borde sería el mismo bug, un piso más abajo.
const FUENTES = join(RAIZ, 'src');

/** Archivos que pueden pasar otra referencia, con el motivo. Hoy: ninguno. */
const PERMITIDOS: Record<string, string> = {};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** Cada llamada a periodoDe con su segundo argumento, sin parsear TS. */
function llamadas(fuente: string): Array<{ linea: number; referencia: string }> {
  const out: Array<{ linea: number; referencia: string }> = [];
  // `new Date()` primero y literal: con un `[^,)]+` genérico la captura se
  // corta en el primer paréntesis y devuelve "new Date(" — la primera versión
  // de este test marcaba las 7 llamadas correctas como malas. Cualquier otra
  // cosa (incluido `new Date(desdeIso)`) cae en la segunda alternativa.
  const re = /periodoDe\(\s*[^,()]+,\s*(new Date\(\)|[^,)]+)/g;
  for (const m of fuente.matchAll(re)) {
    // La DEFINICIÓN (`export function periodoDe(grano, fecha: Date = new
    // Date(), ...)`) no es una llamada.
    if (/function\s+$/.test(fuente.slice(Math.max(0, m.index! - 20), m.index))) continue;
    const linea = fuente.slice(0, m.index).split('\n').length;
    out.push({ linea, referencia: m[1]!.trim() });
  }
  return out;
}

describe('el período de una pantalla se resuelve con la fecha de hoy', () => {
  const encontradas = archivos(FUENTES).flatMap((f) =>
    llamadas(readFileSync(f, 'utf8')).map((c) => ({
      archivo: relative(RAIZ, f).replace(/\\/g, '/'),
      ...c,
    }))
  );

  it('hay llamadas que revisar (si da 0, el patrón de búsqueda se rompió)', () => {
    // Sin esto, un cambio de nombre o de forma dejaría el test en verde sin
    // mirar nada — el chequeo que no corre se ve igual que el que pasa.
    expect(encontradas.length).toBeGreaterThanOrEqual(5);
  });

  it('🔴 ninguna usa una fecha que venga del cliente como referencia', () => {
    const malas = encontradas.filter(
      (c) => c.referencia !== 'new Date()' && !(c.archivo in PERMITIDOS)
    );
    expect(malas).toEqual([]);
  });
});
