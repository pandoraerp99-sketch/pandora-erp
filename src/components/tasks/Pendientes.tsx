'use client';

/**
 * Pendientes del comercio.
 *
 * ── DOS COSAS QUE PARECEN IGUALES Y NO LO SON ─────────────────────────────
 * Arriba de todo van los **derivados**: cosas que el sistema deduce solo, como
 * una caja que quedó abierta de ayer. NO tienen casilla, a propósito — no se
 * resuelven tachándolas, se resuelven yendo a cerrar la caja. Una casilla ahí
 * sería una mentira: la tildás, el problema sigue, y al recargar vuelve.
 *
 * Abajo van las tareas de verdad, que sí se tachan.
 *
 * ── EL FILTRADO SE HACE ACA, NO EN CSS ────────────────────────────────────
 * La maqueta filtraba con reglas del tipo
 *
 *     .todo-list:not([data-tf="all"]) .todo-group{ display:none; }
 *
 * y esas reglas se sacaron de `panelCss.ts`. Un filtro hecho con `display:none`
 * por atributo esconde contenido sin dejar ni un error: si el div no lleva el
 * atributo exacto, desaparecen todos los títulos y uno los va a buscar al JSX.
 * Acá el filtro es una condición de JavaScript, que se puede leer y romper a la
 * vista.
 *
 * ── LA FECHA DE HOY BAJA COMO PROP ────────────────────────────────────────
 * `hoyLocal` viene del servidor con el huso del comercio. Calcularla acá con
 * `new Date()` daría la fecha de la máquina del usuario: a las 21:30 de Ushuaia
 * una notebook en otro huso ya está en el día siguiente, y todo lo de hoy se
 * vería como vencido.
 */
import { useMemo, useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  agruparPendientes,
  derivarPendientes,
  type PendienteDerivado,
} from '@/lib/tasks/agrupar';
import {
  borrarPendienteAction,
  completarPendienteAction,
  editarPendienteAction,
  crearPendienteAction,
  destacharPendienteAction,
} from '@/app/panel/actions';
import type { TaskRecurrence, TaskType } from '@/lib/db/schema/tasks';

export interface PendienteVista {
  id: string;
  titulo: string;
  detalle: string | null;
  tipo: string;
  due_date: string | null;
  recurrencia: string | null;
  done_at: string | null;
}

/**
 * Cada tipo de pendiente. El COLOR no vive acá: va por clase (`tipo-<clave>`
 * en panelCss), porque un color pasado por style no tiene variante de tema y
 * en oscuro el "Contador" (#1f2a44) quedaba negro sobre azul noche.
 */
const COLOR_TIPO: Record<string, { label: string }> = {
  general: { label: 'General' },
  stock: { label: 'Stock' },
  caja: { label: 'Caja' },
  proveedor: { label: 'Proveedor' },
  cliente: { label: 'Cliente' },
  fiscal: { label: 'Fiscal' },
  contador: { label: 'Contador' },
};

/** La clase de color de un tipo; un tipo desconocido se pinta como general. */
const claseTipo = (tipo: string) => `tipo-${tipo in COLOR_TIPO ? tipo : 'general'}`;

const TIPOS_ALTA: readonly TaskType[] = ['general', 'caja', 'stock', 'proveedor', 'fiscal'];

