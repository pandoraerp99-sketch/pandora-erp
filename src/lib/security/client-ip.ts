/**
 * Resolución de la IP del cliente — subject del rate limit de login.
 * ADR-0019 S2 + CLAUDE.md §11.2.
 *
 * **Por qué existe este archivo y no un `.split(',')[0]` inline.**
 *
 * `x-forwarded-for` es una lista acumulativa: cada proxy agrega la IP del
 * par del que recibió. El extremo IZQUIERDO lo controla el cliente — puede
 * mandar `x-forwarded-for: 1.2.3.4` y el proxy le agrega la real detrás:
 *
 *     x-forwarded-for: 1.2.3.4, <ip real>
 *                      ▲            ▲
 *              inventada por    agregada por el
 *              el atacante      proxy (confiable)
 *
 * Tomar el primero deja que el atacante elija su propio bucket de rate
 * limit y lo rote a voluntad → el límite de 5 intentos/min deja de existir.
 * Por eso se toma el ÚLTIMO: el que agregó el proxy más cercano a nosotros.
 *
 * **Orden de preferencia:**
 *   1. `x-real-ip` — valor único que setea el proxy, no acumulativo.
 *   2. último elemento de `x-forwarded-for`.
 *   3. centinela (ver abajo).
 *
 * ⚠️ **A verificar en el primer deploy real.** Cuál de los dos headers
 * llega, y con qué forma, depende del proveedor. La preferencia de arriba
 * es la conservadora (el valor menos manipulable primero), pero hay que
 * confirmarla contra el deploy y ajustar acá si hiciera falta — es el
 * único lugar del código que decide esto.
 */

/**
 * Subject usado cuando no se pudo determinar la IP.
 *
 * **Es a propósito un valor compartido, no uno aleatorio por request.**
 * Si la detección de IP se rompe (proxy mal configurado, header que
 * desaparece), todos los requests sin IP caen en el MISMO bucket y el
 * límite de 5/min los frena a todos juntos. Es decir: degrada a
 * restrictivo, no a permisivo — fail-closed, según CLAUDE.md §13.9.
 *
 * Un UUID por request haría lo contrario: cada intento estrenaría bucket
 * y el rate limit no frenaría nada.
 *
 * NUNCA puede ser string vacío: `checkRateLimit` lanza con subject vacío
 * ("bug de programacion"), y eso convertiría un header faltante en un 500
 * en cada login.
 */
export const IP_UNKNOWN_SENTINEL = 'ip-desconocida';

/**
 * Devuelve la IP del cliente a partir de los headers del request.
 * Nunca devuelve string vacío — ver {@link IP_UNKNOWN_SENTINEL}.
 */
export function resolveClientIp(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp !== undefined && realIp.length > 0) {
    return realIp;
  }

  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor !== null) {
    // El último hop no vacío: el que agregó el proxy más cercano.
    const hops = forwardedFor
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);

    const lastHop = hops[hops.length - 1];
    if (lastHop !== undefined) {
      return lastHop;
    }
  }

  return IP_UNKNOWN_SENTINEL;
}
