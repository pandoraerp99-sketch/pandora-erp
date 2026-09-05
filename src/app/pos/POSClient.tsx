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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
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

/**
 * Medios de la grilla de cobro (maqueta `checkpoint-v20-cobro-tipeable`).
 *
 * **El cobro es multi-medio.** No es una feature nueva: `sale_payments` se
 * diseñó en el Sprint 5 con una fila por pago, y `sale.service` deriva
 * `sales.payment_method='mixto'` cuando hay 2+ medios distintos. Lo que era
 * F1+ (ADR-0026) es *reclasificar* una venta mixta, no crearla — dos cosas
 * distintas que un comentario mío anterior había mezclado.
 *
 * `cobrable:false` = se muestra pero no se puede usar. Es el caso de `mp_qr`:
 * el schema exige `mp_payment_external_id`, que emite el SDK de MercadoPago
 * al crear el pago, y ese flujo todavía no existe. Antes esta opción estaba
 * en el menú como si funcionara: elegirla y cobrar fallaba SIEMPRE
 * (ver `tests/unit/pos-payment-methods.test.ts`). Se deja visible y apagada
 * en vez de borrarla, para no mentir sobre los medios que el comercio va a
 * tener.
 */
const PAY_OPTIONS: Array<{
  key: SalePaymentMethod;
  label: string;
  cobrable: boolean;
  motivo?: string;
}> = [
  { key: 'efectivo', label: 'Efectivo', cobrable: true },
  {
    key: 'mp_qr',
    label: 'QR / Transferencia',
    cobrable: false,
    motivo: 'falta MercadoPago',
  },
  { key: 'debito', label: 'Débito', cobrable: true },
  { key: 'credito', label: 'Crédito', cobrable: true },
];

