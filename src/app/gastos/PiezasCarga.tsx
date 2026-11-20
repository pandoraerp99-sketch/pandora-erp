'use client';

/**
 * Piezas de "Cargar gasto" (`CargarGasto.tsx`), separadas para que ese archivo
 * quede abajo de las 800 líneas: categoría y tipo, el recuadro de impacto y
 * los avisos al registrar. La compra de mercadería vive en CompraMercaderia. Sólo el buscador tiene estado propio;
 * todo lo demás lo calcula el formulario.
 */
import type { ReactNode } from 'react';
import Decimal from 'decimal.js';
import type { Comportamiento } from '@/lib/domain/comportamiento-costo';
import { CATEGORIAS, catClase, medioLabel, plata } from './gastosFormato';

/** Monto negativo para mostrar: "−$ 38.500,00". Sólo presentación. */
const menos = (d: Decimal) => `−${plata(d.abs().toFixed(2))}`;

const ICONO_CAJA = (
  <svg
    viewBox="0 0 24 24"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);
const ICONO_INFO = (
  <svg
    viewBox="0 0 24 24"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8h.01M11 12h1v4h1" />
  </svg>
);

/**
 * Categoría y tipo de gasto, en dos menús (pedido del owner, 2026-11-19).
 *
 * El tipo (fijo / variable / mixto) se completa solo: por la categoría, o por
 * lo que se usó la última vez con el proveedor. Abajo se dice de dónde salió,
 * para que el comerciante sepa por qué está puesto y que lo puede cambiar.
 * La mercadería no se clasifica: es una compra que va al stock.
 */