const RECURRENCIAS: ReadonlyArray<{ valor: '' | TaskRecurrence; label: string }> = [
  { valor: '', label: 'Una vez' },
  { valor: 'diaria', label: 'Todos los días' },
  { valor: 'semanal', label: 'Cada semana' },
  { valor: 'mensual', label: 'Cada mes' },
];

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${String(a).slice(2)}`;
}

export interface PendientesProps {
  tareas: PendienteVista[];
  /** `AAAA-MM-DD` en el huso del comercio. */
  hoyLocal: string;
  /** Día en que se abrió la caja que sigue abierta, o `null`. */
  cajaAbiertaDesde: string | null;
  /**
   * Día marcado en el calendario de al lado (`AAAA-MM-DD`), o `null`.
   * Cuando viene, la lista muestra SOLO ese día.
   */
  diaElegido?: string | null;
  /** Para que el botón "ver todo" pueda desmarcar el calendario. */
  onVerTodo?: () => void;
}

export function Pendientes({
  tareas,
  hoyLocal,
  cajaAbiertaDesde,
  diaElegido = null,
  onVerTodo,
}: PendientesProps) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [abriendoAlta, setAbriendoAlta] = useState(false);
  const [filtro, setFiltro] = useState<string | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);

  // Formulario de alta.
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<TaskType>('general');
  const [cuando, setCuando] = useState<string>(hoyLocal);
  const [recurrencia, setRecurrencia] = useState<'' | TaskRecurrence>('');

  /**
   * Tachar tiene que verse INSTANTANEO. Sin esto, la casilla se queda como
   * estaba hasta que el server action vuelve y revalida — medio segundo en el
   * que uno vuelve a hacer click pensando que no agarró.
   */
  const [optimistas, marcarOptimista] = useOptimistic(
    tareas,
    (estado: PendienteVista[], id: string) =>
      estado.map((t) =>
        t.id === id ? { ...t, done_at: t.done_at === null ? 'optimista' : null } : t
      )
  );

  const derivados: PendienteDerivado[] = useMemo(
    () => derivarPendientes(cajaAbiertaDesde, hoyLocal),
    [cajaAbiertaDesde, hoyLocal]
  );

  /**
   * Acá está TODO el filtrado, y a la vista. En la maqueta esto eran reglas
   * como `.todo-list[data-tf="caja"] .todo-item:not([data-type~="caja"])`,
   * que esconden sin dejar rastro: si el atributo no coincide exactamente,
   * la lista queda vacía y no hay error que lo diga.
   */
  const abiertas = useMemo(
    () =>
      optimistas.filter(
        (t) =>
          t.done_at === null &&
          (filtro === null || t.tipo === filtro) &&
          (diaElegido === null || t.due_date === diaElegido)
      ),
    [optimistas, filtro, diaElegido]
  );
  const grupos = useMemo(() => agruparPendientes(abiertas, hoyLocal), [abiertas, hoyLocal]);

  const correr = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'No se pudo');
    });
  };

  const tachar = (t: PendienteVista) => {
    startTransition(() => marcarOptimista(t.id));
    correr(() =>
      t.done_at === null
        ? completarPendienteAction(t.id, hoyLocal)
        : destacharPendienteAction(t.id)
    );
  };

  const crear = () => {
    if (titulo.trim() === '') return;
    correr(async () => {
      const r = await crearPendienteAction({
        titulo,
        tipo,
        due_date: cuando === '' ? null : cuando,
        recurrencia: recurrencia === '' ? null : recurrencia,
      });
      if (r.ok) {
        setTitulo('');
        setRecurrencia('');
        setAbriendoAlta(false);
      }
      return r;
    });
  };

  const total = abiertas.length + derivados.length;
  const vencidas = grupos.find((g) => g.grupo === 'vencido')?.items.length ?? 0;

  return (
    <>
      <div className="card-title">
        <h3>
          Pendientes{' '}
          {total > 0 ? <span className="pend-count">{total}</span> : null}
        </h3>
        <div className="pend-head-der">
          {vencidas > 0 ? (
            <span className="pend-alerta">
              {vencidas} vencido{vencidas === 1 ? '' : 's'}
            </span>
          ) : null}
          <div className={`todo-filter${menuAbierto ? ' open' : ''}`}>
            <button
              type="button"
              className="tf-btn"
              aria-expanded={menuAbierto}
              onClick={() => setMenuAbierto((v) => !v)}
            >
              {filtro === null ? 'Todos' : (COLOR_TIPO[filtro]?.label ?? filtro)}
              <span className="tf-chev" aria-hidden="true">
                ▾
              </span>
            </button>
            <div className="tf-menu">
              <button
                type="button"
                className={filtro === null ? 'on' : ''}
                onClick={() => {
                  setFiltro(null);
                  setMenuAbierto(false);
                }}
              >
                <span className="tf-dot" style={{ background: 'var(--ink-4)' }} />
                Todos
              </button>
              {Object.entries(COLOR_TIPO).map(([clave, c]) => (
                <button
                  key={clave}
                  type="button"
                  className={filtro === clave ? 'on' : ''}
                  onClick={() => {
                    setFiltro(clave);
                    setMenuAbierto(false);
                  }}
                >
                  <span className={`tf-dot ${claseTipo(clave)}`} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Un dia marcado en el calendario de al lado. El cartel es obligatorio:
          sin el, una lista filtrada por dia se lee como una lista vacia. */}
      {diaElegido !== null ? (
        <div className="pdv-head">
          <span>Pendientes del {fechaCorta(diaElegido)}</span>
          <button type="button" className="pdv-back" onClick={() => onVerTodo?.()}>
            Ver todos
          </button>
        </div>
      ) : null}

      {/* ── Lo que el sistema ya sabe. Sin casilla: no se tacha, se resuelve. ── */}
      {derivados.map((d) => (
        <div className="pend-derivado" key={d.clave}>
          <span className="pend-derivado-ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
          </span>
          <div className="todo-tx">
            <div className="todo-n">{d.titulo}</div>
            <div className="todo-s">{d.detalle}</div>
          </div>
          <Link className="pend-accion" href={d.href}>
            {d.accion}
          </Link>
        </div>
      ))}

      <div className="todo-list">
        {grupos.length === 0 && derivados.length === 0 ? (
          <div className="pend-vacio">
            {diaElegido !== null
              ? 'No hay pendientes para ese día.'
              : filtro !== null
                ? 'No hay pendientes de ese tipo.'
                : 'No hay nada pendiente.'}
            <span>
              {diaElegido !== null || filtro !== null
                ? 'Puede haber otros fuera de este filtro.'
                : 'Lo que anotes acá te espera mañana.'}
            </span>
          </div>
        ) : null}

        {grupos.map((g) => (
          <div key={g.grupo}>
            <div className={`todo-group${g.grupo === 'vencido' ? ' over' : ''}`}>
              {g.etiqueta}
              <span className="pend-group-n">{g.items.length}</span>
            </div>
            {g.items.map((t) => {
              const c = COLOR_TIPO[t.tipo] ?? COLOR_TIPO.general!;
              return (
                <div className="todo-item" key={t.id}>
                  <button
                    type="button"
                    className="todo-check"
                    aria-label={`Marcar "${t.titulo}" como hecho`}
                    aria-pressed={t.done_at !== null}
                    disabled={pendiente}
                    onClick={() => tachar(t)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </button>
                  <div className="todo-tx">
                    <div className="todo-n">{t.titulo}</div>
                    <div className="todo-s">
                      {t.due_date !== null ? fechaCorta(t.due_date) : 'sin fecha'}
                      {t.recurrencia !== null ? (
                        <span className="todo-recur">{' · se repite'}</span>
                      ) : null}
                      {t.detalle !== null ? ` · ${t.detalle}` : ''}
                    </div>
                  </div>
                  <span className={`todo-tag ${claseTipo(t.tipo)}`}>
                    {c.label}
                  </span>
                  {/* Reprogramar es lo que MAS se hace con un pendiente: casi
                      nunca se borra, se pasa para otro día. Es un <input
                      type="date"> pelado a propósito — abre el almanaque del
                      sistema con un toque y no hay que inventar un selector. */}
                  <input
                    type="date"
                    className="pend-mover"
                    aria-label={`Cambiar la fecha de "${t.titulo}"`}
                    title="Pasar para otro día"
                    value={t.due_date ?? ''}
                    disabled={pendiente}
                    onChange={(e) =>
                      correr(() =>
                        editarPendienteAction(t.id, {
                          due_date: e.target.value === '' ? null : e.target.value,
                        })
                      )
                    }
                  />
                  <button
                    type="button"
                    className="pend-borrar"
                    aria-label={`Borrar "${t.titulo}"`}
                    disabled={pendiente}
                    onClick={() => correr(() => borrarPendienteAction(t.id))}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Alta ─────────────────────────────────────────────────────────── */}
      {abriendoAlta ? (
        <div className="pend-alta">
          <input
            className="pend-input"
            placeholder="¿Qué hay que hacer?"
            value={titulo}
            autoFocus
            maxLength={200}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') crear();
              if (e.key === 'Escape') setAbriendoAlta(false);
            }}
          />
          <div className="pend-alta-row">
            {TIPOS_ALTA.map((v) => (
              <button
                key={v}
                type="button"
                className={`pend-tipo${tipo === v ? ' on' : ''}`}
                onClick={() => setTipo(v)}
              >
                {COLOR_TIPO[v]?.label ?? v}
              </button>
            ))}
          </div>
          <div className="pend-alta-row pend-alta-bottom">
            <input
              className="pend-fecha"
              type="date"
              value={cuando}
              onChange={(e) => setCuando(e.target.value)}
            />
            <select
              className="pend-fecha"
              value={recurrencia}
              onChange={(e) => {
                const v = e.target.value;
                // El value de un <select> es string: se busca en la lista en
                // vez de castear, asi un option nuevo mal escrito no pasa.
                const op = RECURRENCIAS.find((r) => r.valor === v);
                if (op) setRecurrencia(op.valor);
              }}
            >
              {RECURRENCIAS.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.label}
                </option>
              ))}
            </select>
            <div className="pend-alta-acciones">
              <button
                type="button"
                className="pend-cancelar"
                onClick={() => setAbriendoAlta(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="pend-guardar"
                disabled={pendiente || titulo.trim() === ''}
                onClick={crear}
              >
                Agregar
              </button>
            </div>
          </div>
          {/* Una recurrencia sin fecha la rechaza el service; se avisa antes. */}
          {recurrencia !== '' && cuando === '' ? (
            <div className="pend-err">Para que se repita, elegí desde qué día</div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="pend-abrir"
          onClick={() => setAbriendoAlta(true)}
        >
          <span className="pend-abrir-plus">+</span> Anotar un pendiente
        </button>
      )}

      {error !== null ? (
        <div className="pend-err" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}
