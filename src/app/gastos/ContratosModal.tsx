'use client';

/**
 * Los contratos de un proveedor: el respaldo que vale para doce pagos.
 *
 * Es hermano de `ComprobantesModal` y NO el mismo componente con una bandera:
 * comparten el mecanismo (subir, listar, bajar, quitar) pero no las reglas. Un
 * contrato pide vigencia y sin ella no sirve para lo que se lo pide; un
 * comprobante no tiene vigencia y dejársela entrar sería un dato que después
 * alguien lee como si valiera (el CHECK de la 0040 directamente lo rechaza).
 *
 * ── Lo que más importa de esta pantalla ───────────────────────────────────
 * Un contrato VENCIDO se muestra igual, marcado. Respaldó los pagos que cubrió
 * y el estudio los pide; esconderlo sería confundir *cuándo rige* con *si
 * vale* — la misma confusión que "lo pagado" contra "lo gastado".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adjuntarContratoAction,
  listarContratosAction,
  quitarComprobanteAction,
  urlDeComprobanteAction,
} from './actions';

export interface ContratoVisible {
  id: string;
  nombre_original: string;
  bytes: number;
  vigencia_desde: string | null;
  vigencia_hasta: string | null;
  vencido: boolean;
  archivo_presente: boolean;
}

function pesoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** '2026-01-01' → '01/01/2026'. Sin `new Date`: eso corre la fecha por la zona. */
function fechaCorta(iso: string | null): string {
  if (iso === null) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

const Clip = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

export function ContratosModal({
  terceroId,
  titulo,
  onCerrar,
  onCambio,
}: {
  terceroId: string;
  titulo: string;
  onCerrar: () => void;
  onCambio: (cantidad: number) => void;
}) {
  const [items, setItems] = useState<ContratoVisible[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [quitando, setQuitando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [linkSuelto, setLinkSuelto] = useState<{ url: string; nombre: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const recargar = useCallback(async () => {
    const res = await listarContratosAction(terceroId);
    if (res.ok) {
      setItems(res.data as ContratoVisible[]);
      onCambio(res.data.length);
      setError(null);
    } else {
      setError(res.error);
    }
  }, [terceroId, onCambio]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  async function subir(archivo: File) {
    setSubiendo(true);
    setError(null);
    const fd = new FormData();
    fd.set('tercero_id', terceroId);
    fd.set('vigencia_desde', desde);
    fd.set('vigencia_hasta', hasta);
    fd.set('archivo', archivo);
    const res = await adjuntarContratoAction(fd);
    setSubiendo(false);
    if (inputRef.current) inputRef.current.value = '';
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDesde('');
    setHasta('');
    await recargar();
  }

  async function bajar(id: string) {
    setError(null);
    setLinkSuelto(null);
    // Sincrónica dentro del click: después del await el navegador la bloquea
    // sin decir nada. Ver el mismo comentario en ComprobantesModal.
    const pestania = window.open('', '_blank');
    const res = await urlDeComprobanteAction(id);
    if (!res.ok) {
      pestania?.close();
      setError(res.error);
      return;
    }
    if ('falta' in res.data) {
      pestania?.close();
      setError('El archivo no está guardado. La ficha quedó, el archivo no.');
      await recargar();
      return;
    }
    if (pestania) {
      pestania.opener = null;
      pestania.location.replace(res.data.url);
      return;
    }
    setLinkSuelto({ url: res.data.url, nombre: res.data.nombre });
  }

  const faltanFechas = desde === '' || hasta === '';

  return (
    <div className="pmov open" onClick={onCerrar}>
      <div
        className="pmod"
        role="dialog"
        aria-modal="true"
        aria-label="Contratos del proveedor"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-head">
          <div>
            <div className="pm-title">Contratos</div>
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
          <div className="pm-note">Buscando los contratos…</div>
        ) : null}

        {items !== null && items.length > 0 ? (
          <div className="cmp-lista">
            {items.map((c) => (
              <div key={c.id} className={c.archivo_presente ? 'cmp-fila' : 'cmp-fila falta'}>
                <span className="cmp-ic">
                  <Clip />
                </span>
                <span className="cmp-datos">
                  <b>{c.nombre_original}</b>
                  <small>
                    {c.archivo_presente ? (
                      <>
                        {fechaCorta(c.vigencia_desde)} → {fechaCorta(c.vigencia_hasta)}
                        {' · '}
                        {pesoLegible(c.bytes)}
                      </>
                    ) : (
                      <span className="cmp-falta">El archivo no está guardado</span>
                    )}
                  </small>
                </span>

                {/* Vencido NO es inválido: respaldó los pagos que cubrió. Por
                    eso es una marca al lado y no una razón para esconderlo. */}
                {c.vencido ? <span className="cmp-vencido">vencido</span> : null}

                {quitando === c.id ? (
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
                      onClick={async () => {
                        const res = await quitarComprobanteAction(c.id, motivo);
                        if (!res.ok) {
                          setError(res.error);
                          return;
                        }
                        setQuitando(null);
                        setMotivo('');
                        await recargar();
                      }}
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
                      disabled={!c.archivo_presente}
                      onClick={() => void bajar(c.id)}
                    >
                      Ver
                    </button>
                    <button
                      type="button"
                      className="pm-btn ghost chico"
                      onClick={() => setQuitando(c.id)}
                    >
                      Quitar
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}

        <div className="cmp-zona">
          <span className="cmp-zona-ic">
            <Clip />
          </span>
          <span className="cmp-zona-txt">
            <b>Adjuntar contrato</b>
            <small>Sirve para todos los pagos del período que cubre</small>
            <span className="cmp-vig">
              <label>
                Desde
                <input
                  type="date"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                />
              </label>
            </span>
          </span>
          <button
            type="button"
            className="pm-btn primary"
            disabled={subiendo || faltanFechas}
            title={
              faltanFechas
                ? 'Poné desde cuándo y hasta cuándo rige'
                : 'Elegir el archivo del contrato'
            }
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
            Todavía no hay contrato cargado. El estudio lo pide junto con los
            alquileres: uno solo respalda los doce pagos del año.
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
