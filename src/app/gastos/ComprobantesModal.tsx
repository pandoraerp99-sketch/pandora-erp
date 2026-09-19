'use client';

/**
 * Los comprobantes de un gasto: subir, bajar, quitar.
 *
 * El bloque de "Adjuntar comprobante" sale de la maqueta que el owner aprobó
 * el 2026-09-19 — zona punteada, clip, la frase "Foto, PDF o ticket como
 * respaldo del gasto", el botón a la derecha y la marca de opcional. Lo único
 * que NO se porta es la chapita "PRÓXIMAMENTE OCR": prometía leer el
 * comprobante solo, que el brief dejó fuera de alcance, y una promesa en la
 * pantalla es una promesa.
 *
 * Vive acá y no dentro de `DetalleModal` por una razón que importa: ese modal
 * sólo se abre cuando el gasto tiene renglones, o sea sólo para compras de
 * mercadería. El ítem 12 pide justamente los otros — alquiler, seguros,
 * servicios, tasas, honorarios —, que no tienen ni un renglón. Puesto ahí, la
 * función no habría existido para ningún gasto de los que la contadora pide.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adjuntarComprobanteAction,
  listarComprobantesAction,
  quitarComprobanteAction,
  urlDeComprobanteAction,
} from './actions';

export interface ComprobanteVisible {
  id: string;
  nombre_original: string;
  content_type: string;
  bytes: number;
  created_at: string | Date;
  archivo_presente: boolean;
}

function pesoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const Clip = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

export function ComprobantesModal({
  expenseId,
  titulo,
  onCerrar,
  onCambio,
}: {
  expenseId: string;
  titulo: string;
  onCerrar: () => void;
  /** Para que la fila de la lista actualice su contador sin recargar todo. */
  onCambio: (cantidad: number) => void;
}) {
  const [items, setItems] = useState<ComprobanteVisible[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [quitando, setQuitando] = useState<string | null>(null);
  /** Link visible cuando el navegador bloqueó la pestaña. Ver `bajar`. */
  const [linkSuelto, setLinkSuelto] = useState<{ url: string; nombre: string } | null>(
    null
  );
  const [motivo, setMotivo] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const recargar = useCallback(async () => {
    const res = await listarComprobantesAction(expenseId);
    if (res.ok) {
      setItems(res.data as ComprobanteVisible[]);
      onCambio(res.data.length);
      setError(null);
    } else {
      setError(res.error);
    }
  }, [expenseId, onCambio]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  async function subir(archivo: File) {
    setSubiendo(true);
    setError(null);
    const fd = new FormData();
    fd.set('expense_id', expenseId);
    fd.set('archivo', archivo);
    const res = await adjuntarComprobanteAction(fd);
    setSubiendo(false);
    if (inputRef.current) inputRef.current.value = '';
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await recargar();
  }

  async function bajar(id: string) {
    setError(null);
    setLinkSuelto(null);

    // 🔴 La pestaña se abre ACÁ, sincrónica dentro del click, y recién después
    // se le pone la dirección. Abrirla después del `await` la bloquea el
    // navegador —el gesto del usuario ya venció— y no tira ningún error: no
    // pasa nada y el comerciante piensa que el sistema se colgó.
    const pestania = window.open('', '_blank');

    const res = await urlDeComprobanteAction(id);
    if (!res.ok) {
      pestania?.close();
      setError(res.error);
      return;
    }
    if ('falta' in res.data) {
      // No se abre una pestaña rota: se dice. Y se relee, porque la lista
      // tiene que quedar mostrando el mismo estado que acabamos de descubrir.
      pestania?.close();
      setError('El archivo no está guardado. La ficha quedó, el archivo no.');
      await recargar();
      return;
    }

    if (pestania) {
      // Se corta la referencia de vuelta antes de navegar: la página del
      // archivo no tiene por qué poder tocar la del sistema.
      pestania.opener = null;
      pestania.location.replace(res.data.url);
      return;
    }

    // El navegador bloqueó la pestaña igual (hay configuraciones que lo hacen
    // siempre). Entonces se ofrece el link en vez de dejar al usuario
    // apretando un botón que no hace nada.
    setLinkSuelto({ url: res.data.url, nombre: res.data.nombre });
  }

  async function confirmarQuitar(id: string) {
    const res = await quitarComprobanteAction(id, motivo);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setQuitando(null);
    setMotivo('');
    await recargar();
  }

  return (
    <div className="pmov open" onClick={onCerrar}>
      <div
        className="pmod"
        role="dialog"
        aria-modal="true"
        aria-label="Comprobantes del gasto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-head">
          <div>
            <div className="pm-title">Comprobantes</div>
            <div className="pm-sub">{titulo}</div>
          </div>
          <button type="button" className="pm-x" onClick={onCerrar} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error !== null ? <div className="gerr">{error}</div> : null}

        {linkSuelto !== null ? (
          <div className="pm-note">
            El navegador bloqueó la pestaña.{' '}
            <a href={linkSuelto.url} target="_blank" rel="noopener noreferrer">
              Abrir {linkSuelto.nombre}
            </a>{' '}
            — el link vence en un minuto.
          </div>
        ) : null}

        {items === null && error === null ? (
          <div className="pm-note">Buscando los comprobantes…</div>
        ) : null}

        {items !== null && items.length > 0 ? (
          <div className="cmp-lista">
            {items.map((a) => (
              <div key={a.id} className={a.archivo_presente ? 'cmp-fila' : 'cmp-fila falta'}>
                <span className="cmp-ic">
                  <Clip />
                </span>
                <span className="cmp-datos">
                  <b>{a.nombre_original}</b>
                  <small>
                    {a.archivo_presente ? (
                      pesoLegible(a.bytes)
                    ) : (
                      /* La ficha existe y el archivo no. Se dice con todas las
                         letras en vez de ofrecer un botón que termina en 404. */
                      <span className="cmp-falta">El archivo no está guardado</span>
                    )}
                  </small>
                </span>

                {quitando === a.id ? (
                  <span className="cmp-quitar">
                    <input
                      className="ginp"
                      placeholder="¿Por qué lo sacás?"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="pm-btn danger chico"
                      disabled={motivo.trim() === ''}
                      onClick={() => void confirmarQuitar(a.id)}
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      className="pm-btn ghost chico"
                      onClick={() => {
                        setQuitando(null);
                        setMotivo('');
                      }}
                    >
                      Cancelar
                    </button>
                  </span>
                ) : (
                  <span className="cmp-acts">
                    <button
                      type="button"
                      className="pm-btn ghost chico"
                      disabled={!a.archivo_presente}
                      title={
                        a.archivo_presente
                          ? 'Abrir el comprobante'
                          : 'No hay archivo para abrir'
                      }
                      onClick={() => void bajar(a.id)}
                    >
                      Ver
                    </button>
                    <button
                      type="button"
                      className="pm-btn ghost chico"
                      onClick={() => setQuitando(a.id)}
                    >
                      Quitar
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {/* ── El bloque de la maqueta ─────────────────────────────────── */}
        <div className="cmp-zona">
          <span className="cmp-zona-ic">
            <Clip />
          </span>
          <span className="cmp-zona-txt">
            <b>Adjuntar comprobante</b>
            <small>Foto, PDF o ticket como respaldo del gasto · opcional</small>
          </span>
          {/* `primary`, no `pm-btn` a secas: solo, `.pm-btn` NO tiene fondo —
              es la clase base y el color lo dan `primary`/`ghost`/`danger`.
              Sin eso el botón salía como texto pelado, que es el "botón que no
              parece botón" del §14.13. Se vio en la captura, no en el código. */}
          <button
            type="button"
            className="pm-btn primary"
            disabled={subiendo}
            onClick={() => inputRef.current?.click()}
          >
            {subiendo ? 'Subiendo…' : 'Elegir archivo'}
          </button>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir(f);
            }}
          />
        </div>

        {items !== null && items.length === 0 ? (
          <div className="pm-note">
            Este gasto todavía no tiene comprobante cargado. Sirve para alquiler,
            seguros, servicios, tasas y honorarios — que es lo que pide el estudio.
          </div>
        ) : null}

        <div className="pm-acts">
          <button type="button" className="pm-btn ghost" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
