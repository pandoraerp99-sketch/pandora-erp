/**
 * Aritmética de fechas del calendario, sin husos horarios.
 *
 * ── POR QUE NO SE USA `new Date(iso)` EN NINGUN LADO ──────────────────────
 * `new Date('2026-09-10')` interpreta el string como medianoche **UTC**. En
 * Ushuaia (UTC−3) eso es el 9 de septiembre a las 21:00 — o sea que el día
 * cambia. Un calendario armado así arranca el mes en el día de semana
 * equivocado y marca "hoy" en la celda de ayer, y eso no se ve en una captura:
 * hay que mirar el 1 de cada mes contra un almanaque.
 *
 * Acá todo se hace con enteros y `Date.UTC`, que es determinístico y no depende
 * de la zona de la máquina que corre el código — ni la del servidor, ni la del
 * navegador.
 *
 * Vive en `lib/` y no adentro del componente a propósito: la lógica metida en
 * un client component queda fuera de todos los tests.
 */

/** 'AAAA-MM-DD' → [año, mes (1-12), día]. */
export function partesDeFecha(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) throw new Error(`fecha con formato inesperado: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** [2026, 9, 1] → '2026-09-01'. La clave con la que se indexa todo. */
export function claveDeDia(anio: number, mes: number, dia: number): string {
  return `${anio}-${pad2(mes)}-${pad2(dia)}`;
}

/**
 * Día de la semana con **lunes = 0**, que es como se dibuja un calendario acá.
 * `getUTCDay()` da domingo = 0; el `+6 % 7` lo corre.
 */
export function diaDeSemanaLunesPrimero(anio: number, mes: number, dia: number): number {
  return (new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay() + 6) % 7;
}

/** Cuántos días tiene el mes. El día 0 del mes siguiente es el último de éste. */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Mes anterior / siguiente, cruzando el año. */
export function moverMes(
  anio: number,
  mes: number,
  paso: number
): { anio: number; mes: number } {
  const n = mes + paso;
  if (n < 1) return { anio: anio - 1, mes: 12 };
  if (n > 12) return { anio: anio + 1, mes: 1 };
  return { anio, mes: n };
}

/**
 * Suma (o resta) días a una fecha ISO y devuelve otra fecha ISO.
 *
 * `Date.UTC` normaliza solo: el día 32 de septiembre es el 2 de octubre. Por
 * eso no hay que preocuparse por los fines de mes ni por los años bisiestos.
 */
export function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = partesDeFecha(iso);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return claveDeDia(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
