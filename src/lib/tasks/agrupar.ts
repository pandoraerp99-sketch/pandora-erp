/**
 * Cómo se ordenan los pendientes en pantalla.
 *
 * Está acá y no adentro del componente por la misma razón que
 * `lib/calendar/fechas.ts`: es comparación de fechas, que es donde se esconden
 * los errores de un día, y adentro de un client component no la prueba nadie.
 *
 * Todas las comparaciones son entre strings `AAAA-MM-DD`. Con ceros a la
 * izquierda ordenan igual que las fechas que representan, y —lo importante— no
 * pasan nunca por `new Date(iso)`, que interpreta el string como medianoche UTC
 * y en Ushuaia corre todo un día para atrás.
 */
import { sumarDias } from '../calendar/fechas.js';

export const GRUPOS_PENDIENTES = [
  'vencido',
  'hoy',
  'manana',
  'semana',
  'despues',
  'sin_fecha',
] as const;
export type GrupoPendiente = (typeof GRUPOS_PENDIENTES)[number];

export const ETIQUETA_GRUPO: Record<GrupoPendiente, string> = {
  vencido: 'Vencido',
  hoy: 'Hoy',
  manana: 'Mañana',
  semana: 'Esta semana',
  despues: 'Más adelante',
  sin_fecha: 'Sin fecha',
};

/** En qué grupo cae una fecha de vencimiento. */
export function grupoDe(dueDate: string | null, hoyLocal: string): GrupoPendiente {
  if (dueDate === null) return 'sin_fecha';
  if (dueDate < hoyLocal) return 'vencido';
  if (dueDate === hoyLocal) return 'hoy';
  if (dueDate === sumarDias(hoyLocal, 1)) return 'manana';
  if (dueDate <= sumarDias(hoyLocal, 7)) return 'semana';
  return 'despues';
}

export interface AgrupablePorFecha {
  due_date: string | null;
}

export interface GrupoConItems<T> {
  grupo: GrupoPendiente;
  etiqueta: string;
  items: T[];
}

/**
 * Agrupa respetando el orden en que ya venían las tareas.
 *
 * Los grupos vacíos NO se devuelven: un título "Vencido" sobre una lista vacía
 * asusta por nada.
 */
export function agruparPendientes<T extends AgrupablePorFecha>(
  tareas: readonly T[],
  hoyLocal: string
): GrupoConItems<T>[] {
  const porGrupo = new Map<GrupoPendiente, T[]>();
  for (const t of tareas) {
    const g = grupoDe(t.due_date, hoyLocal);
    const acc = porGrupo.get(g);
    if (acc) acc.push(t);
    else porGrupo.set(g, [t]);
  }
  return GRUPOS_PENDIENTES.filter((g) => porGrupo.has(g)).map((g) => ({
    grupo: g,
    etiqueta: ETIQUETA_GRUPO[g],
    items: porGrupo.get(g)!,
  }));
}

/**
 * Un pendiente que el sistema deduce solo.
 *
 * NO se guarda en `tasks`: ya vive en otra tabla, y una copia sólo puede
 * desincronizarse. Por eso NO tiene casilla — no se resuelve tachándolo, se
 * resuelve haciendo lo que dice.
 */
export interface PendienteDerivado {
  clave: string;
  titulo: string;
  detalle: string;
  href: string;
  accion: string;
}

/**
 * Los pendientes que salen de lo que el sistema ya sabe.
 *
 * Hoy hay uno solo: la caja que quedó abierta de un día anterior. Es el único
 * que cumple las dos condiciones — el sistema lo sabe con certeza, y NO está ya
 * dicho en otro lado de la pantalla.
 *
 * "Reponer N productos bajo mínimo" quedó afuera a propósito: el panel ya tiene
 * su propia tarjeta de Reponer, con los productos y sus cantidades. Repetirlo
 * como pendiente sería decir dos veces lo mismo con menos detalle, y hace que
 * la lista de pendientes se llene de cosas que uno ya vio.
 *
 * @param cajaAbiertaDesde `AAAA-MM-DD` del día en que se abrió la caja que
 *   sigue abierta, o `null` si no hay ninguna.
 */
export function derivarPendientes(
  cajaAbiertaDesde: string | null,
  hoyLocal: string
): PendienteDerivado[] {
  const out: PendienteDerivado[] = [];

  // Que la caja esté abierta HOY es lo normal — no es un pendiente. Lo que sí
  // lo es: que siga abierta la de ayer, porque el arqueo de ayer nunca se hizo.
  if (cajaAbiertaDesde !== null && cajaAbiertaDesde < hoyLocal) {
    out.push({
      clave: 'caja-sin-cerrar',
      titulo: 'Cerrar la caja del ' + cajaAbiertaDesde.split('-').reverse().join('/'),
      detalle: 'Quedó abierta de un día anterior: ese arqueo todavía no se hizo',
      href: '/caja',
      accion: 'Ir a caja',
    });
  }

  return out;
}
