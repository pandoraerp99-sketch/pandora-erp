/**
 * El día del comercio — puro, sin DB.
 *
 * La base y el runtime corren en UTC; el comercio vive en Ushuaia, tres horas
 * atrás. Entre las 21:00 y la medianoche, UTC ya está en mañana. Toda frontera
 * de tiempo que ve el usuario (el día de un movimiento, "hoy", la foto de un
 * cierre) se lee desde acá.
 *
 * En SQL la misma regla es `AT TIME ZONE` con `TZ_COMERCIO` (panel.report.ts).
 * Se repite el literal a propósito: este módulo es puro y no importa nada de la
 * capa de lectura.
 */
export const ZONA_COMERCIO = 'America/Argentina/Ushuaia';

/** 'AAAA-MM-DD' del día del comercio en el instante dado. */
export function diaDelComercio(ahora: Date = new Date()): string {
  // 'en-CA' formatea como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_COMERCIO }).format(ahora);
}

/**
 * Los últimos `n` meses del comercio como 'AAAA-MM', del más viejo al actual.
 * El mes actual es el del día del comercio, no el de UTC.
 */
export function mesesDelComercio(n: number, ahora: Date = new Date()): string[] {
  const [y, m] = diaDelComercio(ahora).split('-').map(Number) as [number, number];
  const meses: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    // Aritmética de calendario pura: Date.UTC normaliza el mes negativo.
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    meses.push(d.toISOString().slice(0, 7));
  }
  return meses;
}
