/**
 * Cuándo vuelve a vencer una tarea que se repite.
 *
 * ── LA REGLA, Y POR QUE ES ESTA ───────────────────────────────────────────
 * Se avanza **desde el vencimiento**, de a un paso, y se sigue avanzando hasta
 * pasar el día en que se tachó.
 *
 * Las dos alternativas obvias fallan cada una por su lado:
 *
 *   - Avanzar UN paso desde el vencimiento viejo: una tarea diaria que vence el
 *     viernes y se tacha el lunes deja sábado, domingo y lunes vencidos. El
 *     comercio abre el lunes y encuentra cuatro tareas rojas que son una sola.
 *     Una lista así se empieza a ignorar, y una lista de pendientes ignorada es
 *     peor que no tenerla.
 *
 *   - Avanzar desde la fecha en que se tachó: arregla lo anterior pero pierde
 *     el ancla. "Pagar el alquiler el 10", pagado el 12, pasa a vencer el 12; y
 *     al mes siguiente el 14. La fecha se corre sola hasta no significar nada.
 *
 * Avanzar desde el vencimiento saltéandose las ocurrencias perdidas cumple las
 * dos cosas: no se acumula nada y el día del mes no se mueve.
 *
 * ── EL ANCLA DEL MENSUAL ──────────────────────────────────────────────────
 * Para `mensual` los pasos se cuentan como MESES sumados a la fecha original,
 * no recortando el resultado anterior. Si no, el 31 de enero cae el 28 de
 * febrero y después el 28 de marzo: el ancla se pierde en el primer mes corto.
 * Contando desde el original, febrero recorta a 28 pero marzo vuelve al 31.
 */
import { claveDeDia, diasDelMes, partesDeFecha, sumarDias } from '../calendar/fechas.js';
import type { TaskRecurrence } from '../db/schema/tasks.js';

/**
 * Tope de pasos. Existe sólo para que un dato imposible (un vencimiento del año
 * 1900 con recurrencia diaria) falle fuerte en vez de colgar el servidor.
 * 4000 pasos diarios son ~11 años; nadie va a tachar algo con esa demora.
 */
const MAX_PASOS = 4000;

/** Suma `k` meses a una fecha, recortando al último día si el mes es más corto. */
function sumarMeses(iso: string, k: number): string {
  const [a, m, d] = partesDeFecha(iso);
  const total = a * 12 + (m - 1) + k;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return claveDeDia(anio, mes, Math.min(d, diasDelMes(anio, mes)));
}

/**
 * El próximo vencimiento de una tarea recurrente.
 *
 * @param vencimiento  el `due_date` que tenía la tarea (ancla), 'AAAA-MM-DD'
 * @param recurrencia  cadencia
 * @param tachadaEl    día local del comercio en que se tachó, 'AAAA-MM-DD'
 * @returns            la primera ocurrencia posterior a `tachadaEl`
 */
export function proximaFecha(
  vencimiento: string,
  recurrencia: TaskRecurrence,
  tachadaEl: string
): string {
  // Valida el formato de las dos: `partesDeFecha` tira si no es 'AAAA-MM-DD'.
  partesDeFecha(vencimiento);
  partesDeFecha(tachadaEl);

  const paso = (k: number): string =>
    recurrencia === 'mensual'
      ? sumarMeses(vencimiento, k)
      : sumarDias(vencimiento, k * (recurrencia === 'semanal' ? 7 : 1));

  for (let k = 1; k <= MAX_PASOS; k++) {
    // Comparación de strings: 'AAAA-MM-DD' con ceros a la izquierda ordena
    // igual que las fechas que representa.
    const candidata = paso(k);
    if (candidata > tachadaEl) return candidata;
  }

  throw new Error(
    `no se pudo calcular la próxima fecha en ${MAX_PASOS} pasos ` +
      `(vencimiento=${vencimiento}, recurrencia=${recurrencia}, tachadaEl=${tachadaEl})`
  );
}