export function CategoriaYTipo({
  categoria,
  comportamiento,
  origen,
  proveedorNombre,
  onCategoria,
  onTipo,
}: {
  categoria: string;
  comportamiento: Comportamiento | null;
  origen: 'categoria' | 'proveedor' | 'manual';
  proveedorNombre: string | null;
  onCategoria: (c: string) => void;
  onTipo: (c: Comportamiento) => void;
}) {
  return (
    <>
      {/* Categoría y tipo, en menús. El tipo se completa solo: por la
          categoría, o por lo que se usó la última vez con el proveedor. */}
      <div className="fgrid2">
        <div className="field">
          <label htmlFor="cgCat">Categoría</label>
          <div className={`fsel-dot ${catClase(categoria)}`}>
            <i className="cd" aria-hidden="true" />
            <select
              id="cgCat"
              className="fselect"
              value={categoria}
              onChange={(e) => onCategoria(e.target.value)}
            >
              {CATEGORIAS.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="cgTipo">Tipo de gasto</label>
          {categoria === 'mercaderia' ? (
            <div className="fnota">No se clasifica: es una compra que va al stock.</div>
          ) : (
            <div className="fsel-dot">
              <i className={`fv-dot ${comportamiento ?? 'sin'}`} aria-hidden="true" />
              <select
                id="cgTipo"
                className="fselect"
                value={comportamiento ?? ''}
                aria-describedby="cgTipoAyuda"
                onChange={(e) => onTipo(e.target.value as Comportamiento)}
              >
                {comportamiento === null ? (
                  <option value="" disabled>
                    Elegí…
                  </option>
                ) : null}
                <option value="fijo">Fijo · no cambia si vendés más</option>
                <option value="variable">Variable · sube si vendés más</option>
                <option value="mixto">Mixto · una parte fija y otra variable</option>
              </select>
            </div>
          )}
        </div>
      </div>
      {categoria !== 'mercaderia' ? (
        <p className={`fhint${comportamiento === null ? ' falta' : ''}`} id="cgTipoAyuda">
          {comportamiento === null
            ? 'Esta categoría no tiene un tipo fijo: elegilo en el menú.'
            : origen === 'proveedor' && proveedorNombre !== null
              ? `Categoría y tipo completados con lo que usaste la última vez con ${proveedorNombre}. Podés cambiarlos.`
              : origen === 'manual'
                ? 'Tipo elegido a mano.'
                : 'El tipo se completó solo según la categoría. Podés cambiarlo.'}
        </p>
      ) : null}
    </>
  );
}

export interface Hecho {
  total: string;
  categoria: string;
  medio: string;
  /** 'ok', el error de la subida, o null si no se eligió archivo. */
  adjunto: string | null;
}

const ICONO_OK = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/**
 * Lo que vuelve al registrar: la confirmación (con el aviso si el comprobante
 * no subió), el error, o la pregunta de posible duplicado con sus dos botones.
 */
export function AvisosAlRegistrar({
  hecho,
  error,
  duda,
  onVerLibro,
  onRevisar,
  onConfirmar,
}: {
  hecho: Hecho | null;
  error: string | null;
  duda: string | null;
  onVerLibro: () => void;
  onRevisar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <>
      <div aria-live="polite">
        {hecho !== null ? (
          <div className="cg-ok">
            <span className="cg-ok-ic">{ICONO_OK}</span>
            <div className="cg-ok-tx">
              <b>
                Listo: gasto de {plata(hecho.total)} en {hecho.categoria}.
              </b>{' '}
              {hecho.medio === 'efectivo'
                ? 'Se descontó de la caja.'
                : hecho.medio === 'cuenta_corriente'
                  ? 'Quedó como deuda con el proveedor.'
                  : ''}
              {hecho.adjunto === 'ok' ? ' El comprobante quedó adjunto.' : null}
              {hecho.adjunto !== null && hecho.adjunto !== 'ok' ? (
                <span className="cg-ok-warn">
                  {' '}
                  El gasto quedó guardado, pero el comprobante no subió ({hecho.adjunto}). Adjuntalo
                  desde el clip de su fila en el libro.
                </span>
              ) : null}
            </div>
            <button type="button" className="cg-link" onClick={onVerLibro}>
              Ver en el libro
            </button>
          </div>
        ) : null}
      </div>
      {error !== null ? (
        <p className="pm-warn red cg-err" role="alert">
          {error}
        </p>
      ) : null}
      {duda !== null ? (
        <div className="cg-duda" role="alert">
          <p>{duda}</p>
          <div className="cg-duda-acts">
            <button type="button" className="scan-btn" onClick={onRevisar}>
              No, revisar
            </button>
            <button type="button" className="scan-btn primary" onClick={onConfirmar}>
              Sí, es otro gasto: registrarlo
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Lo que el gasto va a hacer, ANTES de registrarlo: en efectivo, cuánto queda
 * en la caja; a cuenta corriente, cuánto se le va a deber al proveedor; con
 * otro medio, que no toca la caja. Es la conexión que la maqueta muestra.
 */
export function ImpactoGasto({
  medio,
  cajaEsperado,
  monto,
  proveedorNombre,
  debeHoy,
}: {
  medio: string;
  cajaEsperado: string | null;
  monto: Decimal;
  proveedorNombre: string | null;
  debeHoy: Decimal;
}) {
  let impacto: ReactNode;
  if (medio === 'efectivo') {
    if (cajaEsperado === null) {
      impacto = (
        <div className="cimpact efectivo over">
          <div className="ci-head">{ICONO_CAJA}Impacto en caja</div>
          <p className="ci-txt">
            <b>No hay una caja abierta.</b> Un gasto en efectivo sale de la caja del día. Abrila
            desde Caja, o elegí el medio con el que realmente se pagó.
          </p>
        </div>
      );
    } else {
      const enCaja = new Decimal(cajaEsperado);
      const nuevo = enCaja.minus(monto);
      const supera = nuevo.lt(0);
      impacto = (
        <div className={`cimpact efectivo${supera ? ' over' : ''}`}>
          <div className="ci-head">{ICONO_CAJA}Impacto en caja · Caja 1</div>
          <div className="ci-row">
            <span>Efectivo en caja</span>
            <span className="mono">{plata(enCaja.toFixed(2))}</span>
          </div>
          <div className="ci-row">
            <span>Este gasto</span>
            <span className={`mono${monto.gt(0) ? ' neg' : ''}`}>
              {monto.gt(0) ? menos(monto) : '—'}
            </span>
          </div>
          <div className="ci-row total">
            <span>Nuevo saldo</span>
            <span className={`mono${supera ? ' neg' : ''}`}>
              {supera ? menos(nuevo) : plata(nuevo.toFixed(2))}
            </span>
          </div>
          {supera ? (
            <div className="ci-warn">
              Es más de lo que debería haber en la caja. Revisá el monto antes de registrar.
            </div>
          ) : null}
          <div className="ci-pie">
            Se descuenta del arqueo. No lo cargues además como egreso en Caja: se descontaría dos
            veces.
          </div>
        </div>
      );
    }
  } else if (medio === 'cuenta_corriente') {
    impacto =
      proveedorNombre === null ? (
        <div className="cimpact deuda">
          <div className="ci-head">{ICONO_INFO}Deuda con el proveedor</div>
          <p className="ci-txt">
            Elegí el proveedor arriba: una deuda necesita saber a quién. Si no está en la lista,
            cargalo primero desde Clientes y proveedores.
          </p>
        </div>
      ) : (
        <div className="cimpact deuda">
          <div className="ci-head">
            {ICONO_INFO}Deuda con {proveedorNombre}
          </div>
          <div className="ci-row">
            <span>Le debés hoy</span>
            <span className="mono">{plata(debeHoy.toFixed(2))}</span>
          </div>
          <div className="ci-row">
            <span>Esta compra</span>
            <span className="mono">+{plata(monto.toFixed(2))}</span>
          </div>
          <div className="ci-row total">
            <span>Vas a deber</span>
            <span className="mono">{plata(debeHoy.plus(monto).toFixed(2))}</span>
          </div>
          <div className="ci-pie">
            No sale plata ahora. Cuenta como gasto del mes en que se lo pagues, no de este.
          </div>
        </div>
      );
  } else {
    impacto = (
      <div className="cimpact">
        <div className="ci-muted">
          {ICONO_INFO}
          Pagás con {medioLabel(medio).toLowerCase()}: no toca el efectivo de la caja.
        </div>
      </div>
    );
  }

  return impacto;
}
