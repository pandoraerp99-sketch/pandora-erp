'use client';

/**
 * Piezas de "Cargar gasto" (`CargarGasto.tsx`), separadas para que ese archivo
 * quede abajo de las 800 líneas: el recuadro de impacto, el detalle de la
 * mercadería y su buscador de productos. Sólo el buscador tiene estado propio;
 * todo lo demás lo calcula el formulario.
 */
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import Decimal from 'decimal.js';
import type { Comportamiento } from '@/lib/domain/comportamiento-costo';
import { CATEGORIAS, catClase, medioLabel, plata } from './gastosFormato';
import { buscarProductosAction, type ProductoBuscadoDTO } from './actions';

/**
 * Un renglón mientras se está cargando. Guarda `productId` porque una línea
 * ES un lote: sin producto no puede mover stock ni valorizar nada.
 */
export interface BorradorLinea {
  key: string;
  productId: string;
  nombre: string;
  qty: string;
  costo: string;
}

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

/** El detalle de una compra de mercadería: cada renglón entra al stock. */
export function DetalleMercaderia({
  lineas,
  setLineas,
  discrimina,
  sumaDetalle,
  baseDetalle,
  detalleNoCierra,
  lineasIncompletas,
  subtotalDe,
}: {
  lineas: BorradorLinea[];
  setLineas: Dispatch<SetStateAction<BorradorLinea[]>>;
  discrimina: boolean;
  sumaDetalle: Decimal;
  baseDetalle: Decimal | null;
  detalleNoCierra: boolean;
  lineasIncompletas: boolean;
  subtotalDe: (l: BorradorLinea) => Decimal | null;
}) {
  return (
    <div className="det cg-det">
      <div className="det-h">
        <span className="det-t">Detalle de la mercadería</span>
        <span className="det-s">
          Opcional. Si lo cargás, entra al stock y queda el costo de cada producto, que es lo que el
          inventario al cierre necesita.
        </span>
      </div>
      {lineas.length > 0 ? (
        <div className="det-tab">
          <div className="det-th">
            <span style={{ flex: 1 }}>Producto</span>
            <span style={{ width: 74, textAlign: 'right' }}>Cant.</span>
            <span style={{ width: 104, textAlign: 'right' }}>Costo u. neto</span>
            <span style={{ width: 100, textAlign: 'right' }}>Subtotal</span>
            <span style={{ width: 28 }} />
          </div>
          {lineas.map((l, i) => {
            const sub = subtotalDe(l);
            return (
              <div key={l.key} className="det-tr">
                <span style={{ flex: 1 }} className="det-nom">
                  {l.nombre}
                </span>
                <input
                  className="det-in"
                  style={{ width: 74 }}
                  inputMode="decimal"
                  value={l.qty}
                  aria-label={`Cantidad de ${l.nombre}`}
                  onChange={(e) =>
                    setLineas((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x))
                    )
                  }
                />
                <input
                  className="det-in"
                  style={{ width: 104 }}
                  inputMode="decimal"
                  value={l.costo}
                  aria-label={`Costo unitario de ${l.nombre}`}
                  onChange={(e) =>
                    setLineas((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, costo: e.target.value } : x))
                    )
                  }
                />
                <span style={{ width: 100, textAlign: 'right' }} className="det-sub">
                  {sub === null ? '—' : plata(sub.toFixed(4))}
                </span>
                <button
                  type="button"
                  className="det-x"
                  aria-label={`Sacar ${l.nombre}`}
                  onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <BuscadorProducto
        onElegir={(p) =>
          setLineas((prev) => [
            ...prev,
            {
              key: `${p.id}-${prev.length}-${Date.now()}`,
              productId: p.id,
              nombre: p.name,
              qty: '',
              // El costo de la última compra viene cargado: el proveedor
              // casi siempre repite precio, y si aumentó se ve contra qué.
              costo: p.cost !== null ? new Decimal(p.cost).toFixed(2) : '',
            },
          ])
        }
      />
      {lineas.length > 0 ? (
        <div className="det-sum">
          <span>
            Suma del detalle <i>{discrimina ? '(contra el neto)' : '(contra el monto)'}</i>
          </span>
          <b className="det-nom">{plata(sumaDetalle.toFixed(4))}</b>
        </div>
      ) : null}
      {detalleNoCierra ? (
        <p className="pm-warn red">
          El detalle suma <b>{plata(sumaDetalle.toFixed(2))}</b> y el comprobante dice{' '}
          <b>{plata((baseDetalle ?? new Decimal(0)).toFixed(2))}</b>
          {discrimina ? ' (neto, sin IVA)' : ''}. Tienen que coincidir.
        </p>
      ) : lineas.length > 0 && discrimina ? (
        <p className="cg-nota">
          Los costos van <b>netos</b>: el IVA discriminado se recupera, así que no es costo de la
          mercadería.
        </p>
      ) : null}
      {lineasIncompletas ? (
        <p className="pm-warn red">
          Hay renglones sin cantidad o sin costo. Completalos o sacalos.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Buscador de productos del catálogo. Mismo gesto que el POS: se tipea, se
 * elige, se agrega el renglón.
 *
 * No permite crear productos desde acá, y es a propósito: un alta de catálogo
 * (precio, alícuota, rubro, exención Ley 19.640) metida adentro de la carga de
 * una factura son dos decisiones distintas en el mismo formulario.
 */
function BuscadorProducto({ onElegir }: { onElegir: (p: ProductoBuscadoDTO) => void }) {
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState<ProductoBuscadoDTO[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const q = texto.trim();
    let vivo = true;
    // Todo el estado se toca DENTRO del timer, nunca sincrónicamente en el
    // efecto (encadena renders y el lint lo marca). El timer evita una
    // consulta por tecla.
    const t = setTimeout(async () => {
      if (q === '') {
        if (vivo) {
          setBuscando(false);
          setOpciones([]);
        }
        return;
      }
      if (vivo) setBuscando(true);
      const res = await buscarProductosAction(q);
      if (!vivo) return;
      setBuscando(false);
      setOpciones(res.ok ? res.data : []);
    }, 220);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [texto]);

  return (
    <div className="det-busc">
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar un producto por nombre, código o SKU…"
        aria-label="Buscar un producto para agregar al detalle"
      />
      {texto.trim() !== '' ? (
        <div className="det-op">
          {buscando && opciones.length === 0 ? (
            <div className="det-vacio">Buscando…</div>
          ) : opciones.length === 0 ? (
            <div className="det-vacio">
              No hay productos que coincidan. Si es nuevo, cargalo primero en Productos.
            </div>
          ) : (
            opciones.map((p) => (
              <button
                key={p.id}
                type="button"
                className="det-opi"
                onClick={() => {
                  onElegir(p);
                  setTexto('');
                  setOpciones([]);
                }}
              >
                <span className="det-opn">{p.name}</span>
                <span className="det-opc">
                  {p.sku !== null ? `${p.sku} · ` : ''}
                  {p.cost !== null ? `última compra ${plata(p.cost)}` : 'sin costo cargado'}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
