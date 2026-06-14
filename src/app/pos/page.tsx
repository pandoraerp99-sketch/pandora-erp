/**
 * POS Preview — Dawn Industrial Editorial v1.1
 *
 * Pagina ejemplar para que el owner vea la direccion visual en navegador real.
 * NO es el POS funcional final — es la prueba de "como se ve" antes de Sprint POS-A.
 *
 * Componentes mostrados en posicion correcta:
 *   - <StatusBar> arriba (zone S, layer 0)
 *   - <CartTotal> en cart rail derecho (zone C, layer 1 surface)
 *   - Catalog mockup en centro (zone K, layer 0 stage)
 *   - Action bar abajo (zone A, layer 2 glass)
 *
 * Spec: docs/POS-DESIGN-V1.md + docs/POS-DESIGN-V1.1-DIRECTION.md
 *
 * Para verlo:
 *   pnpm dev
 *   abrir http://localhost:3000/pos
 *   ideal: viewport 1024x768 (tablet) — Chrome DevTools device toolbar
 */
import { StatusBar } from '@/components/pos/StatusBar';
import { CartTotal } from '@/components/pos/CartTotal';

// Mock products — al final son los services existentes (Inventory) los que los traen
const MOCK_PRODUCTS = [
  { id: '1', name: 'Coca 600ml',        price: '$1.800', stock: 42, exempt: true,  emoji: '🥤' },
  { id: '2', name: 'Sprite 600ml',      price: '$1.750', stock: 38, exempt: false, emoji: '🥤' },
  { id: '3', name: 'Bloque Chocolate',  price: '$650',   stock: 15, exempt: false, emoji: '🍫' },
  { id: '4', name: 'Marlboro Box',      price: '$4.500', stock: 8,  exempt: false, emoji: '🚬' },
  { id: '5', name: 'Doritos 250g',      price: '$2.200', stock: 22, exempt: false, emoji: '🍿' },
  { id: '6', name: 'Galletitas Oreo',   price: '$1.450', stock: 31, exempt: false, emoji: '🍪' },
  { id: '7', name: 'Agua Mineral 1L',   price: '$1.200', stock: 56, exempt: true,  emoji: '💧' },
  { id: '8', name: 'Yerba 1kg',         price: '$3.800', stock: 12, exempt: false, emoji: '🌿' },
  { id: '9', name: 'Pan Lactal',        price: '$2.900', stock: 6,  exempt: false, emoji: '🍞' },
  { id: '10', name: 'Cafe Molido 250g', price: '$3.200', stock: 18, exempt: false, emoji: '☕' },
];

const CATEGORIES = ['Todos', 'Bebidas', 'Cigarrillos', 'Golosinas', 'Limpieza', 'Lacteos'];

function stockColor(stock: number): { bg: string; text: string; label: string } {
  if (stock <= 0) return { bg: 'oklch(96.8% 0.008 238)', text: 'var(--text-muted)', label: 'agotado' };
  if (stock < 10) return { bg: 'color-mix(in oklch, var(--semantic-error) 10%, transparent)', text: 'var(--semantic-error)', label: `${stock} u` };
  if (stock < 20) return { bg: 'color-mix(in oklch, var(--semantic-warning) 14%, transparent)', text: 'oklch(45% 0.13 70)', label: `${stock} u` };
  return { bg: 'color-mix(in oklch, var(--semantic-success) 10%, transparent)', text: 'oklch(40% 0.12 148)', label: `${stock} u` };
}