/** Los que realmente aceptan monto. */
const PAY_COBRABLES = PAY_OPTIONS.filter((o) => o.cobrable);

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
  const [pending, startTransition] = useTransition();

  /**
   * ── COBRO TIPEABLE (maqueta v20) ────────────────────────────────────
   *
   * Los inputs de monto son **NO controlados** a propósito. El spike v20
   * demostró que el camino que funciona es: el `value` del input ES la fuente
   * de verdad, y el numpad y el teclado físico escriben ahí por el mismo
   * lugar. Levantar cada tecla a `useState` rompe las tres cosas que el spike
   * resolvió:
   *   1. `inputmode="none"` — tocar el campo lo enfoca SIN abrir el teclado
   *      del sistema, que en tablet taparía el numpad. En desktop el teclado
   *      físico igual escribe.
   *   2. El recálculo NUNCA pisa el value del input enfocado (si no, el
   *      cursor salta mientras escribís).
   *   3. El numpad usa `mousedown` + `preventDefault` para no robarle el foco
   *      al input activo.
   *
   * `tick` sólo fuerza el re-render de lo derivado (pagado, restante, vuelto,
   * fila activa). No guarda montos.
   */
  const montoRefs = useRef<Partial<Record<SalePaymentMethod, HTMLInputElement | null>>>({});
  const [activo, setActivo] = useState<SalePaymentMethod>('efectivo');
  const [, setTick] = useState(0);
  const recompute = useCallback(() => setTick((t) => t + 1), []);

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
  /** Hoja de selección de medio de pago (la abre la fila `.paysel`). */
  const [paySheetOpen, setPaySheetOpen] = useState(false);

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

  // ── Montos del cobro: se leen del DOM, no del state (ver `montoRefs`) ──

  /** Entero en pesos que tiene tipeado un medio. Sin monto → 0. */
  const montoDe = useCallback((k: SalePaymentMethod): number => {
    const crudo = montoRefs.current[k]?.value ?? '';
    const n = parseInt(crudo.replace(/[^0-9]/g, '') || '0', 10);
    return Number.isFinite(n) ? n : 0;
  }, []);

  const pagado = PAY_COBRABLES.reduce((s, o) => s + montoDe(o.key), 0);
  const totalNum = totals.total.toNumber();
  /** Lo que falta cubrir. Nunca negativo: el excedente es vuelto, no faltante. */
  const restante = Math.max(0, Math.round(totalNum) - pagado);
  /** Sólo tiene sentido en efectivo: nadie da vuelto de una tarjeta. */
  const vuelto = Math.max(0, pagado - Math.round(totalNum));

  /**
   * Escribe una tecla sobre el input activo. Lo usan el numpad Y el teclado
   * físico, para que haya UN solo camino de edición.
   *
   * Si el input está todo seleccionado (recién enfocado), el primer dígito
   * REEMPLAZA en vez de concatenar — así el cajero corrige un monto sin tener
   * que borrarlo primero.
   */
  const aplicarTecla = useCallback((inp: HTMLInputElement, tecla: string) => {
    const todoSeleccionado =
      inp.selectionStart === 0 &&
      inp.selectionEnd === inp.value.length &&
      inp.value.length > 0;
    let s = todoSeleccionado ? '' : inp.value;
    s = tecla === 'back' ? s.slice(0, -1) : s + tecla;
    let n = parseInt(s || '0', 10);
    if (!Number.isFinite(n)) n = 0;
    if (n > 99_999_999) n = 99_999_999;
    inp.value = n ? String(n) : '';
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }, []);

  /** Mete todo lo que falta en el medio activo. */
  function completarResto() {
    const inp = montoRefs.current[activo];
    if (!inp) return;
    inp.value = String(montoDe(activo) + restante);
    inp.focus();
    inp.select();
    recompute();
  }

  /** Vacía la grilla (al cerrar la hoja o después de cobrar). */
  const limpiarMontos = useCallback(() => {
    for (const o of PAY_COBRABLES) {
      const inp = montoRefs.current[o.key];
      if (inp) inp.value = '';
    }
    setActivo('efectivo');
    recompute();
  }, [recompute]);

  function charge() {
    if (!cart || !hasItems) return;

    // Se arma UNA fila por medio con monto. Si hay 2+, el service deriva
    // `sales.payment_method='mixto'` — no hace falta mandarlo.
    const payments = PAY_COBRABLES.filter((o) => montoDe(o.key) > 0).map((o) => ({
      method: o.key,
      amount: montoDe(o.key).toFixed(4),
    }));

    if (payments.length === 0) {
      setError('Ingresá el monto de al menos un medio de pago.');
      return;
    }
    if (restante > 0) {
      setError(`Falta cubrir ${fmt(String(restante))}.`);
      return;
    }

    setError(null);
    // idempotency_key por INTENTO de cobro — un retry del mismo cobro reusa
    // esta key (dedup, ADR-0010). Se genera al iniciar el intento.
    const key = crypto.randomUUID();
    const vueltoDelIntento = vuelto;
    startTransition(async () => {
      const res = await finalizeSaleAction({
        sale_id: cart.sale.id,
        payments,
        require_fiscal_invoice: false,
        idempotency_key: key,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const medios = payments
        .map((p) => PAY_OPTIONS.find((o) => o.key === p.method)?.label ?? p.method)
        .join(' + ');
      const cola =
        vueltoDelIntento > 0 ? ` · vuelto ${fmt(String(vueltoDelIntento))}` : '';
      setToast(`Venta cobrada · ${medios} · ${fmt(totals.total)}${cola}`);
      setCart(null); // lista para la próxima venta
      setPaySheetOpen(false);
      limpiarMontos();
    });
  }

  // ════════════ CARRITO (columna derecha del shell) ════════════
  const carrito = (
    // `sheet-open` en el CARRITO es lo que levanta la hoja de cobro: el CSS de
    // la maqueta la deja en `translateY(105%)` y sólo `.cart.sheet-open
    // .paysheet` la sube. Sin esta clase la hoja se ve pero queda 700px más
    // abajo y el botón de confirmar cae FUERA de la pantalla — medido, no
    // supuesto (confirmVisible.dentro === false).
    <aside className={paySheetOpen ? 'cart glass sheet-open' : 'cart glass'}>
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
          {/* En el POS el label lleva la alícuota, como la maqueta. Ojo: el
              "IVA Contenido" sin alícuota es el label OFICIAL del bloque de
              Transparencia Fiscal en el COMPROBANTE IMPRESO (RG 5614 Art. 2
              inc. 7) — son dos cosas distintas y no hay que mezclarlas. */}
          <span className="slabel">IVA (21%)</span>
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

      {/* ── Hoja de cobro (maqueta v20) ───────────────────────────────
          Un monto TIPEABLE por medio. Se puede repartir entre varios: el
          service deriva `payment_method='mixto'` solo. Los inputs son NO
          controlados a propósito — ver el comentario de `montoRefs`. */}
      {/* Siempre montada, como en la maqueta: el CSS la desliza con
          `.cart.sheet-open`. Renderizarla condicionalmente mataba la
          transición y remontaba los inputs (perdiendo refs y foco). El
          backdrop tiene `pointer-events:none` mientras está cerrada, así que
          no tapa nada. */}
      <>
          <div className="paysheet-backdrop" onClick={() => setPaySheetOpen(false)} />
          <div className="paysheet" data-m={activo} aria-hidden={!paySheetOpen}>
            <div className="paysheet-grip" />
            <div className="paysheet-head">
              <span className="t">Cobrar</span>
              <span className="paysheet-total">{fmt(totals.total)}</span>
              <button
                type="button"
                className="paysheet-close"
                onClick={() => setPaySheetOpen(false)}
                aria-label="Cerrar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Progreso pagado / total */}
            <div className="paybar">
              <div
                className="paybar-fill"
                style={{
                  width: `${totalNum > 0 ? Math.min(100, (pagado / totalNum) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="paystat">
              <span>
                Pagado <b>{fmt(String(pagado))}</b>
              </span>
              <span>
                {vuelto > 0 ? (
                  <>
                    Vuelto <b>{fmt(String(vuelto))}</b>
                  </>
                ) : (
                  <>
                    Restante <b>{fmt(String(restante))}</b>
                  </>
                )}
              </span>
            </div>

            {/* Grilla de medios con monto tipeable */}
            <div className="pmrows">
              {PAY_OPTIONS.map((op) => {
                const monto = op.cobrable ? montoDe(op.key) : 0;
                const esActivo = op.cobrable && activo === op.key;
                return (
                  <div
                    key={op.key}
                    className={esActivo ? 'pmrow active' : 'pmrow'}
                    data-k={op.key}
                    data-off={op.cobrable ? undefined : '1'}
                    onMouseDown={(e) => {
                      if (!op.cobrable) return;
                      if ((e.target as HTMLElement).closest('input')) return;
                      // No robar el foco antes de dárselo al input de la fila.
                      e.preventDefault();
                      montoRefs.current[op.key]?.focus();
                    }}
                  >
                    <span className="pmn">{op.label}</span>
                    {op.cobrable ? (
                      <span className="pmf">
                        <span className="pmc">$</span>
                        <input
                          className={monto === 0 ? 'pmin zero' : 'pmin'}
                          ref={(el) => {
                            montoRefs.current[op.key] = el;
                          }}
                          defaultValue=""
                          // Enfoca SIN abrir el teclado del sistema, que en
                          // tablet taparía el numpad. El teclado físico igual
                          // escribe (desktop).
                          inputMode="none"
                          placeholder="0"
                          aria-label={`Monto en ${op.label}`}
                          disabled={pending}
                          onFocus={(e) => {
                            setActivo(op.key);
                            e.currentTarget.select();
                            recompute();
                          }}
                          onInput={(e) => {
                            // Teclado físico: el navegador ya escribió; acá se
                            // sanea a dígitos y se recalcula lo derivado.
                            const inp = e.currentTarget;
                            let n = parseInt(
                              inp.value.replace(/[^0-9]/g, '') || '0',
                              10
                            );
                            if (!Number.isFinite(n)) n = 0;
                            if (n > 99_999_999) n = 99_999_999;
                            const s = n ? String(n) : '';
                            if (inp.value !== s) inp.value = s;
                            recompute();
                          }}
                        />
                      </span>
                    ) : (
                      <span className="pmoff">{op.motivo}</span>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="pmfill"
              onClick={completarResto}
              disabled={pending || restante === 0}
            >
              Auto-completar el resto en{' '}
              <b>{PAY_OPTIONS.find((o) => o.key === activo)?.label}</b>
            </button>

            {/* Numpad: `mousedown` + preventDefault para NO robarle el foco al
                input activo — si lo robara, cada tecla cerraría la edición. */}
            <div
              className="numpad"
              onMouseDown={(e) => {
                const b = (e.target as HTMLElement).closest('button');
                if (!b) return;
                e.preventDefault();
                const inp = montoRefs.current[activo];
                if (!inp) return;
                // Si no estaba enfocado, enfocar dispara select() → el primer
                // dígito reemplaza el monto anterior en vez de concatenarse.
                if (document.activeElement !== inp) inp.focus();
                aplicarTecla(inp, b.dataset['k'] ?? '');
                recompute();
              }}
            >
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'].map((t) => (
                <button type="button" key={t} data-k={t}>
                  {t}
                </button>
              ))}
              <button type="button" className="bk" data-k="back" aria-label="Borrar">
                ⌫
              </button>
            </div>

            <button
              type="button"
              className="cobrar"
              onClick={charge}
              disabled={!hasItems || pending || restante > 0 || pagado === 0}
            >
              {pending
                ? 'Procesando…'
                : restante > 0
                  ? `Falta ${fmt(String(restante))}`
                  : `Cobrar ${fmt(totals.total)}`}
            </button>
          </div>
      </>

      <div className="pay">
        <button
          type="button"
          className="paysel"
          onClick={() => setPaySheetOpen(true)}
          disabled={pending}
        >
          <span className="pic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M2 10h20" />
            </svg>
          </span>
          <span className="ptx">
            <span className="pl">Medio de pago</span>
            <span className="pv">
              {pagado > 0
                ? PAY_COBRABLES.filter((o) => montoDe(o.key) > 0)
                    .map((o) => o.label)
                    .join(' + ')
                : 'Elegir al cobrar'}
            </span>
          </span>
          <span className="pchev">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </button>

        <button
          type="button"
          className="cobrar"
          onClick={() => setPaySheetOpen(true)}
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
