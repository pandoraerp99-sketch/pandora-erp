'use client';

/**
 * POSClient — el POS funcional (Slice 5). Carrito interactivo que llama las
 * Server Actions ya probadas (T-POS-ACTION-01). Dawn Industrial Editorial.
 *
 * Flujo happy-path F0: click producto → (crea draft si no hay) addItem →
 * carrito + preview total → Cobrar (efectivo) → finalize con idempotency_key
 * por intento → venta cobrada → reset para la próxima.
 *
 * Money preview client-side: agrega los line_total/line_subtotal/line_tax que
 * el SERVER ya calculó por ítem (ADR-0021 — cliente muestra preview, server es
 * autoridad). Usa Decimal.js para las sumas (nunca Number en money).
 */
import { useMemo, useState, useTransition } from 'react';
import Decimal from 'decimal.js';
import { POSLayout } from '@/components/pos/POSLayout';
import { StatusBar } from '@/components/pos/StatusBar';
import { CartRail } from '@/components/pos/CartRail';
import { CartTotal } from '@/components/pos/CartTotal';
import {
  startSaleAction,
  addItemAction,
  removeItemAction,
  finalizeSaleAction,
} from './actions';
import type { SaleWithItems } from '@/lib/services/sales/sale.service';

export interface PosProductDTO {
  id: string;
  name: string;
  sku: string | null;
  price: string;
  tax_rate: string;
  tdf_exempt: boolean;
  stock_current: string;
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

function stockColor(stock: number): { bg: string; text: string } {
  if (stock <= 0)
    return { bg: 'oklch(96.8% 0.008 238)', text: 'var(--text-muted)' };
  if (stock < 10)
    return {
      bg: 'color-mix(in oklch, var(--semantic-error) 10%, transparent)',
      text: 'var(--semantic-error)',
    };
  if (stock < 20)
    return {
      bg: 'color-mix(in oklch, var(--semantic-warning) 14%, transparent)',
      text: 'oklch(45% 0.13 70)',
    };
  return {
    bg: 'color-mix(in oklch, var(--semantic-success) 10%, transparent)',
    text: 'oklch(40% 0.12 148)',
  };
}

export function POSClient({
  products,
  cashierName,
  salePointLabel,
  serverTimeIso,
}: POSClientProps) {
  const [cart, setCart] = useState<SaleWithItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
        payments: [{ method: 'efectivo', amount }],
        require_fiscal_invoice: false,
        idempotency_key: key,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setToast(`Venta cobrada · ${fmt(totals.total)}`);
      setCart(null); // lista para la próxima venta
    });
  }

  return (
    <>
      <POSLayout
        statusBar={
          <StatusBar
            salePointLabel={salePointLabel}
            cashierName={cashierName}
            afipStatus="ok"
            afipLatencyMs={1240}
            cashBalanceFormatted={fmt(totals.total)}
            serverTimeIso={serverTimeIso}
          />
        }
        cartRail={
          <CartRail
            customerLabel="Consumidor final"
            hasItems={hasItems}
            footer={
              <CartTotal
                hasItems={hasItems}
                subtotalFormatted={fmt(totals.neto)}
                ivaLabel="IVA (21%)"
                ivaFormatted={fmt(totals.iva)}
                otherTaxesFormatted={fmt(new Decimal(0))}
                exemptFormatted={fmt(totals.exento)}
                totalFormatted={fmt(totals.total)}
              />
            }
          >
            {items.map((it) => (
              <li
                key={it.id}
                className="pos-anim-pop group flex flex-col gap-1 p-2.5 rounded-md hover:bg-[color:var(--surface-sunken)] transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[color:var(--text-primary)] font-medium leading-tight">
                    {it.product_name_snapshot}
                  </span>
                  <span
                    className="pos-data text-[color:var(--text-secondary)] shrink-0"
                    style={{ fontSize: 'var(--text-caption)' }}
                  >
                    x{new Decimal(it.quantity).toNumber()}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  {it.tdf_exempt ? (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[color:var(--fiscal-tdf)]"
                      style={{
                        fontSize: 'var(--text-micro)',
                        background:
                          'color-mix(in oklch, var(--fiscal-tdf) 10%, transparent)',
                      }}
                    >
                      <span
                        aria-hidden
                        className="w-1 h-1 rounded-full"
                        style={{ background: 'var(--fiscal-tdf)' }}
                      />
                      Ley 19.640
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      disabled={pending}
                      className="pos-focusable opacity-0 group-hover:opacity-100 transition-opacity text-[color:var(--text-muted)] hover:text-[color:var(--semantic-error)]"
                      style={{ fontSize: 'var(--text-micro)' }}
                      aria-label={`Quitar ${it.product_name_snapshot}`}
                    >
                      Quitar
                    </button>
                  )}
                  <span
                    className="pos-data text-[color:var(--text-primary)]"
                    style={{ fontSize: 'var(--text-body)' }}
                  >
                    {fmt(it.line_total)}
                  </span>
                </div>
              </li>
            ))}
          </CartRail>
        }
        catalog={
          <div className="flex flex-col h-full">
            {error ? (
              <div
                role="alert"
                className="mb-3 rounded-lg px-3.5 py-2.5 text-[color:var(--semantic-error)]"
                style={{
                  fontSize: 'var(--text-caption)',
                  background:
                    'color-mix(in oklch, var(--semantic-error) 9%, transparent)',
                  border:
                    '1px solid color-mix(in oklch, var(--semantic-error) 30%, transparent)',
                }}
              >
                {error}
              </div>
            ) : null}
            <div
              className="flex-1 overflow-y-auto pr-1"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: '12px',
                alignContent: 'start',
              }}
            >
              {products.map((p) => {
                const stock = new Decimal(p.stock_current).toNumber();
                const sc = stockColor(stock);
                const soldOut = stock <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p.id)}
                    disabled={pending || soldOut}
                    className="pos-focusable pos-surface-operational rounded-lg p-3 flex flex-col gap-2 text-left transition-all hover:translate-y-[-1px] hover:shadow-[0_4px_12px_oklch(20%_0.04_240/0.08)] disabled:opacity-50 relative"
                  >
                    {p.tdf_exempt ? (
                      <span
                        aria-label="Exento Ley 19.640"
                        className="absolute top-2 right-2 inline-flex items-center justify-center w-5 h-5 rounded-full"
                        style={{
                          background:
                            'color-mix(in oklch, var(--fiscal-tdf) 14%, transparent)',
                        }}
                      >
                        <span
                          aria-hidden
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: 'var(--fiscal-tdf)' }}
                        />
                      </span>
                    ) : null}
                    <div className="flex flex-col gap-0.5 mt-1">
                      <span
                        className="text-[color:var(--text-primary)] font-medium leading-tight line-clamp-2"
                        style={{ fontSize: 'var(--text-caption)' }}
                      >
                        {p.name}
                      </span>
                      <span
                        className="pos-data text-[color:var(--text-primary)]"
                        style={{ fontSize: 'var(--text-body)' }}
                      >
                        {fmt(p.price)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-auto pt-1">
                      <span
                        className="pos-data px-1.5 py-0.5 rounded"
                        style={{
                          fontSize: 'var(--text-micro)',
                          background: sc.bg,
                          color: sc.text,
                        }}
                      >
                        {soldOut ? 'agotado' : `${stock} u`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        }
        actionBar={
          <div className="flex items-center justify-between gap-4 h-full px-1">
            <div className="flex items-center gap-3">
              {toast ? (
                <span
                  className="pos-anim-pop inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-semibold text-white"
                  style={{
                    fontSize: 'var(--text-caption)',
                    background: 'var(--semantic-success)',
                  }}
                >
                  ✓ {toast}
                </span>
              ) : (
                <span
                  className="text-[color:var(--text-muted)]"
                  style={{ fontSize: 'var(--text-caption)' }}
                >
                  {hasItems
                    ? `${items.length} ítem${items.length === 1 ? '' : 's'} en el carrito`
                    : 'Tocá un producto para empezar'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={charge}
              disabled={!hasItems || pending}
              className="pos-focusable inline-flex items-center gap-2 rounded-xl px-6 py-3 font-bold text-white transition-[transform,opacity] active:scale-[0.99] disabled:opacity-45"
              style={{
                fontSize: 'var(--text-body-lg, 1.125rem)',
                background: 'var(--dawn-500)',
                boxShadow: '0 2px 10px oklch(60% 0.195 218 / 0.35)',
              }}
            >
              {pending ? 'Procesando…' : `Cobrar ${fmt(totals.total)}`}
              <span aria-hidden>→</span>
            </button>
          </div>
        }
      />
    </>
  );
}
