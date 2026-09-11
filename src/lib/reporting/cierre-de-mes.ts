/**
 * Proyección de cierre de mes (run-rate) — capa pura.
 *
 * ── LO QUE ESTE ARCHIVO NO PUEDE HACER ─────────────────────────────────────
 * Es un **pronóstico**, y `RESEARCH-BRIEF-panel.md` §7 lo tenía descartado por
 * una razón que sigue en pie: *"un número grande en la pantalla de inicio se
 * lee como promesa"*. Entra porque `RESEARCH-BRIEF-calendario-y-proyecciones`
 * §4 lo aprueba **con rótulo explícito**, que era justamente el trigger.
 *
 * De ahí sale la regla de §6.2, que gobierna todo esto: la proyección **nunca
 * va sola**. Siempre con las tres cosas que la sostienen — sobre cuántos días
 * se calculó, cuál es el promedio diario, y cuánto falta del mes. Así se puede
 * discutir en vez de creer. Y si la base es corta, NO hay número: se dice
 * cuánto falta para poder mostrarlo.
 *
 * ── DE DÓNDE SALE EL DATO ──────────────────────────────────────────────────
 * De la MISMA serie diaria que dibuja el gráfico de arriba (`getSerieDiaria`),
 * no de un agregado propio. Si el promedio saliera de otra consulta, dos
 * números de la misma pantalla podrían discrepar y nadie tendría cómo notarlo.
 * Derivarlos del mismo array los hace reconciliar por construcción.
 *
 * Esa serie trae **una fila por día calendario, sin huecos** (`generate_series`
 * + LEFT JOIN): un domingo cerrado aparece en 0, no falta. Por eso contar filas
 * cuenta días transcurridos y no días trabajados.
 *
 * ── HOY NO ENTRA EN LA BASE ────────────────────────────────────────────────
 * Un día a medio andar arrastra el promedio para abajo: a las 10 de la mañana
 * el día lleva el 15% de lo que va a llevar, y contarlo como día completo haría
 * que la proyección caiga sola a medida que avanza el mes. La base son los días
 * **terminados**; hoy se cuenta como día que falta.
 *
 * ── LO QUE ASUME, DICHO ────────────────────────────────────────────────────
 * Divide por días calendario y multiplica por días calendario del mes, así que
 * **asume que los días cerrados se reparten parejo** en el mes. Si el comercio
 * cierra los domingos, la base ya los incluye en 0 y los días que faltan
 * también van a incluirlos: se cancela. Lo que NO captura es un mes que arranca
 * con tres feriados seguidos. Corregir eso es exactamente el bloque "patrón por
 * día de la semana", que el brief difiere a 2-3 meses de operación real —
 * media corrección inventada acá sería esa feature, mal hecha y sin probar.
 */
import Decimal from 'decimal.js';

/** Lo mínimo que hace falta del mes para decir algo. Brief §8.a: "~1-2 semanas". */
export const DIAS_MINIMOS = 7;

/** Una fila de `getSerieDiaria`: día calendario + lo facturado ese día. */
export interface DiaSerie {
  dia: string;
  total: string;
}

export type EstadoProyeccion = 'sin_base' | 'proyectada';

export interface Proyeccion {
  estado: EstadoProyeccion;
  /** Plata. `null` cuando la base es corta: ahí NO hay número. */
  proyectado: string | null;
  /** Promedio por día de la base. `null` si no hay base. */
  promedioDiario: string | null;
  /** Lo que efectivamente se facturó en los días TERMINADOS del mes. */
  acumuladoCompletos: string;
  /** Días terminados del mes que se usaron como base. */
  diasBase: number;
  /** Días del mes que todavía no terminaron. HOY está acá adentro. */
  diasQueFaltan: number;
  diasDelMes: number;
  /** Cuántos días más hacen falta para poder proyectar. 0 si ya se puede. */
  diasParaPoder: number;
}

/** Cuántos días tiene el mes de una fecha 'AAAA-MM-DD'. Aritmética UTC pura. */
export function diasDelMes(iso: string): number {
  const anio = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  // Día 0 del mes siguiente = último día de éste.
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * @param serie        días calendario consecutivos, terminando HOY.
 * @param hoyLocal     'AAAA-MM-DD' en la zona del comercio, nunca `new Date()`.
 * @param diasDeHistoria días desde la PRIMERA venta del comercio.
 */
export function proyectarCierre(
  serie: DiaSerie[],
  hoyLocal: string,
  diasDeHistoria: number
): Proyeccion {
  const mes = hoyLocal.slice(0, 7);
  const total = diasDelMes(hoyLocal);

  // Comparaciones de string sobre 'AAAA-MM-DD': ordenan igual que las fechas y
  // no hay forma de que se cuele un `new Date(iso)` con su corrimiento de zona.
  const delMes = serie.filter((d) => d.dia.slice(0, 7) === mes);
  const completos = delMes.filter((d) => d.dia < hoyLocal);

  const acumuladoCompletos = completos.reduce(
    (a, d) => a.plus(d.total),
    new Decimal(0)
  );

  // La base no puede ser más larga que la historia del comercio.
  //
  // Un local que abrió el día 8 tiene 7 días del mes en CERO que son reales
  // pero no informan nada: promediar sobre 10 días cuando sólo 3 tuvieron
  // operación subestima el ritmo a un tercio. Es la misma trampa que
  // `ventanaEfectiva` en días de stock, del mismo lado: hacia abajo.
  const cuantos = Math.min(completos.length, Math.max(0, diasDeHistoria));
  // `slice(-0)` NO es "nada": `-0 === 0`, así que devuelve el array ENTERO.
  // Sin este caso, un comercio que nunca vendió promediaba sobre todos los
  // días del mes y proyectaba con una base que no existe.
  const base = cuantos === 0 ? [] : completos.slice(-cuantos);

  const diasQueFaltan = total - completos.length;

  if (base.length < DIAS_MINIMOS) {
    return {
      estado: 'sin_base',
      proyectado: null,
      promedioDiario: null,
      acumuladoCompletos: acumuladoCompletos.toFixed(4),
      diasBase: base.length,
      diasQueFaltan,
      diasDelMes: total,
      diasParaPoder: DIAS_MINIMOS - base.length,
    };
  }

  const sumaBase = base.reduce((a, d) => a.plus(d.total), new Decimal(0));
  const promedio = sumaBase.dividedBy(base.length);

  // Lo que YA pasó en los días terminados + el ritmo aplicado a los que faltan.
  // No se usa `promedio × diasDelMes` a secas: eso borraría lo que realmente
  // pasó y haría que la proyección no contenga al acumulado real.
  const proyectado = acumuladoCompletos.plus(promedio.times(diasQueFaltan));

  return {
    estado: 'proyectada',
    proyectado: proyectado.toFixed(4),
    promedioDiario: promedio.toFixed(4),
    acumuladoCompletos: acumuladoCompletos.toFixed(4),
    diasBase: base.length,
    diasQueFaltan,
    diasDelMes: total,
    diasParaPoder: 0,
  };
}
