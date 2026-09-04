'use client';

/**
 * POSClient — el POS funcional. Carrito interactivo que llama las Server
 * Actions ya probadas (T-POS-ACTION-01).
 *
 * VISUAL (2026-09-03): montado sobre <AppShell> y usando las clases de la
 * MAQUETA (`pos-preview/checkpoint-v19-top-tools.html`) — `.catalog`, `.grid`,
 * `.card`, `.cart`, `.item`, `.summary`, `.total`, `.cobrar`. Antes seguía
 * `docs/POS-DESIGN-V1.1-DIRECTION.md` y quedaba sin sidebar ni topbar: el owner
 * entró y no reconoció el producto. La maqueta es la autoridad visual; el doc
 * del repo NO.
 *
 * La LÓGICA no cambió en este reskin: mismo flujo, mismas actions, mismos
 * cálculos de preview.
 *
 * Flujo happy-path F0: click producto → (crea draft si no hay) addItem →
 * carrito + preview total → elegir medio (efectivo/débito/crédito/QR) → Cobrar
 * → finalize con idempotency_key por intento → venta cobrada → reset.
 *
 * Money preview client-side: agrega los line_total/line_subtotal/line_tax que
 * el SERVER ya calculó por ítem (ADR-0021 — cliente muestra preview, server es
 * autoridad). Usa Decimal.js para las sumas (nunca Number en money).
 */
import { useEffect, useMemo, useState, useTransition } from 'react';
import Decimal from 'decimal.js';
import { AppShell } from '@/components/shell/AppShell';
import {
  startSaleAction,
  addItemAction,
  removeItemAction,
  finalizeSaleAction,
} from './actions';
import type { SaleWithItems } from '@/lib/services/sales/sale.service';
import type { SalePaymentMethod } from '@/lib/db/schema/_common';

/** Medios que el cajero puede elegir en el cobro (single-method F0). */
const PAY_OPTIONS: Array<{ key: SalePaymentMethod; label: string }> = [
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'debito', label: 'Débito' },
  { key: 'credito', label: 'Crédito' },
  { key: 'mp_qr', label: 'QR / MP' },
];

export interface PosProductDTO {
  id: string;
  name: string;
  sku: string | null;
  price: string;
  tax_rate: string;
  tdf_exempt: boolean;
  stock_current: string;
  /**
   * Umbral de reposición por producto — alimenta el badge "STOCK BAJO".
   * NULLABLE: un producto puede no tener mínimo definido, y en ese caso no
   * corresponde avisar nada (no es "stock bajo", es "sin umbral").
   */
  stock_minimum: string | null;
}

interface POSClientProps {
  products: PosProductDTO[];
  cashierName: string;
  salePointLabel: string;
  serverTimeIso: string;
}

const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
});
const fmt = (v: Decimal | string) => ARS.format(new Decimal(v).toNumber());