export default function POSPreviewPage() {
  const serverTime = new Date().toISOString();

  return (
    <div
      className="pos-stage flex flex-col min-h-screen w-full overflow-hidden"
      style={{ fontFamily: 'var(--font-ui)' }}
    >
      {/* Zone S: Status bar */}
      <StatusBar
        salePointLabel="Kiosco Río Grande — Caja #1"
        cashierName="Agus R."
        afipStatus="ok"
        afipLatencyMs={1240}
        cashBalanceFormatted="$45.230"
        serverTimeIso={serverTime}
      />

      {/* Main: cart left + catalog right */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Zone C: Cart rail (left, layer 1 operational) */}
        <aside
          aria-label="Carrito de venta"
          className="pos-surface-operational flex flex-col w-[340px] shrink-0 m-3 mr-1.5 rounded-lg overflow-hidden"
        >
          {/* Customer slot */}
          <div className="px-4 py-3 border-b border-[color:color-mix(in_oklch,var(--dawn-200)_50%,transparent)] flex items-center justify-between">
            <div className="flex flex-col leading-tight">
              <span
                className="uppercase tracking-wider text-[color:var(--text-muted)]"
                style={{ fontSize: 'var(--text-micro)' }}
              >
                Cliente
              </span>
              <span
                className="text-[color:var(--text-primary)] font-medium"
                style={{ fontSize: 'var(--text-body)' }}
              >
                Consumidor final
              </span>
            </div>
            <button
              className="pos-focusable text-[color:var(--dawn-600)] hover:text-[color:var(--dawn-700)] transition-colors"
              style={{ fontSize: 'var(--text-caption)' }}
            >
              + Cliente
            </button>
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <ul className="flex flex-col gap-2">
              <li className="pos-anim-pop flex flex-col gap-1 p-2.5 rounded-md hover:bg-[color:var(--surface-sunken)] transition-colors">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[color:var(--text-primary)] font-medium leading-tight">
                    Coca 600ml
                  </span>
                  <span
                    className="pos-data text-[color:var(--text-secondary)] shrink-0"
                    style={{ fontSize: 'var(--text-caption)' }}
                  >
                    x2
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[color:var(--fiscal-tdf)] bg-[color:color-mix(in_oklch,var(--fiscal-tdf)_10%,transparent)]"
                    style={{ fontSize: 'var(--text-micro)' }}
                  >
                    <span
                      aria-hidden
                      className="w-1 h-1 rounded-full"
                      style={{ background: 'var(--fiscal-tdf)' }}
                    />
                    Ley 19.640
                  </span>
                  <span
                    className="pos-data text-[color:var(--text-primary)]"
                    style={{ fontSize: 'var(--text-body)' }}
                  >
                    $3.600
                  </span>
                </div>
              </li>
              <li className="flex flex-col gap-1 p-2.5 rounded-md hover:bg-[color:var(--surface-sunken)] transition-colors">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[color:var(--text-primary)] font-medium leading-tight">
                    Marlboro Box 20
                  </span>
                  <span
                    className="pos-data text-[color:var(--text-secondary)] shrink-0"
                    style={{ fontSize: 'var(--text-caption)' }}
                  >
                    x1
                  </span>
                </div>
                <div className="flex justify-end">
                  <span
                    className="pos-data text-[color:var(--text-primary)]"
                    style={{ fontSize: 'var(--text-body)' }}
                  >
                    $4.500
                  </span>
                </div>
              </li>
            </ul>
          </div>

          {/* Total breakdown */}
          <div className="px-4 py-4 border-t border-[color:color-mix(in_oklch,var(--dawn-200)_50%,transparent)] bg-[color:var(--surface-raised)]">
            <CartTotal
              hasItems
              subtotalFormatted="$6.711,57"
              ivaLabel="IVA (21%)"
              ivaFormatted="$1.047,43"
              otherTaxesFormatted="$0,00"
              exemptFormatted="$3.600,00"
              totalFormatted="$8.100,00"
            />
          </div>
        </aside>

        {/* Zone K: Catalog (right, layer 0 stage) */}
        <main
          aria-label="Catálogo de productos"
          className="flex-1 flex flex-col overflow-hidden p-3 pl-1.5"
        >
          {/* Search universal */}
          <div className="mb-3">
            <div className="pos-surface-operational rounded-lg flex items-center gap-3 px-4 py-3">
              <svg
                aria-hidden
                className="w-4 h-4 text-[color:var(--text-muted)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="search"
                placeholder="Buscar producto, escanear código o cliente…"
                className="flex-1 bg-transparent outline-none text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)]"
                style={{ fontSize: 'var(--text-body)', fontFamily: 'var(--font-ui)' }}
              />
              <kbd
                className="px-1.5 py-0.5 rounded border border-[color:color-mix(in_oklch,var(--dawn-300)_50%,transparent)] text-[color:var(--text-muted)] pos-data"
                style={{ fontSize: 'var(--text-micro)' }}
              >
                ⌘K
              </kbd>
            </div>
          </div>

          {/* Categories chips */}
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
            {CATEGORIES.map((c, i) => (
              <button
                key={c}
                className={`
                  pos-focusable shrink-0 px-3 py-1.5 rounded-full transition-colors
                  ${i === 0
                    ? 'bg-[color:var(--dawn-500)] text-white shadow-[0_1px_3px_oklch(60%_0.195_218/0.35)]'
                    : 'bg-[color:var(--surface-elevated)] text-[color:var(--text-secondary)] border border-[color:color-mix(in_oklch,var(--dawn-200)_55%,transparent)] hover:bg-[color:var(--surface-sunken)]'
                  }
                `}
                style={{ fontSize: 'var(--text-caption)' }}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Product grid */}
          <div
            className="flex-1 overflow-y-auto pr-1"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '12px',
              alignContent: 'start',
            }}
          >
            {MOCK_PRODUCTS.map((p) => {
              const sc = stockColor(p.stock);
              return (
                <button
                  key={p.id}
                  className="
                    pos-focusable
                    pos-surface-operational
                    rounded-lg p-3
                    flex flex-col gap-2 text-left
                    transition-all hover:translate-y-[-1px] hover:shadow-[0_4px_12px_oklch(20%_0.04_240/0.08)]
                    relative
                  "
                >
                  {p.exempt && (
                    <span
                      aria-label="Producto exento Ley 19.640"
                      className="absolute top-2 right-2 inline-flex items-center justify-center w-5 h-5 rounded-full"
                      style={{ background: 'color-mix(in oklch, var(--fiscal-tdf) 14%, transparent)' }}
                    >
                      <span
                        aria-hidden
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: 'var(--fiscal-tdf)' }}
                      />
                    </span>
                  )}
                  <div
                    aria-hidden
                    className="text-3xl leading-none"
                  >
                    {p.emoji}
                  </div>
                  <div className="flex flex-col gap-0.5">
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
                      {p.price}
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
                      {sc.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </main>
      </div>

      {/* Zone A: Action bar (layer 2 glass) */}
      <footer
        aria-label="Acciones de venta"
        className="pos-surface-action flex flex-col gap-0.5 px-4 py-3 sticky bottom-0"
      >
        {/* Keyboard hints row */}
        <div
          className="flex items-center gap-4 text-[color:var(--text-muted)]"
          style={{ fontSize: 'var(--text-micro)' }}
        >
          {[
            ['F2', 'Buscar'],
            ['F3', 'Cliente'],
            ['F4', 'Hold'],
            ['F6', 'Cancelar'],
            ['F7', 'Descuento'],
            ['F8', 'Imprimir'],
            ['F9', 'Cajón'],
          ].map(([k, label]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <kbd
                className="pos-data px-1 py-px rounded bg-[color:var(--surface-elevated)] border border-[color:color-mix(in_oklch,var(--dawn-200)_55%,transparent)] text-[color:var(--text-secondary)]"
                style={{ fontSize: '10px' }}
              >
                {k}
              </kbd>
              <span>{label}</span>
            </span>
          ))}
        </div>

        {/* CTA Cobrar — alineado derecha, NO centrado */}
        <div className="flex items-center justify-end mt-1">
          <button
            className="
              pos-focusable
              inline-flex items-center gap-3 pl-6 pr-5 py-3.5 rounded-lg
              bg-gradient-to-br from-[var(--dawn-500)] to-[var(--dawn-700)]
              text-white font-medium tracking-tight
              shadow-[0_4px_16px_oklch(60%_0.195_218/0.32)]
              transition-all hover:translate-y-[-1px] hover:shadow-[0_6px_20px_oklch(60%_0.195_218/0.42)]
              active:translate-y-0
            "
            style={{ fontSize: 'var(--text-body-lg)' }}
          >
            <kbd
              className="pos-data px-1.5 py-0.5 rounded bg-white/15 text-white"
              style={{ fontSize: 'var(--text-micro)' }}
            >
              F5
            </kbd>
            <span>Cobrar</span>
            <span
              className="pos-data tnum"
              style={{ fontSize: 'var(--text-body-lg)' }}
            >
              $8.100
            </span>
            <span aria-hidden className="ml-1">→</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
