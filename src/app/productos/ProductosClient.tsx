'use client';

/**
 * Productos — lista maestra + detalle, sobre <AppShell>.
 * Maqueta: `pos-preview/productos-v3.html` (autoridad visual).
 *
 * **Lo que se muestra y NO está en la base, porque se deriva:**
 *   - *Margen* = (precio − costo) / precio. Con Decimal, nunca con Number:
 *     es un porcentaje de dinero y CLAUDE.md §9.8 lo prohíbe. Es además el
 *     número que después alimenta el guard de márgenes de Ofertas.
 *   - *Estado* (OK / Stock bajo / Sin stock) = `stock_current` vs
 *     `stock_minimum`. Sin umbral definido no se avisa nada: "sin mínimo" no
 *     es lo mismo que "stock bajo".
 *   - *Color del rubro* = derivado del NOMBRE del rubro. Mismo rubro → mismo
 *     color, siempre, sin guardar ni sincronizar una columna de color.
 *
 * **Lo que la maqueta muestra y acá NO está, a propósito:**
 *   - Foto del producto: necesita el flujo de subida a Storage completo. La
 *     maqueta ya trae el fallback de inicial con color y es el que se usa.
 *   - "★ Más vendido": NO es un favorito marcado a mano, es una consulta sobre
 *     el histórico de ventas. Va con reportes, no con el producto. Guardarlo
 *     como booleano sería un dato que nace desactualizado.
 *   - Importación masiva: `csv-import.ts` existe pero es otra pantalla (con
 *     preview y errores por fila). Un botón acá prometería algo que no está.
 */
import { useMemo, useState, useTransition } from 'react';
import Decimal from 'decimal.js';
import { AppShell } from '@/components/shell/AppShell';
import { PRODUCTOS_CSS } from './productosCss';
import {
  adjustStockAction,
  createProductAction,
  getHistorialAction,
  updateProductAction,
  type ProductFormInput,
} from './actions';
import { AjusteStockModal, type ErrorDeAjuste } from './AjusteStockModal';
import { HistorialModal, type EstadoHistorial } from './HistorialModal';

export interface ProductoDTO {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  price: string;
  cost: string | null;
  stock_current: string;
  stock_minimum: string | null;
  tdf_exempt: boolean;
  /** Sin control de stock no se ajusta: el número no se movería. */
  stock_tracking_enabled: boolean;
  unit_type: string;
}

interface Props {
  productos: ProductoDTO[];
  cashierName: string;
  salePointLabel: string;
}

const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const fmt = (v: string | Decimal) => ARS.format(new Decimal(v).toNumber());

/**
 * Paleta de la maqueta. El rubro elige color por su NOMBRE, así que el mismo
 * rubro se ve igual en toda la app sin guardar nada. Un rubro nuevo entra solo.
 */
const COLORES = ['#6b5fff', '#5b8cff', '#ee6a8e', '#f7984a', '#34c77d', '#0e8f9e'];
function colorDeRubro(rubro: string | null): string {
  if (!rubro) return '#a8b0c5'; // sin rubro: gris, no un color de la paleta
  let h = 0;
  for (let i = 0; i < rubro.length; i++) h = (h * 31 + rubro.charCodeAt(i)) >>> 0;
  return COLORES[h % COLORES.length]!;
}

type Estado = { clase: 'ok' | 'warn' | 'err'; label: string };

function estadoDe(p: ProductoDTO): Estado {
  const stock = new Decimal(p.stock_current);
  if (stock.lte(0)) return { clase: 'err', label: 'Sin stock' };
  // Sin umbral NO se avisa: "sin mínimo definido" no es "stock bajo".
  if (p.stock_minimum !== null) {
    const min = new Decimal(p.stock_minimum);
    if (min.gt(0) && stock.lte(min)) return { clase: 'warn', label: 'Stock bajo' };
  }
  return { clase: 'ok', label: 'OK' };
}

/** Margen sobre precio de venta. `null` si no hay costo cargado. */
function margenDe(p: ProductoDTO): Decimal | null {
  if (p.cost === null) return null;
  const precio = new Decimal(p.price);
  if (precio.lte(0)) return null;
  return precio.minus(p.cost).dividedBy(precio).times(100);
}

