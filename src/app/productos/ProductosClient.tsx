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
  createProductAction,
  updateProductAction,
  type ProductFormInput,
} from './actions';

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
      };
      setLista((prev) =>
        editando ? prev.map((p) => (p.id === dto.id ? dto : p)) : [dto, ...prev]
      );
      setSelId(dto.id);
      setModalAbierto(false);
      setEditando(null);
    });
  }

  const contenido = (
    <>
      <style>{PRODUCTOS_CSS}</style>

      {/* Barra de título de la maqueta: identifica la pantalla y da el conteo
          real (no un número inventado). */}
      <div className="bar">
        <div className="bar-id">
          <div>
            <div className="bar-title">Productos</div>
            <div className="bar-sub">
              Catálogo · <b>{lista.length} productos</b> ·{' '}
              {rubros.length - 1 === 1 ? '1 rubro' : `${rubros.length - 1} rubros`}
            </div>
          </div>
        </div>
        <div className="bar-actions">
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

              <div className="kv">
                <span className="label-sm">Stock actual</span>
                <b className="tnum">{new Decimal(sel.stock_current).toFixed(0)}</b>
              </div>
              <div className="kv">
                <span className="label-sm">Stock mínimo</span>
                <b className="tnum">
                  {sel.stock_minimum === null
                    ? 'sin definir'
                    : new Decimal(sel.stock_minimum).toFixed(0)}
                </b>
              </div>
              <div className="kv">
                <span className="label-sm">Estado</span>
                <span className={`estado ${estadoDe(sel).clase}`}>
                  <span className="d" />
                  {estadoDe(sel).label}
                </span>
              </div>

              <div className="cd-btns">
              <button
                type="button"
                className="b ghost"
                style={{ flex: 1 }}
                onClick={() => {
                  setEditando(sel);
                  setModalAbierto(true);
                }}
                disabled={pending}
              >
                Editar producto
              </button>
              </div>
            </>
          )}
          </div>
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
    </>
  );

  return (
    // `scroll="fijo"`: Productos es pantalla de operación, la lista scrollea
    // por dentro. El ítem activo del sidebar lo resuelve el shell con
    // usePathname, no hace falta pasarlo.
    <AppShell
      storeName={salePointLabel}
      userName={cashierName}
      userRole="Cajero"
      afipConnected={false}
      afipDetail="WSFEv1 · sin certificado"
      scroll="fijo"
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

  const set = <K extends keyof ProductFormInput>(k: K, v: ProductFormInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <div className="pm-backdrop" onClick={onCancelar} />
      <div className="pm glass-strong" role="dialog" aria-modal="true">
        <h2 className="pm-title">
          {producto ? 'Editar producto' : 'Nuevo producto'}
        </h2>

        <div className="pm-fld">
          <label htmlFor="pmName">Nombre del producto</label>
          <input
            id="pmName"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Ej: Coca-Cola 2,25L"
          />
        </div>

        <div className="pm-row">
          <div className="pm-fld">
            <label htmlFor="pmRubro">Rubro</label>
            {/* Lista + texto libre: el comercio inventa sus rubros, pero los
                que ya usa aparecen para no escribirlos distinto cada vez
                ("Bebidas" vs "bebidas" serían dos rubros). */}
            <input
              id="pmRubro"
              list="rubros-existentes"
              value={form.category ?? ''}
              onChange={(e) => set('category', e.target.value)}
              placeholder="Ej: Bebidas"
            />
            <datalist id="rubros-existentes">
              {rubrosExistentes.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
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
              <small className="pm-hint">
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

        <div className="pm-acts">
          <button type="button" className="pm-cancel" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className="cobrar"
            onClick={() => {
              // El stock sólo viaja en el alta; al editar se ajusta aparte.
              const payload: ProductFormInput = producto
                ? { ...form, stock_current: undefined }
                : form;
              onGuardar(payload);
            }}
            disabled={pending || form.name.trim() === '' || form.price.trim() === ''}
          >
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </>
  );
}
