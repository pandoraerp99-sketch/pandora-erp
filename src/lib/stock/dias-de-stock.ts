/**
 * Días de stock restantes — la primera proyección del sistema.
 *
 * ── POR QUE ESTA Y NO "VAS A FACTURAR $2.400.000" ─────────────────────────
 * Una proyección de facturación no cambia ninguna decisión: el comercio no
 * hace nada distinto el martes por saberla. "A la Coca de 600 le quedan 4
 * días" significa **comprar hoy**. Una proyección sin decisión atada es un
 * número lindo, que es justamente lo que ya se rechazó en el panel.
 *
 * ── LAS DOS FORMAS EN QUE ESTE CALCULO MIENTE ─────────────────────────────
 * La cuenta es simple —`stock / (unidades vendidas / días)`— y las dos
 * trampas están en los bordes, las dos **para el lado optimista**:
 *
 *   1. **Stock en cero da 0 días y parece lo más urgente.** No lo es: el
 *      quiebre ya pasó y hace rato que se están perdiendo ventas. "Te quedan
 *      0 días" invita a reponer mañana; la verdad pide reponer y además
 *      preguntarse desde cuándo. Tiene estado propio.
 *   2. **Vendido = 0 es una división por cero**, que en JS es `Infinity` y en
 *      pantalla se lee como "tenés de sobra". No hay velocidad que medir. La
 *      consulta devuelve `null` (vía `nullif`) y acá se clasifica aparte.
 *
 * Y una tercera, en la ventana: dividir 3 días de ventas por 30 da una
 * velocidad diez veces menor, o sea diez veces MAS días de stock de los que
 * hay — justo cuando el comercio tiene menos historia con qué darse cuenta.
 * Por eso `ventanaEfectiva`.
 *
 * ── UNIDADES NO SON PLATA ─────────────────────────────────────────────────
 * `Number` acá es legal: CLAUDE.md §9.8 prohíbe `Number` en el camino de la
 * **plata**, y esto son unidades. Aun así la división se hace en SQL, donde
 * el `nullif` de la división por cero se ve, en vez de esconderla en JS.
 */

/**
 * Cuántos días para atrás se miran las ventas.
 *
 * 30 y no 7: un producto que se vende de a poco (una lámpara, un repuesto) en
 * una semana puede no vender nada y quedar clasificado como "sin rotación"
 * siendo que rota, despacio. Y no 90: si el comercio cambió de proveedor o de
 * precio hace dos meses, la velocidad vieja ya no describe la de hoy.
 */
export const VENTANA_DIAS = 30;

/**
 * Días de operación real antes de mostrar un número.
 *
 * Dos semanas es el mínimo para que una velocidad diaria no sea el reflejo de
 * una sola semana rara (una promo, un feriado largo, el mes que abrió). Antes
 * de eso el bloque NO muestra el número: dice cuánto falta. Ver §8.a del
 * brief — un bloque de proyección que muestra un número confiado en la semana
 * 2 es peor que un vanity metric, porque cambia una decisión hacia el lado
 * equivocado.
 */
export const MINIMO_DIAS_HISTORIA = 14;

/** Desde cuántos días restantes se considera que se está por acabar. */
export const DIAS_PARA_ALERTA = 7;

export type EstadoStock = 'sin_stock' | 'se_acaba' | 'holgado' | 'sin_rotacion';

/**
 * En qué estado está un producto.
 *
 * @param stock         `stock_current`
 * @param diasRestantes lo que devolvió la consulta, o `null` si no hay
 *                      velocidad que medir (vendió cero en la ventana)
 */
export function clasificar(stock: number, diasRestantes: number | null): EstadoStock {
  // PRIMERO, antes de mirar los días: sin stock el quiebre ya pasó, y da igual
  // lo que diga la división.
  if (stock <= 0) return 'sin_stock';
  if (diasRestantes === null) return 'sin_rotacion';
  return diasRestantes < DIAS_PARA_ALERTA ? 'se_acaba' : 'holgado';
}

/**
 * La ventana que de verdad se puede usar.
 *
 * Nunca más larga que la historia que existe, y nunca cero — que sería la otra
 * división por cero, la del denominador de la velocidad.
 */
export function ventanaEfectiva(diasDeHistoria: number): number {
  return Math.max(1, Math.min(VENTANA_DIAS, diasDeHistoria));
}

export interface Cobertura {
  /** Si ya hay suficiente operación real como para mostrar números. */
  alcanza: boolean;
  diasDeHistoria: number;
  /** Cuántos días faltan para que alcance. 0 si ya alcanza. */
  faltanDias: number;
}

/**
 * Si el comercio ya operó lo suficiente.
 *
 * Esto es lo que separa "no tengo el dato" de "el dato dice cero", que es la
 * misma distinción que hace el calendario con los días sin ventas.
 */
export function coberturaDeHistoria(diasDeHistoria: number): Cobertura {
  const dias = Math.max(0, diasDeHistoria);
  return {
    alcanza: dias >= MINIMO_DIAS_HISTORIA,
    diasDeHistoria: dias,
    faltanDias: Math.max(0, MINIMO_DIAS_HISTORIA - dias),
  };
}

export interface FilaClasificada {
  estado: EstadoStock;
  stock: number;
  /** `stock_minimum`, que en la mayoría de los productos está sin cargar. */
  minimo: number | null;
}

/**
 * Si una fila merece lugar en el panel.
 *
 * La regla que importa es la de `sin_rotacion`: en un comercio real la mayor
 * parte del catálogo NO vende nada en 30 días. Si eso entrara, el bloque
 * arrancaría con cuarenta filas el primer día y nadie lo volvería a mirar.
 *
 * "20 unidades sin rotación" es capital dormido — una conversación distinta y
 * más adelante. "2 unidades sin rotación, con mínimo 5" sí merece una mirada,
 * pero sólo se puede afirmar que 2 es poco cuando hay un mínimo cargado con
 * qué compararlo.
 */
export function esParaElPanel(fila: FilaClasificada): boolean {
  if (fila.estado === 'sin_stock' || fila.estado === 'se_acaba') return true;
  if (fila.estado === 'sin_rotacion') {
    return fila.minimo !== null && fila.stock <= fila.minimo;
  }
  return false;
}

/**
 * Cómo se dice el número de días.
 *
 * ── POR QUE HAY UN DECIMAL ABAJO DE 3 DIAS ────────────────────────────────
 * La primera versión redondeaba para abajo siempre, y en pantalla se vio el
 * problema: tres productos con 1,06 · 1,31 y 1,98 días mostraban los tres
 * "1 día". La lista está ORDENADA por urgencia y la etiqueta —que es lo único
 * que el ojo lee— borraba justo esa diferencia. Entre comprar hoy y comprar
 * mañana hay una decisión distinta.
 *
 * Arriba de 3 días el decimal no aporta: nadie compra distinto por 5,4 en vez
 * de 5. Ahí se redondea para abajo, que además es el lado seguro de errar en
 * un aviso de faltante.
 */
export function decirDias(dias: number): string {
  if (dias < 1) return 'menos de un día';
  if (dias < 3) {
    // Coma decimal: es la pantalla en español rioplatense (CLAUDE.md §22.16).
    const s = dias.toFixed(1).replace('.', ',');
    return s === '1,0' ? '1 día' : `${s} días`;
  }
  const n = Math.floor(dias);
  return `${n} días`;
}