export function POSClient({
  products,
  cashierName,
  salePointLabel,
}: POSClientProps) {
  const [cart, setCart] = useState<SaleWithItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<SalePaymentMethod>('efectivo');
  const [pending, startTransition] = useTransition();

  /**
   * MODO CONSULTA (F2) — tocar un producto muestra precio y stock SIN meterlo
   * al carrito.
   *
   * El hueco que tapa: hoy, si un cliente pregunta "¿cuánto sale esto?", el
   * cajero escanea y el producto ENTRA a la venta; después tiene que acordarse
   * de sacarlo. Con cola de gente eso es fricción y ventas mal cobradas.
   *
   * La idea salió de ver Tango Facturador en un comercio real (2026-09-03):
   * le dedica una pantalla entera con atajo propio. Que el estándar del
   * mercado la tenga aparte confirma que es un flujo diario.
   *
   * Decisión de diseño: acá NO es una pantalla aparte sino un modo del POS.
   * El cajero no debería perder de vista la venta en curso para responder una
   * pregunta de mostrador. Por eso el carrito queda intacto y el modo se ve
   * distinto (banda ámbar) para que sea imposible confundirlo con vender.
   */
  const [modoConsulta, setModoConsulta] = useState(false);
  const [consultado, setConsultado] = useState<PosProductDTO | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setModoConsulta((v) => !v);
        setConsultado(null);
      }
      if (e.key === 'Escape' && modoConsulta) {
        setModoConsulta(false);
        setConsultado(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modoConsulta]);

  const items = cart?.items ?? [];
  const hasItems = items.length > 0;

  // ── Preview de totales (agrega lo que el server calculó por ítem) ──
  const totals = useMemo(() => {
    let neto = new Decimal(0); // subtotal gravado (no exento)
    let iva = new Decimal(0);
    let exento = new Decimal(0);
    let total = new Decimal(0);
    for (const it of items) {
      total = total.plus(it.line_total);
      if (it.tdf_exempt) {
        exento = exento.plus(it.line_total);
      } else {
        neto = neto.plus(it.line_subtotal);
        iva = iva.plus(it.line_tax);
      }
    }
    return { neto, iva, exento, total };
  }, [items]);

  function addProduct(productId: string) {
    setError(null);
    setToast(null);
    startTransition(async () => {
      let saleId = cart?.sale.id;
      if (!saleId) {
        const started = await startSaleAction();
        if (!started.ok) {
          setError(started.error);
          return;
        }
        saleId = started.data.id;
      }
      const res = await addItemAction({
        sale_id: saleId,
        product_id: productId,
        quantity: '1.0000',
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCart(res.data);
    });
  }

  function removeItem(itemId: string) {
    if (!cart) return;
    setError(null);
    startTransition(async () => {
      const res = await removeItemAction({ sale_id: cart.sale.id, item_id: itemId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCart(res.data);
    });
  }

  function charge() {
    if (!cart || !hasItems) return;
    setError(null);
    // idempotency_key por INTENTO de cobro — un retry del mismo cobro reusa
    // esta key (dedup, ADR-0010). Se genera al iniciar el intento.
    const key = crypto.randomUUID();
    const amount = totals.total.toFixed(4);
    startTransition(async () => {
      const res = await finalizeSaleAction({
        sale_id: cart.sale.id,
        payments: [{ method: payMethod, amount }],
        require_fiscal_invoice: false,
        idempotency_key: key,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const medio = PAY_OPTIONS.find((o) => o.key === payMethod)?.label ?? '';
      setToast(`Venta cobrada · ${medio} · ${fmt(totals.total)}`);
      setCart(null); // lista para la próxima venta
      setPayMethod('efectivo'); // vuelve al medio más común para la próxima
    });
  }

  // ════════════ CARRITO (columna derecha del shell) ════════════
  const carrito = (
    <aside className="cart glass">
      <div className="cart-head">
        <span className="cart-title">Venta actual</span>
        <span className="cart-count">
          {items.length === 1 ? '1 ítem' : `${items.length} ítems`}
        </span>
      </div>

      <div className="cust">
        <div className="cust-av">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div>
          <div className="cust-name">Consumidor final</div>
          <div className="cust-sub">Sin identificar · Ticket</div>
        </div>
      </div>

      <div className="items">
        {!hasItems ? (
          <div
            style={{
              padding: '28px 12px',
              textAlign: 'center',
              color: 'var(--ink-4)',
              fontSize: '12px',
              lineHeight: 1.6,
            }}
          >
            Carrito vacío
            <br />
            Tocá un producto para empezar.
          </div>
        ) : (
          items.map((it) => (
            <div className="item" key={it.id}>
              <div className="item-info">
                <div className="item-name">
                  {it.product_name_snapshot}
                  {/* Acá NO se puede usar .tag-tdf: es position:absolute y se
                      saldría de la fila. Chip inline con el mismo color. */}
                  {it.tdf_exempt ? (
                    <span
                      style={{
                        marginLeft: 6,
                        padding: '1px 5px',
                        borderRadius: 5,
                        fontSize: 8,
                        fontWeight: 800,
                        letterSpacing: '0.02em',
                        color: 'var(--tdf)',
                        background: 'rgba(20,150,120,0.10)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      19.640
                    </span>
                  ) : null}
                </div>
                <div className="item-sub">
                  {new Decimal(it.quantity).toNumber()} × {fmt(it.unit_price)}
                </div>
              </div>
              <div className="item-right">
                <span className="qty">{fmt(it.line_total)}</span>
                <button
                  type="button"
                  className="del"
                  onClick={() => removeItem(it.id)}
                  disabled={pending}
                  aria-label={`Quitar ${it.product_name_snapshot}`}
                  title="Quitar"
                >
                  ×
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="summary">
        <div className="srow">
          <span className="slabel">Subtotal</span>
          <span className="sval">{fmt(totals.neto)}</span>
        </div>
        <div className="srow">
          <span className="slabel">IVA contenido</span>
          <span className="sval">{fmt(totals.iva)}</span>
        </div>
        {totals.exento.greaterThan(0) ? (
          <div className="srow">
            <span className="slabel">Exento · Ley 19.640</span>
            <span className="sval">{fmt(totals.exento)}</span>
          </div>
        ) : null}
        <div className="total">
          <span className="total-label">Total</span>
          <span className="total-amt">{fmt(totals.total)}</span>
        </div>
      </div>

      {/* Selector de medio (single-method F0). El reparto multi-medio estilo
          lisCobro es una slice posterior. */}
      <div className="cats" style={{ padding: '0 14px 10px', flexWrap: 'wrap' }}>
        {PAY_OPTIONS.map((op) => (
          <button
            type="button"
            key={op.key}
            className={payMethod === op.key ? 'cat active' : 'cat'}
            onClick={() => setPayMethod(op.key)}
            disabled={pending}
          >
            {op.label}
          </button>
        ))}
      </div>

      <div className="pay">
        <button
          type="button"
          className="cobrar"
          onClick={charge}
          disabled={!hasItems || pending}
        >
          {pending ? (
            'Procesando…'
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="currentColor"
                aria-hidden
                style={{ marginRight: 6, verticalAlign: '-2px' }}
              >
                <path d="M13 2 3 14h7l-1 8 10-12h-7z" />
              </svg>
              Cobrar {fmt(totals.total)}
            </>
          )}
        </button>
      </div>
    </aside>
  );

  // ════════════ CATÁLOGO (columna del medio) ════════════
  return (
    <AppShell
      aside={carrito}
      storeName={salePointLabel}
      userName={cashierName}
      userRole="Cajero"
      afipConnected={false}
      afipDetail="WSFEv1 · sin certificado"
    >
      {(error || toast) && (
        <div
          className="glass"
          style={{
            flex: '0 0 auto',
            padding: '10px 14px',
            borderRadius: 14,
            fontSize: 12.5,
            color: error ? '#c0384a' : '#1f7a4d',
          }}
          role="status"
        >
          {error ?? toast}
        </div>
      )}

      <div className="cats">
        <button
          type="button"
          className={modoConsulta ? 'cat' : 'cat active'}
          onClick={() => {
            setModoConsulta(false);
            setConsultado(null);
          }}
        >
          Todos
        </button>

        {/* Modo consulta — el atajo va DIBUJADO en el botón (patrón que usa
            Tango: la tecla visible sobre la acción). CLAUDE.md §14.9 pide
            keyboard-first pero los atajos no se veían en ningún lado; que el
            cajero nuevo los aprenda solo es gratis. */}
        <button
          type="button"
          className={modoConsulta ? 'cat active' : 'cat'}
          onClick={() => {
            setModoConsulta((v) => !v);
            setConsultado(null);
          }}
          title="Ver precio y stock sin agregar al carrito"
        >
          Consultar precio <span className="kbd">F2</span>
        </button>
      </div>

      {/* Banda del modo consulta. Tiene que ser IMPOSIBLE confundirla con el
          modo venta: si el cajero no distingue en cuál está, el remedio sale
          peor que la enfermedad. */}
      {modoConsulta && (
        <div
          className="glass"
          style={{
            flex: '0 0 auto',
            padding: '10px 14px',
            borderRadius: 14,
            border: '1px solid rgba(247,152,74,0.5)',
            background: 'rgba(247,152,74,0.10)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 12.5,
          }}
          role="status"
        >
          <strong style={{ color: '#a2560f' }}>Modo consulta</strong>
          {consultado ? (
            <span style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <b>{consultado.name}</b>
              <span className="pos-data">{consultado.sku ?? 'sin código'}</span>
              <b className="pos-data" style={{ fontSize: 15 }}>{fmt(consultado.price)}</b>
              <span className="pos-data">
                {new Decimal(consultado.stock_current).toNumber()} uds en stock
              </span>
              {consultado.tdf_exempt && (
                <span style={{ color: 'var(--tdf)', fontWeight: 700, fontSize: 10 }}>
                  EXENTO · LEY 19.640
                </span>
              )}
            </span>
          ) : (
            <span style={{ color: 'var(--ink-3)' }}>
              Tocá un producto para ver precio y stock. No se agrega a la venta.
            </span>
          )}
          <button
            type="button"
            className="cat"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              setModoConsulta(false);
              setConsultado(null);
            }}
          >
            Salir <span className="kbd">Esc</span>
          </button>
        </div>
      )}

      <div className="catalog glass">
        <div className="stage stage-prod">
          <div className="grid">
            {products.map((p) => {
              const stock = new Decimal(p.stock_current).toNumber();
              const minimo = new Decimal(p.stock_minimum || '0').toNumber();
              const sinStock = stock <= 0;
              // "STOCK BAJO" usa el umbral REAL del producto (stock_minimum),
              // no un número fijo: para un kiosco 5 unidades de yerba es poco
              // y 5 de lavandina puede estar bien. El dato ya existía en la
              // base, sólo no viajaba al cliente.
              const stockBajo = !sinStock && minimo > 0 && stock <= minimo;
              return (
                <button
                  type="button"
                  className="card"
                  key={p.id}
                  onClick={() => (modoConsulta ? setConsultado(p) : addProduct(p.id))}
                  // En consulta se puede tocar cualquier producto, incluso sin
                  // stock: justamente sirve para responder "¿tenés esto?".
                  disabled={pending || (!modoConsulta && sinStock)}
                  style={
                    sinStock
                      ? { opacity: 0.45, cursor: 'not-allowed' }
                      : undefined
                  }
                >
                  <div className="card-img">
                    <span
                      aria-hidden
                      style={{
                        fontSize: 34,
                        fontWeight: 700,
                        color: 'rgba(13,20,36,0.13)',
                        letterSpacing: '-0.03em',
                      }}
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    {/* .tag-tdf ya trae position:absolute + top/left en el CSS
                        de la maqueta. NO agregarle posicionamiento inline: si
                        se le pasa `right` además del `left` del CSS, el chip se
                        estira de lado a lado. */}
                    {stockBajo ? (
                      <span className="tag-low">STOCK BAJO</span>
                    ) : p.tdf_exempt ? (
                      <span className="tag-tdf">
                        <span className="d" />
                        19.640
                      </span>
                    ) : null}
                  </div>
                  <div className="card-body">
                    <div className="card-name">{p.name}</div>
                    <div className="card-sku">{p.sku ?? '—'}</div>
                    <div className="card-foot">
                      <span className="card-price">{fmt(p.price)}</span>
                      <span className={stockBajo ? 'card-stock low' : 'card-stock'}>
                        {stock} uds
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Pie del catálogo, como en la maqueta. */}
          <div className="cat-foot">
            <span className="cat-count">
              Mostrando {products.length} de {products.length} productos
            </span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
