/**
 * Lo que una persona escribe cuando escribe plata, llevado al string que espera
 * el dominio.
 *
 * ── POR QUE HACE FALTA ────────────────────────────────────────────────────
 * Acá se escribe `12.500,50`: el punto separa miles y la coma decimales. El
 * dominio (`normalizeCashAmount`, y el mismo patrón en products/stock) exige
 * `^-?\d+(\.\d+)?$` — punto decimal y nada más. Un `replace(',', '.')` a secas
 * convierte `12.500,50` en `12.500.50`, que el dominio rechaza con un
 * "formato numérico inválido" citando un string que la persona nunca tipeó.
 *
 * ── LA AMBIGÜEDAD SE RESUELVE, Y DESPUES SE MUESTRA ───────────────────────
 * `12.500` es genuinamente ambiguo: doce mil quinientos, o doce con medio. Acá
 * se resuelve por la forma (tres dígitos después del último punto = miles),
 * pero la regla NO alcanza sola: quien llama tiene que mostrarle a la persona
 * el monto ya interpretado antes de confirmar. Adivinar en silencio, en el
 * fondo inicial de una caja, es abrir el turno con la plata mal.
 *
 * Devuelve `null` cuando no hay forma de leerlo. Nunca tira: el que decide qué
 * hacer con la entrada inválida es la pantalla.
 */
export function normalizarMontoTipeado(raw: string): string | null {
  // Se tolera lo que viene de un copiar/pegar: símbolo, espacios, no-break.
  const limpio = raw.replace(/[$\s ]/g, '');
  if (limpio === '') return null;
  if (!/^[0-9.,]+$/.test(limpio)) return null;

  const comas = (limpio.match(/,/g) ?? []).length;
  const puntos = (limpio.match(/\./g) ?? []).length;

  let normalizado: string;
  if (comas > 1) {
    // '1,2,3' no es un número en ninguna convención.
    return null;
  } else if (comas === 1) {
    // Hay coma: la coma manda como decimal y los puntos son de miles.
    const [entero, dec] = limpio.split(',') as [string, string];
    if (entero.includes(',')) return null;
    normalizado = `${entero.replace(/\./g, '')}.${dec}`;
  } else if (puntos === 0) {
    normalizado = limpio;
  } else {
    // Sólo puntos. Son de MILES si el último grupo tiene exactamente 3 dígitos
    // ('12.500', '1.234.567'); si no, el punto es decimal ('12.50', '0.5').
    const grupos = limpio.split('.');
    const ultimo = grupos[grupos.length - 1]!;
    const esMiles = grupos.length > 1 && ultimo.length === 3 && grupos[0] !== '';
    normalizado = esMiles ? grupos.join('') : grupos.join('.');
    // '12.50.30' no es nada: quedó con más de un punto decimal.
    if (!esMiles && grupos.length > 2) return null;
  }

  // El dominio valida de nuevo; esto es sólo para no devolver basura.
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null;
  return normalizado;
}