export function ProductosClient({ productos, cashierName, salePointLabel }: Props) {
  const [lista, setLista] = useState<ProductoDTO[]>(productos);
  const [rubroActivo, setRubroActivo] = useState<string>('Todos');
  const [busqueda, setBusqueda] = useState('');
  const [selId, setSelId] = useState<string | null>(productos[0]?.id ?? null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<ProductoDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ajustando, setAjustando] = useState<ProductoDTO | null>(null);
  const [errorAjuste, setErrorAjuste] = useState<ErrorDeAjuste | null>(null);
  const [historialDe, setHistorialDe] = useState<ProductoDTO | null>(null);
  const [historial, setHistorial] = useState<EstadoHistorial>({ estado: 'cargando' });

  /** Rubros que existen de verdad en el catálogo (no una lista inventada). */
  const rubros = useMemo(() => {
    const set = new Set<string>();
    for (const p of lista) if (p.category) set.add(p.category);
    return ['Todos', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))];
  }, [lista]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return lista.filter((p) => {
      if (rubroActivo !== 'Todos' && p.category !== rubroActivo) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? '').toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q)
      );
    });
  }, [lista, rubroActivo, busqueda]);

  /**
   * KPIs de la maqueta. Los cuatro se DERIVAN del catálogo que ya está en
   * memoria — ninguno necesita una consulta nueva ni una columna nueva.
   *
   * OJO con el que NO está: la maqueta muestra "+4,2% vs mes anterior" con un
   * sparkline. Eso necesita el VALOR DEL STOCK DE MESES ANTERIORES, que hoy
   * no se guarda en ningún lado (habría que fotografiar el inventario
   * periódicamente). Poner una flechita verde inventada sería peor que no
   * ponerla: es un número sobre el que el comerciante tomaría decisiones.
   */
  const kpis = useMemo(() => {
    let valor = new Decimal(0);
    let bajoMinimo = 0;
    let sinStock = 0;
    for (const p of lista) {
      // Valor de stock = a COSTO, no a precio de venta: es lo que el comercio
      // tiene inmovilizado, no lo que espera facturar. Sin costo cargado el
      // producto no suma (no se estima).
      if (p.cost !== null) {
        valor = valor.plus(new Decimal(p.stock_current).times(p.cost));
      }
      const est = estadoDe(p);
      if (est.clase === 'err') sinStock++;
      else if (est.clase === 'warn') bajoMinimo++;
    }
    const sinCosto = lista.filter((p) => p.cost === null).length;
    return { valor, bajoMinimo, sinStock, sinCosto };
  }, [lista]);

  /**
   * Reposicion sugerida: que hay que comprar, ordenado por urgencia.
   *
   * **La cantidad es una REGLA SIMPLE Y DECLARADA, no una prediccion.**
   * Sugerido = llegar al doble del minimo (2 x minimo - stock actual). Se
   * eligio asi porque es explicable y el comerciante puede discutirla.
   *
   * Lo honesto es decir lo que NO contempla: rotacion (que tan rapido se
   * vende), plazo de entrega del proveedor y compra minima. Ninguno de esos
   * datos se mide todavia, y sin ellos una formula mas sofisticada seria
   * precision falsa. La pantalla lo aclara abajo de la lista.
   *
   * Un producto SIN minimo definido no entra: sin referencia no hay nada que
   * sugerir. Es la misma regla que usa estadoDe().
   */
  const reposicion = useMemo(() => {
    const items: Array<{
      producto: ProductoDTO;
      sugerido: number;
      detalle: string;
      urgencia: number;
    }> = [];
    for (const p of lista) {
      if (p.stock_minimum === null) continue;
      const min = new Decimal(p.stock_minimum);
      if (min.lte(0)) continue;
      const stock = new Decimal(p.stock_current);
      if (stock.gt(min)) continue;

      const sugerido = min.times(2).minus(stock);
      if (sugerido.lte(0)) continue;

      const sinStock = stock.lte(0);
      items.push({
        producto: p,
        sugerido: Math.ceil(sugerido.toNumber()),
        detalle: sinStock
          ? "Sin stock"
          : stock.toFixed(0) + " u \u00b7 m\u00edn " + min.toFixed(0),
        // Primero lo que esta en cero; despues, lo mas lejos de su minimo.
        urgencia: sinStock ? 0 : stock.dividedBy(min).toNumber(),
      });
    }
    return items.sort((a, b) => a.urgencia - b.urgencia);
  }, [lista]);

  const sel = lista.find((p) => p.id === selId) ?? null;

  function guardar(form: ProductFormInput) {
    setError(null);
    startTransition(async () => {
      const res = editando
        ? await updateProductAction(editando.id, form)
        : await createProductAction(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const guardado = res.data;
      const dto: ProductoDTO = {
        id: guardado.id,
        name: guardado.name,
        sku: guardado.sku,
        barcode: guardado.barcode,
        category: guardado.category,
        price: guardado.price,
        cost: guardado.cost,
        stock_current: guardado.stock_current,
        stock_minimum: guardado.stock_minimum,
        tdf_exempt: guardado.tdf_exempt,
        stock_tracking_enabled: guardado.stock_tracking_enabled,
        unit_type: guardado.unit_type,
      };
      setLista((prev) =>
        editando ? prev.map((p) => (p.id === dto.id ? dto : p)) : [dto, ...prev]
      );
      setSelId(dto.id);
      setModalAbierto(false);
      setEditando(null);
    });
  }

  function ajustar(input: { delta: string; motivo: string; detalle?: string }) {
    if (!ajustando) return;
    const producto = ajustando;
    setErrorAjuste(null);
    startTransition(async () => {
      const res = await adjustStockAction({ productId: producto.id, ...input });
      if (!res.ok) {
        // Los errores de campo van debajo del campo; los otros (no alcanza el
        // stock, producto dado de baja) como aviso del modal.
        setErrorAjuste({ mensaje: res.error, campos: res.fieldErrors });
        return;
      }
      setLista((prev) =>
        prev.map((p) =>
          p.id === producto.id ? { ...p, stock_current: res.data.stock_current } : p
        )
      );
      setAjustando(null);
    });
  }

  // Se pide al abrir, desde el click: no en un efecto (setState sincrónico
  // dentro de un efecto es la regla de lint que ya se rompió en /gastos).
  function abrirHistorial(producto: ProductoDTO) {
    setHistorialDe(producto);
    setHistorial({ estado: 'cargando' });
    void getHistorialAction(producto.id).then((res) => {
      setHistorial(
        res.ok
          ? { estado: 'listo', data: res.data }
          : { estado: 'error', mensaje: res.error }
      );
    });
  }

  const contenido = (
    <>
      <style>{PRODUCTOS_CSS}</style>

      {/* Barra de título de la maqueta: identifica la pantalla y da el conteo
          real (no un número inventado). */}
      <div className="bar">
        <div className="bar-id">
          {/* El icono de caja de la maqueta. Sin el, la barra medía 77px
              contra los 78 de la maqueta: es el elemento más alto de la
              fila. */}
          <span className="bar-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
          </span>
          <div>
            <div className="bar-title">Productos</div>
            <div className="bar-sub">
              Catálogo · <b>{lista.length} productos</b> ·{' '}
              {rubros.length - 1 === 1 ? '1 rubro' : `${rubros.length - 1} rubros`}
            </div>
          </div>
        </div>
        <div className="bar-actions">
          {/* La importacion masiva TIENE service (csv-import.ts) pero no
              pantalla: necesita subir el archivo, previsualizar, y resolver
              errores fila por fila (SKU repetido, precio invalido). Se muestra
              apagada con el motivo en vez de abrir algo a medias. */}
          <button
            type="button"
            className="b ghost"
            disabled
            title="Falta la pantalla de importacion (preview + errores por fila)"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M4 21h16" />
            </svg>
            Importar
          </button>
          <button
            type="button"
            className="b primary"
            onClick={() => {
              setEditando(null);
              setModalAbierto(true);
            }}
            disabled={pending}
          >
            + Nuevo producto
          </button>
        </div>
      </div>


      {/* KPIs — los 4 salen del catálogo en memoria, sin consultas nuevas. */}
      <div className="kpis">
        <div className="k lead">
          <div className="k-k">Valor de stock</div>
          <div className="k-v">{fmt(kpis.valor)}</div>
          <div className="k-f">
            a costo
            {kpis.sinCosto > 0
              ? ` · ${kpis.sinCosto} sin costo cargado`
              : ''}
          </div>
        </div>
        <div className="k">
          <div className="k-k">Productos activos</div>
          <div className="k-v">{lista.length}</div>
          <div className="k-f">
            en {rubros.length - 1 === 1 ? '1 rubro' : `${rubros.length - 1} rubros`}
          </div>
        </div>
        <div className="k warn">
          <div className="k-k">
            <span className="d" style={{ background: 'var(--orange)' }} />
            Bajo mínimo
          </div>
          <div className="k-v">{kpis.bajoMinimo}</div>
          <div className="k-f">
            {kpis.bajoMinimo > 0 ? <span className="tag warn">reponer</span> : '—'}
          </div>
        </div>
        <div className="k bad">
          <div className="k-k">
            <span className="d" style={{ background: 'var(--red)' }} />
            Sin stock
          </div>
          <div className="k-v">{kpis.sinStock}</div>
          <div className="k-f">
            {kpis.sinStock > 0 ? <span className="tag bad">urgente</span> : '—'}
          </div>
        </div>
      </div>

      <div className="cli-head">
        <div className="seg glass">
          {rubros.map((r) => (
            <button
              key={r}
              type="button"
              className={rubroActivo === r ? 'on' : undefined}
              onClick={() => setRubroActivo(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="search glass" style={{ maxWidth: 320 }}>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto, SKU o código…"
            aria-label="Buscar producto"
          />
        </div>
      </div>

      {error ? (
        <div className="card glass" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="cli-grid">
        {/* ── Lista maestra ── */}
        <div className="card glass" style={{ padding: '6px 6px 10px' }}>
          <div className="card-title" style={{ padding: '13px 16px 11px' }}>
            <h3>Catálogo</h3>
            <span className="label-sm">
              {visibles.length} de {lista.length}
            </span>
          </div>

          <div className="cl-colhead">
            <span style={{ width: 50 }} />
            <span style={{ flex: 1 }}>Producto</span>
            <span style={{ width: 104 }}>Rubro</span>
            <span style={{ width: 80, textAlign: 'right' }}>Precio</span>
            <span style={{ width: 56, textAlign: 'right' }}>Margen</span>
            <span style={{ width: 74, textAlign: 'right' }}>Stock</span>
            <span style={{ width: 96, textAlign: 'center' }}>Estado</span>
            {/* Hueco del chevron de la fila. Sin él el encabezado tiene un
                elemento menos que la fila, el flex:1 de "Producto" se estira
                16px+13 de gap de más, y TODAS las columnas de la derecha
                quedan 28px corridas respecto de su título. */}
            <span style={{ width: 16 }} />
          </div>

          <div className="cl-list">
            {visibles.length === 0 ? (
              <p className="label-sm" style={{ padding: 16 }}>
                {lista.length === 0
                  ? 'Todavía no hay productos cargados.'
                  : 'Ningún producto coincide con el filtro.'}
              </p>
            ) : (
              visibles.map((p) => {
                const est = estadoDe(p);
                const margen = margenDe(p);
                const color = colorDeRubro(p.category);
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={p.id === selId ? 'prow sel' : 'prow'}
                    onClick={() => setSelId(p.id)}
                  >
                    <span className="pthumbwrap">
                      {/* Sin foto: inicial con el color del rubro, igual que
                          la maqueta para los productos sin imagen. */}
                      <span
                        className="pthumb"
                        style={{ color, background: `${color}14` }}
                      >
                        {p.name.charAt(0).toUpperCase()}
                      </span>
                    </span>
                    <div className="clmain">
                      <div className="clname">
                        {p.name}
                        {p.tdf_exempt ? <span className="ley19">19.640</span> : null}
                      </div>
                      <div className="clid">{p.sku ?? p.barcode ?? 'sin código'}</div>
                    </div>
                    <span
                      className="pill"
                      style={{ background: `${color}14`, color }}
                    >
                      {p.category ?? 'Sin rubro'}
                    </span>
                    <span className="pprecio tnum">{fmt(p.price)}</span>
                    <span className="pmargen">
                      {margen === null ? '—' : `${margen.toFixed(0)}%`}
                    </span>
                    <span className="pstock tnum">
                      {new Decimal(p.stock_current).toFixed(0)}
                      {p.stock_minimum !== null ? (
                        <i> / {new Decimal(p.stock_minimum).toFixed(0)}</i>
                      ) : null}
                    </span>
                    <span className={`estado ${est.clase}`}>
                      <span className="d" />
                      {est.label}
                    </span>
                    <svg className="clgo" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                );
              })
            )}
          </div>

        </div>

        {/* ── Detalle ── */}
        <aside className="col-side" style={{ width: 'auto' }}>
          <div className="card glass cdetail">
          {sel === null ? (
            <p className="label-sm">Elegí un producto para ver el detalle.</p>
          ) : (
            <>
              <div>
                <div className="cd-name">{sel.name}</div>
                <div className="cd-id">{sel.sku ?? sel.barcode ?? 'sin código'}</div>
                <div
                  style={{
                    marginTop: 10,
                    display: 'flex',
                    gap: 7,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    className="pill"
                    style={{
                      background: `${colorDeRubro(sel.category)}14`,
                      color: colorDeRubro(sel.category),
                    }}
                  >
                    {sel.category ?? 'Sin rubro'}
                  </span>
                  {sel.tdf_exempt ? (
                    <span className="ley19 big">Exento · Ley 19.640</span>
                  ) : null}
                </div>
              </div>

              {/* Grilla de 3 de la maqueta (.cd-stats) para lo que se
                  compara de un vistazo, y filas .kv para el stock. */}
              <div className="cd-stats">
                <div>
                  <div className="upper-mini">Precio</div>
                  <div className="tnum cd-sv">{fmt(sel.price)}</div>
                </div>
                <div>
                  <div className="upper-mini">Costo</div>
                  <div className="tnum cd-sv">
                    {sel.cost === null ? '—' : fmt(sel.cost)}
                  </div>
                </div>
                <div>
                  <div className="upper-mini">Margen</div>
                  <div className="tnum cd-sv">
                    {margenDe(sel) === null ? '—' : `${margenDe(sel)!.toFixed(1)}%`}
                  </div>
                </div>
              </div>

              {/* Barra de stock de la maqueta. El ancho es el stock actual
                  medido contra el mínimo (llena = el doble del mínimo o más),
                  y el color sale del MISMO estado que la lista, para que no
                  puedan contradecirse. Sin mínimo definido no hay referencia
                  contra la cual dibujar: se muestra la barra neutra. */}
              {(() => {
                const est = estadoDe(sel);
                const actual = new Decimal(sel.stock_current);
                const min =
                  sel.stock_minimum === null ? null : new Decimal(sel.stock_minimum);
                const pct =
                  min !== null && min.gt(0)
                    ? Math.min(100, actual.dividedBy(min.times(2)).times(100).toNumber())
                    : actual.gt(0)
                      ? 100
                      : 0;
                const color =
                  est.clase === 'err'
                    ? 'var(--red)'
                    : est.clase === 'warn'
                      ? 'var(--orange)'
                      : 'var(--green)';
                return (
                  <div style={{ marginTop: 14 }}>
                    <div className="kv" style={{ padding: 0 }}>
                      <span className="upper-mini">Stock</span>
                      <b className="tnum" style={{ fontSize: 17 }}>
                        {actual.toFixed(0)} u
                      </b>
                    </div>
                    <div className="pd-bar">
                      <i style={{ width: `${Math.max(pct, 2)}%`, background: color }} />
                    </div>
                    <div className="label-sm">
                      {min === null
                        ? 'sin mínimo definido'
                        : `mínimo ${min.toFixed(0)} u`}
                    </div>
                  </div>
                );
              })()}

              <div className="kv" style={{ marginTop: 6 }}>
                <span className="label-sm">Estado</span>
                <span className={`estado ${estadoDe(sel).clase}`}>
                  <span className="d" />
                  {estadoDe(sel).label}
                </span>
              </div>

              <div className="cd-btns">
                <button
                  type="button"
                  className="cta"
                  style={{ flex: 1, fontSize: 13, padding: 11 }}
                  onClick={() => {
                    setEditando(sel);
                    setModalAbierto(true);
                  }}
                  disabled={pending}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                  Editar
                </button>
                {/* Ajustar: sin control de stock no se ofrece, porque el
                    movimiento se registraría y el número no se movería — el
                    modal diría "28 → 26" y mentiría. Se dice por qué. */}
                <button
                  type="button"
                  className="hbtn"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => {
                    setErrorAjuste(null);
                    setAjustando(sel);
                  }}
                  disabled={pending || !sel.stock_tracking_enabled}
                  // "Ajustar", no "Ajustar stock": en la columna lateral el
                  // texto largo se partía en dos líneas y desparejaba los tres
                  // botones (medido en la captura). La barra de stock está
                  // justo arriba, así que el contexto no se pierde.
                  aria-label="Ajustar stock"
                  title={
                    sel.stock_tracking_enabled
                      ? 'Ajustar stock'
                      : 'Este producto no lleva control de stock'
                  }
                >
                  Ajustar
                </button>
                <button
                  type="button"
                  className="hbtn"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => abrirHistorial(sel)}
                >
                  Historial
                </button>
              </div>
            </>
          )}
          </div>

          {/* ── Reposición sugerida ─────────────────────────────────────
              Es la lista de lo que hay que comprar, ordenada por urgencia:
              primero lo que está en cero, después lo que está por debajo del
              mínimo. Sale del mismo `estadoDe()` que la lista y los KPIs, así
              que los tres no pueden contradecirse. */}
          {reposicion.length > 0 ? (
            <div className="card glass">
              <div className="card-title">
                <h3>
                  <span
                    className="ic"
                    style={{ background: 'rgba(247,152,74,0.14)', color: '#b96c1a' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="8" cy="21" r="1" />
                      <circle cx="19" cy="21" r="1" />
                      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
                    </svg>
                  </span>
                  Reposición sugerida
                </h3>
                <span
                  className="pill"
                  style={{ background: 'rgba(247,152,74,0.16)', color: '#b96c1a' }}
                >
                  {reposicion.length}
                </span>
              </div>

              {reposicion.slice(0, 6).map((r) => {
                const color = colorDeRubro(r.producto.category);
                return (
                  <button
                    type="button"
                    key={r.producto.id}
                    className="stock-row"
                    onClick={() => setSelId(r.producto.id)}
                  >
                    <span
                      className="rthumb"
                      style={{ color, background: `${color}14` }}
                    >
                      {r.producto.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="stock-name">
                      {r.producto.name}
                      <span
                        style={{
                          display: 'block',
                          fontSize: 10.5,
                          color: 'var(--ink-3)',
                          fontWeight: 400,
                        }}
                      >
                        {r.detalle}
                      </span>
                    </div>
                    <span className="repoped">{r.sugerido} u</span>
                  </button>
                );
              })}

              {reposicion.length > 6 ? (
                <div className="label-sm" style={{ marginTop: 8 }}>
                  y {reposicion.length - 6} más
                </div>
              ) : null}

              {/* De dónde sale el número: se dice, no se deja adivinar. El
                  comerciante tiene que poder discutirlo. */}
              <div className="pm-note" style={{ margin: '10px 0 0' }}>
                Sugerido para llegar al <b>doble del mínimo</b>. No contempla
                rotación ni plazo del proveedor — todavía no se miden.
              </div>

              {/* No existe el módulo de órdenes de compra. Un botón que no
                  hace nada es peor que decirlo. */}
              <button
                type="button"
                className="quick"
                disabled
                title="Todavía no existe el módulo de órdenes de compra"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  marginTop: 10,
                  padding: 11,
                  fontWeight: 600,
                  color: 'var(--ink-1)',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="20" r="1.4" />
                  <circle cx="18" cy="20" r="1.4" />
                  <path d="M2 3h3l2.4 12.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.3L22 7H6" />
                </svg>
                Generar orden de compra
              </button>
            </div>
          ) : null}
        </aside>
      </div>

      {modalAbierto ? (
        <ProductoModal
          producto={editando}
          rubrosExistentes={rubros.filter((r) => r !== 'Todos')}
          pending={pending}
          onCancelar={() => {
            setModalAbierto(false);
            setEditando(null);
          }}
          onGuardar={guardar}
        />
      ) : null}

      {ajustando ? (
        <AjusteStockModal
          producto={ajustando}
          pending={pending}
          error={errorAjuste}
          onCancelar={() => setAjustando(null)}
          onConfirmar={ajustar}
        />
      ) : null}

      {historialDe ? (
        <HistorialModal
          productoNombre={historialDe.name}
          historial={historial}
          onCerrar={() => setHistorialDe(null)}
        />
      ) : null}
    </>
  );

  return (
    // `scroll="pagina"`, como Caja. Productos es pantalla de GESTIÓN, no de
    // operación: se lee, se compara y se edita, y el contenido pasa el alto
    // del viewport (KPIs + lista + detalle + reposición).
    //
    // Estaba en 'fijo' y la tarjeta de Reposición quedaba INALCANZABLE: la
    // columna lateral llegaba a 1213px en un viewport de 848 y nada
    // scrolleaba. Medido, no supuesto (ordenVisible.dentro === false). Es el
    // mismo error que ya se cometió en Caja: aplicarle el modelo del POS a una
    // pantalla que no es el POS.
    //
    // El ítem activo del sidebar lo resuelve el shell con usePathname.
    <AppShell
      storeName={salePointLabel}
      userName={cashierName}
      userRole="Cajero"
      afipConnected={false}
      afipDetail="WSFEv1 · sin certificado"
      scroll="pagina"
    >
      {contenido}
    </AppShell>
  );
}

// ════════════════════════ Modal alta / edición ════════════════════════

interface ModalProps {
  producto: ProductoDTO | null;
  rubrosExistentes: string[];
  pending: boolean;
  onCancelar: () => void;
  onGuardar: (form: ProductFormInput) => void;
}

function ProductoModal({
  producto,
  rubrosExistentes,
  pending,
  onCancelar,
  onGuardar,
}: ModalProps) {
  const [form, setForm] = useState<ProductFormInput>({
    name: producto?.name ?? '',
    sku: producto?.sku ?? '',
    category: producto?.category ?? '',
    price: producto?.price ?? '',
    cost: producto?.cost ?? '',
    stock_current: producto?.stock_current ?? '0',
    stock_minimum: producto?.stock_minimum ?? '',
    tdf_exempt: producto?.tdf_exempt ?? false,
  });
  /** El <select> de rubro cambia a texto libre al elegir "+ Nuevo rubro". */
  const [rubroLibre, setRubroLibre] = useState(
    producto?.category !== undefined &&
      producto?.category !== null &&
      !rubrosExistentes.includes(producto.category)
  );

  const set = <K extends keyof ProductFormInput>(k: K, v: ProductFormInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  /**
   * Cálculo en vivo, igual que la maqueta. Los tres números salen de precio y
   * costo, no hace falta guardar nada:
   *   ganancia = precio − costo
   *   margen   = ganancia / PRECIO   (cuánto del precio es ganancia)
   *   markup   = ganancia / COSTO    (cuánto se le recarga al costo)
   *
   * Margen y markup NO son lo mismo y confundirlos es un error caro: un 50%
   * de markup es 33% de margen. La maqueta muestra los dos a propósito.
   *
   * Con Decimal: es plata, y CLAUDE.md §9.8 prohíbe Number en ese camino.
   */
  const num = (v: string | undefined): Decimal | null => {
    const t = (v ?? '').trim();
    if (t === '') return null;
    try {
      const d = new Decimal(t);
      return d.isFinite() ? d : null;
    } catch {
      return null;
    }
  };

  const precio = num(form.price);
  const costo = num(form.cost);
  const ganancia = precio !== null && costo !== null ? precio.minus(costo) : null;
  const margen =
    ganancia !== null && precio !== null && precio.gt(0)
      ? ganancia.dividedBy(precio).times(100)
      : null;
  const markup =
    ganancia !== null && costo !== null && costo.gt(0)
      ? ganancia.dividedBy(costo).times(100)
      : null;
  const bajoCosto = ganancia !== null && ganancia.lt(0);

  return (
    <>
      {/* .pmov es el overlay de la maqueta Y el que centra (es flex). Sin
          `glass-strong`: .pmod ya trae fondo, borde, radio y sombra propios,
          y glass-strong le pisaba el radio 22 con uno de 20. */}
      <div className="pmov open" onClick={onCancelar}>
        <div
          className="pmod"
          role="dialog"
          aria-modal="true"
          aria-label={producto ? 'Editar producto' : 'Nuevo producto'}
          onClick={(e) => e.stopPropagation()}
        >
        <div className="pm-head">
          <div>
            <div className="pm-title">
              {producto ? 'Editar producto' : 'Nuevo producto'}
            </div>
            <div className="pm-sub">
              El costo define el margen — y alimenta el guard de las promos.
            </div>
          </div>
          <button
            type="button"
            className="pm-x"
            onClick={onCancelar}
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="pm-fld">
          <label htmlFor="pmName">Nombre del producto</label>
          <input
            id="pmName"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Ej: Coca-Cola 2,25L"
          />
        </div>

        {/* Foto: la maqueta tiene acá una zona de arrastre. Todavía no existe
            el flujo de subida (bucket por tenant, validación de tipo y peso,
            borrado al reemplazar), así que se muestra APAGADA con el motivo en
            vez de un recuadro que no hace nada. Un control que promete algo
            que no funciona es peor que no tenerlo. */}
        <div className="pm-fld">
          <label>Foto del producto</label>
          <div className="pm-photo" data-off="1" aria-disabled="true">
            <div className="pm-photo-empty">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <div>
                <div>Subir foto — todavía no disponible</div>
                <small>Mientras tanto se muestra la inicial del producto.</small>
              </div>
            </div>
          </div>
        </div>

        <div className="pm-row">
          <div className="pm-fld">
            <label htmlFor="pmRubro">Rubro</label>
            {rubroLibre ? (
              <input
                id="pmRubro"
                value={form.category ?? ''}
                onChange={(e) => set('category', e.target.value)}
                placeholder="Nombre del rubro nuevo"
                autoFocus
              />
            ) : (
              <select
                id="pmRubro"
                value={form.category ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__nuevo__') {
                    setRubroLibre(true);
                    set('category', '');
                    return;
                  }
                  set('category', e.target.value);
                }}
              >
                <option value="">Sin rubro</option>
                {rubrosExistentes.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                {/* Los rubros los inventa cada comercio: una lista cerrada
                    dejaría afuera a la ferretería que no vende Golosinas. */}
                <option value="__nuevo__">+ Nuevo rubro…</option>
              </select>
            )}
          </div>
          <div className="pm-fld">
            <label htmlFor="pmSku">Código / SKU</label>
            <input
              id="pmSku"
              value={form.sku ?? ''}
              onChange={(e) => set('sku', e.target.value)}
              placeholder="779…"
            />
          </div>
        </div>

        <div className="pm-row">
          <div className="pm-fld">
            <label htmlFor="pmPrecio">Precio de venta</label>
            <input
              id="pmPrecio"
              inputMode="decimal"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="pm-fld">
            <label htmlFor="pmCosto">Costo</label>
            <input
              id="pmCosto"
              inputMode="decimal"
              value={form.cost ?? ''}
              onChange={(e) => set('cost', e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        {bajoCosto ? (
          <div className="pm-warn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            <span>El precio está por debajo del costo.</span>
          </div>
        ) : null}

        {/* Los tres números en vivo. Es lo que convierte esta pantalla en algo
            útil: el comerciante ve el margen MIENTRAS pone el precio, no
            después. */}
        <div className="pm-prev">
          <div className="pc">
            <div className="pk">Ganancia unit.</div>
            <div className="pv">{ganancia === null ? '—' : fmt(ganancia)}</div>
          </div>
          <div className="pc">
            <div className="pk">Margen</div>
            <div className={bajoCosto ? 'pv mgbad' : 'pv mgok'}>
              {margen === null ? '—' : `${margen.toFixed(1)}%`}
            </div>
          </div>
          <div className="pc">
            <div className="pk">Markup</div>
            <div className="pv">
              {markup === null ? '—' : `${markup.toFixed(1)}%`}
            </div>
          </div>
        </div>

        <div className="pm-note">
          Este margen es el que usa el <b>guard de Ofertas</b>: si una promo baja
          el precio por debajo del costo, te avisa antes de activarla.
        </div>

        <div className="pm-row">
          <div className="pm-fld">
            <label htmlFor="pmStock">Stock actual</label>
            <input
              id="pmStock"
              inputMode="decimal"
              value={form.stock_current ?? ''}
              onChange={(e) => set('stock_current', e.target.value)}
              placeholder="0"
              disabled={producto !== null}
            />
            {producto !== null ? (
              <small className="pm-note">
                El stock no se edita acá: se ajusta con un movimiento y su
                motivo, para que quede el rastro de por qué cambió.
              </small>
            ) : null}
          </div>
          <div className="pm-fld">
            <label htmlFor="pmMin">Stock mínimo</label>
            <input
              id="pmMin"
              inputMode="decimal"
              value={form.stock_minimum ?? ''}
              onChange={(e) => set('stock_minimum', e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        {/* Ley 19.640 — es fiscal, no cosmético: decide si el producto va como
            exento en el comprobante. Por eso está en el alta y no escondido. */}
        <label className="pm-check">
          <input
            type="checkbox"
            checked={form.tdf_exempt ?? false}
            onChange={(e) => set('tdf_exempt', e.target.checked)}
          />
          <span>
            Exento por Ley 19.640 <i>(mercadería amparada en Tierra del Fuego)</i>
          </span>
        </label>

        {/* .pm-btn, no .b: es la clase de boton del modal en la maqueta.
            Ojo que .b esta DUPLICADA (botones y barras de grafico). */}
        <div className="pm-acts">
          <button type="button" className="pm-btn ghost" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className="pm-btn primary"
            onClick={() => {
              // El stock sólo viaja en el alta; al editar se ajusta aparte.
              const payload: ProductFormInput = producto
                ? { ...form, stock_current: undefined }
                : form;
              onGuardar(payload);
            }}
            disabled={pending || form.name.trim() === '' || form.price.trim() === ''}
          >
            {pending ? 'Guardando…' : 'Guardar producto'}
          </button>
        </div>
        </div>
      </div>
    </>
  );
}
