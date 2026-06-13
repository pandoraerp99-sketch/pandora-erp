# POS Design Spec v1 — Pandora ERP

**Fecha:** 2026-06-13
**Versión:** 1.0
**Estado:** Spec base para implementación (no UX validada todavía con cajero real)
**Atmosphere:** Operational (ADR-0012)
**Identidad:** Dawn Sky permanente (ADR-0016)
**Target hardware:** Tablet 10" landscape (primero) + Desktop 1440+ (segundo)
**Target usuario:** Cajero kiosco/ferretería/mercería TDF, 30–200 ventas/día, opera "a las 11pm con cola"

---

## 1. Filosofía de diseño

Antes de todo el detalle: las **4 reglas que no se rompen**.

1. **El cajero gana al diseñador.** Cada decisión visual cede si frena la operación a las 11pm. Estética > nunca. Velocidad de cobro > siempre.
2. **Keyboard primero, mouse después, touch en paralelo.** Tablet **es** el target real TDF, pero la operación debe ser idéntica con teclado físico (cajeros desktop también).
3. **Fiscal como protagonista, no como pie de página.** El competidor argentino esconde AFIP. Pandora lo pone al frente — diferenciador real.
4. **Feedback <100ms en cada acción.** Sin excepción. Si la red tarda, el estado intermedio aparece antes de los 100ms.

---

## 2. Referencias mundiales investigadas (qué tomar de cada uno)

### Square POS (US — square.com)
- ✅ Tomar: claridad del CTA "Charge" como botón héroe; numpad táctil amplio; quick-amount buttons ($5, $10, $20, exact); empty cart con sugerencia útil.
- ❌ No tomar: branding ultra-corporativo; flujo de tip (no aplica retail TDF).

### Lightspeed Retail (Canada — lightspeedhq.com)
- ✅ Tomar: search universal con barra grande siempre visible; modifier groups visuales; recent items rail; receipt preview inline.
- ❌ No tomar: density excesiva en mobile portrait (los kioscos tienen tablets landscape).

### Toast POS (US restaurantes — toasttab.com)
- ✅ Tomar: status bar superior con estado de conexión + impresora + cajón siempre visible; multi-check management (en Pandora = carritos en hold).
- ❌ No tomar: lógica de mesa/comanda (Pandora no es gastronómico — NON-GOALS).

### Shopify POS (global — shopify.com/pos)
- ✅ Tomar: identidad visual fuerte y consistente (no genérica); transitions entre states; loading skeletons.
- ❌ No tomar: bias ecommerce que no aplica a venta presencial.

### Loyverse (free, global — loyverse.com)
- ✅ Tomar: density alta sin claustrofobia; teclas de función visibles abajo (F1–F9); grids configurables por categoría color-coded.
- ❌ No tomar: estética dated, paleta saturada estilo 2015.

### Zettle by PayPal (Europa — zettle.com)
- ✅ Tomar: minimalismo sin perder densidad; uso elegante del espacio en blanco; receipt design tipográfico.
- ❌ No tomar: ausencia de status fiscal visible (no aplica AR).

### Linx Microvix (Brasil PyME — linx.com.br/microvix)
- ✅ Tomar: PyME retail real (target muy similar a TDF); flujo de cancelación con razón obligatoria; modo offline degradado (referencia, no copiar — F0 no tiene offline real).
- ❌ No tomar: branding corporativo brasileño.

### Lavu (NYC — lavu.com)
- ✅ Tomar: jerarquía visual excelente; color como información (no decoración).
- ❌ No tomar: flujo gastronómico de mesa.

### Tilster (Noruega — tilster.io)
- ✅ Tomar: minimalismo escandinavo aplicado a POS sin perder funcionalidad; tipografía como personalidad.
- ❌ No tomar: enfoque hospitalidad.

### Stripe Terminal (developer toolkit — stripe.com/terminal)
- ✅ Tomar: estados de pago como first-class citizens (idle / processing / approved / declined / requires_action); manejo de errores como flujo, no como modal.

### **Diferenciadores Pandora (que NINGUNO de arriba tiene)**
1. **AFIP/ARCA visible como héroe top-bar** con estado claro y tiempo de respuesta.
2. **Régimen Transparencia Fiscal Ley 27.743** discriminado en ticket preview pre-emisión (transparente para el cliente final).
3. **TDF Ley 19.640** badge per-item cuando aplica (azul Dawn Sky distintivo).
4. **Customer snapshot inmutable** mostrado como tal (íconos de bloqueo cuando ya hay CAE).
5. **Cierre Z equivalente** visible en tiempo real (no hay que esperar al final del día).

---

## 3. Layout zonal (tablet 1024×768 landscape, design baseline)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ░░ STATUS BAR (56px) — fiscal/cash/conexión héroe                           │  ← Zone S
├─────────────────────────────────────────────────────────────────────────────┤
│                                                       │                     │
│ ░░ CART RAIL (340px)                                  │ ░░ CATALOG (rest)   │
│                                                       │                     │
│  - Customer slot (opcional)                           │  - Search universal │  ← Zone C
│  - Items (scroll)                                     │  - Categorías chips │     +
│  - Promotions / discounts                             │  - Grid de items    │  ← Zone K
│  - Subtotal                                           │    (responsive 3-5  │
│  - Fiscal preview                                     │     cols)           │
│  - Total grande                                       │                     │
│                                                       │                     │
├───────────────────────────────────────────────────────┴─────────────────────┤
│ ░░ ACTION BAR (88px) — keyboard hint row + CTA Cobrar grande                │  ← Zone A
└─────────────────────────────────────────────────────────────────────────────┘
```

**Por qué este layout** (no negociable F0):
- **Cart fixed left + always visible**: el cajero debe **VER** lo que está cobrando todo el tiempo. Cart escondido en drawer = error.
- **Catalog domina visualmente**: agregar items es la acción más frecuente. Más superficie = menos tiempo de búsqueda.
- **Status fiscal arriba**: si AFIP cae, el cajero lo ve **antes** de empezar la venta — no después de tener al cliente esperando.
- **Action bar sticky bottom**: el CTA "Cobrar" siempre a 1 click/tap. Atajos visibles aborta la curva de aprendizaje.

### Responsive (1440+ desktop)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STATUS BAR (56px)                                                            │
├──────────────┬──────────────────────────────────────────────────┬────────────┤
│              │                                                  │            │
│  SIDEBAR     │  CATALOG (cols 5-6)                              │  CART      │
│  (88px)      │                                                  │  RAIL      │
│  iconos      │                                                  │  (340px)   │
│  módulos     │                                                  │            │
│              │                                                  │            │
├──────────────┴──────────────────────────────────────────────────┴────────────┤
│ ACTION BAR (88px)                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

En desktop, **cart se mueve a la derecha** (acceso natural del cajero derecho) y aparece sidebar de módulos a la izquierda (Inventory, Reports, Settings) — visible solo en >1280px.

---

## 4. Zonas en detalle

### Zone S — Status bar (56px, sticky top, glass blur degradable)

Contenido de izquierda a derecha:

```
[ Pandora ◇ ] | Kiosco Río Grande #1 | Cajero: Agus     [AFIP ✓ 1.2s] [💵 $45.230 en caja] [⌚ 23:14]    [⚙][🔔][↗]
```

- **Logo + sale point + cashier**: contexto operativo. Nunca cambia durante la sesión.
- **AFIP status (componente clave)**:
  - 🟢 Verde con check + "1.2s" (último CAE recibido en 1.2s)
  - 🟡 Ámbar con clock + "lenta: 8s" (degradado)
  - 🔴 Rojo + "no responde" (contingencia activada)
  - Hover/tap → mini-dashboard con: last 10 CAEs, success rate última hora, próximo intento.
  - Esto es el **diferenciador #1**. Hacerlo SIEMPRE visible.
- **Cash drawer balance**: monto neto actual en caja (apertura + ventas efectivo − retiros). Updates real-time.
- **Hora**: server time NTP-synced (CLAUDE.md §11.5). Si drift > 5s muestra ⚠.

**Comportamiento crítico**: el status bar **NO oculta info al haber problemas** — si AFIP cae, el badge crece a explicar in-line (no abre modal). Anti-pattern §14.13.

### Zone C — Cart rail (340px fixed left, density tight)

```
┌──────────────────────────────────┐
│ Cliente: Consumidor final     [+] │  ← Customer slot
├──────────────────────────────────┤
│                                  │
│  ┌────────────────────────────┐  │
│  │ Coca 600ml          x2    │  │  ← Item
│  │ $1.800       [—] 2 [+]   │  │     row con stepper inline
│  │ 🏔 Ley 19.640 (TDF)       │  │     (badge cuando aplica)
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ Marlboro Box 20    x1     │  │
│  │ $4.500                    │  │
│  └────────────────────────────┘  │
│                                  │
│  [+ Agregar manualmente]         │
│                                  │
├──────────────────────────────────┤
│ Descuento aplicado: −$200  [x]   │  ← Discounts/promos
├──────────────────────────────────┤
│ Subtotal           $6.100        │
│ IVA (21%)         $1.281         │
│ Exento Ley 19.640   $378         │
│ Total                            │  ← Fiscal breakdown
│ $7.759                           │     legible (Ley 27.743)
├──────────────────────────────────┤
│  [F5 Cobrar  $7.759]             │  ← In-cart shortcut clue
└──────────────────────────────────┘
```

**Detalles críticos**:
- **Item row**: nombre + qty stepper inline + total. Hover/focus → aparece [✕] eliminar a la derecha (no en estado normal — evita errores).
- **Badge Ley 19.640**: solo cuando producto.`tdf_exempt = true` Y comercio `merchant_special_regime = LEY_19640` Y `transaction_in_special_zone = true`. Color azul Dawn Sky distintivo. Hover → tooltip "Producto exento Ley 19.640 — no paga IVA".
- **Fiscal breakdown ALINEADO con Ley 27.743**: subtotal sin impuestos / IVA / "Otros impuestos nacionales indirectos" / exento. Esto es lo que va al ticket impreso (CLAUDE.md §8.6).
- **Total grande** (text-4xl + tabular-nums + Dawn Sky accent). Es el número que el cliente mira.
- **Customer slot empty**: muestra "Consumidor final" (default). Tap/click + F3 → modal de búsqueda CUIT/DNI con autocomplete + opción "crear nuevo".

### Zone K — Catalog (resto del espacio, density compact)

```
┌──────────────────────────────────────────────────────────────┐
│  🔍  Buscar producto, escanear, o cliente...      [⌘K]      │  ← Search universal
├──────────────────────────────────────────────────────────────┤
│  [Todos] [Bebidas] [Cigarrillos] [Golosinas] [Limpieza]...   │  ← Categories chips
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐               │
│   │ 🥤   │ │ 🥤   │ │ 🍫   │ │ 🚬   │ │ 🍿   │               │
│   │Coca  │ │Sprite│ │Block │ │Marlb │ │Doritos│               │
│   │600ml │ │600ml │ │Choco │ │Box   │ │250g  │               │
│   │$1800 │ │$1750 │ │$650  │ │$4500 │ │$2200 │               │
│   │stock:│ │stock:│ │stock:│ │stock:│ │stock:│               │
│   │ 42   │ │ 38   │ │ 15   │ │  8   │ │ 22   │               │
│   └──────┘ └──────┘ └──────┘ └──────┘ └──────┘               │
│                                                              │
│   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐               │
│   │ ...                                          │           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Detalles críticos**:
- **Search universal (⌘K / F2)**: busca productos por nombre / código / barcode + clientes + comandos ("aplicar descuento 10%", "abrir cajón"). Resultados en dropdown con grupos.
- **Categorías chips**: horizontal scroll si > 8. Tap → filtra. Activa con fondo Dawn Sky accent.
- **Product card**:
  - Foto (placeholder ícono si no hay foto)
  - Nombre 2 líneas máx + ellipsis
  - Precio tabular-nums
  - Stock indicator: número con color semántico (verde >20, ámbar 5-20, rojo <5, gris "sin stock")
  - Badge Ley 19.640 si aplica (esquina superior derecha)
- **Tap/click producto** → animación `pop-success` micro + agregar al carrito + counter ++ si ya estaba.
- **Long-press / shift-click** → modal cantidad + opciones avanzadas (precio modificado, nota).

**Empty state catalog** (no hay productos):
```
🎁  Aún no tenés productos cargados
[+ Agregar el primero]   o   [↗ Importar desde CSV]
```

### Zone A — Action bar (88px, sticky bottom, glass blur)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ F2 Buscar  F3 Cliente  F4 Hold  F6 Cancelar  F7 Desc  F8 Imprimir  F9 Cajón │
├──────────────────────────────────────────────────────────────────────────────┤
│                                          [   F5  COBRAR  $7.759  →   ]      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Keyboard hint row** (32px): atajos visibles con su tecla y su acción. **No hay que adivinar**. Disabled si no aplica.
- **CTA Cobrar grande** (56px alto, full-width derecha): el botón héroe Dawn Sky. Muestra **total** en el botón — no hay duda de cuánto se cobra. F5 atajo + Enter funciona si focus está en cart.

---

## 5. Flujo de cobro (modal sheet, no full modal)

Cuando se pulsa Cobrar, **sheet sube desde abajo** (no oscurece toda la pantalla):

```
                                              ┌────────────────────────────────┐
                                              │  Cobrar $7.759                 │
                                              │                                │
                                              │  [Efectivo] [Tarjeta] [MP QR]  │  ← Tabs
                                              │                                │
                                              │  Recibido:                     │
                                              │  ┌────────────────────────┐   │
                                              │  │  $ 10.000              │   │  ← Input grande
                                              │  └────────────────────────┘   │
                                              │                                │
                                              │  Atajos:                       │
                                              │  [$8.000] [$10.000] [$15.000]  │
                                              │  [Exacto $7.759]               │
                                              │                                │
                                              │  Cambio:    $2.241             │
                                              │                                │
                                              │  [Cancelar]    [Confirmar →]   │
                                              └────────────────────────────────┘
```

**Tab Efectivo**:
- Input grande con autofocus
- Quick amounts inteligentes (calcula próximos múltiplos $500/$1000 sobre el total)
- Exacto button (= total)
- Cambio calculado en tiempo real
- Disabled "Confirmar" si recibido < total

**Tab Tarjeta**:
- Selector tipo (débito/crédito)
- Input cuotas (1/2/3/6/12)
- Recargo display si cuotas > 1
- Manual confirm de "cliente firmó / chip OK"

**Tab MP QR** (Bloque 5 Sprint 5 cuando se implemente):
- QR generado en pantalla grande
- Status WebSocket en tiempo real: pending → approved
- Auto-confirm en approved + countdown 3s con opción cancelar

### Estado intermedio crítico: "Conectando con AFIP..."

Después de confirmar, **modal NO se cierra**. Cambia a estado de progreso:

```
                                              ┌────────────────────────────────┐
                                              │  Procesando...                 │
                                              │                                │
                                              │     [icono pulsing]            │
                                              │                                │
                                              │  Cobro: ✓ Registrado           │
                                              │  Stock: ✓ Actualizado          │
                                              │  AFIP: ⟳ Solicitando CAE...   │
                                              │         (1.2s)                 │
                                              │                                │
                                              │  No cierres esta pantalla.     │
                                              │  En 30s te avisamos.           │
                                              └────────────────────────────────┘
```

**Por qué este detalle es VITAL**: el cajero ve cada paso. Si AFIP tarda, **sabe** que cobro y stock ya están OK. No vuelve a apretar Confirmar. No empieza a cancelar pensando que falló.

### Resultado happy: CAE recibido
- ✅ animación `pop-success` 350ms
- Ticket preview montado en sheet
- Mensaje: "Listo. CAE 75123456789012. $2.241 de cambio."
- [Imprimir] [Cerrar] + auto-cierre 8s

### Resultado timeout 30s
- 🟡 Sheet cambia a **estado contingencia** con mensaje claro:
  - "AFIP no respondió. La venta quedó registrada y vamos a obtener el CAE en unos minutos. Vas a recibir el comprobante por email cuando llegue."
  - [OK, entendido]
- Sale queda en `requires_reconciliation`. Worker async retoma. (CLAUDE.md §8.4 — pendiente A-2 + B-6 modelo "constancia provisoria".)

### Resultado rechazo AFIP
- 🔴 Sheet con error específico (mapping CAE_DENEGADO → mensaje legible):
  - "AFIP rechazó: CUIT del cliente inactiva. Verificá los datos y reintentá."
  - [Reintentar] [Cambiar cliente] [Cancelar venta]

---

## 6. Atajos de teclado (lista canónica)

Reglas:
- Toda acción crítica tiene atajo
- Atajos universales (Cmd/Ctrl) para meta-acciones; F-keys para flow operativo
- Visibles en action bar + en mini-help (F1)

| Tecla | Acción | Cuándo disponible |
|---|---|---|
| **F1** | Ayuda / mini cheat-sheet | Siempre |
| **F2** | Focus search universal | Siempre |
| **F3** | Buscar / nuevo cliente | Siempre que no esté en modal |
| **F4** | Hold carrito actual (multi-cart) | Hay items en carrito |
| **F5** | Cobrar (abrir sheet) | Hay items en carrito |
| **F6** | Cancelar venta (con razón obligatoria) | Hay items en carrito |
| **F7** | Aplicar descuento | Hay items en carrito |
| **F8** | Reimprimir último ticket | Hubo ventas hoy |
| **F9** | Abrir cajón monedero | Cash session abierta |
| **F10** | Pausa rápida / lock screen | Siempre |
| **F11** | (reservado fullscreen browser) | — |
| **F12** | Cierre Z / fin de día | Cash session abierta + admin role |
| **Enter** | Confirmar modal activo o cobrar si focus cart | Contextual |
| **Esc** | Cancelar modal / quitar focus search | Contextual |
| **⌘K / Ctrl+K** | Universal command palette (productos + clientes + acciones) | Siempre |
| **+/−** | Stepper cantidad item con focus | Item enfocado en cart |
| **Backspace** | Remover último item del cart | Cart con focus |
| **1–9** (numpad) | Quick amount en cobro | Modal cobro abierto |

---

## 7. Estados fiscales como UX first-class

Cada estado de `sales.fiscal_status` (CLAUDE.md §12.2) tiene **tratamiento visual propio**. No es texto chico — es color + ícono + mensaje + acción sugerida.

| Estado | Color | Ícono | Mensaje cajero | Acción primaria |
|---|---|---|---|---|
| `not_required` | gris | ⊝ | "Venta sin facturación" | — |
| `pending` | gris claro | ◷ | "Lista para facturar" | — |
| `requesting` | ámbar pulsing | ⟳ | "Solicitando CAE a AFIP..." | (esperar) |
| `issued` | verde | ✓ | "CAE 7512345..." | Imprimir |
| `reconciled_issued` | verde Dawn Sky | ✓ | "CAE obtenido por reconciliación" | Imprimir + nota |
| `requires_reconciliation` | ámbar | ⏱ | "Esperando AFIP — reintentando cada 5min" | (esperar / continuar) |
| `contingency` | ámbar fuerte | ⚠ | "AFIP no responde — modo contingencia" | Ver runbook |
| `failed` | rojo | ✕ | "AFIP rechazó: [motivo]" | Corregir + reintentar |
| `number_burned` | rojo oscuro | ⚠ | "Número fiscal perdido" | Resolución técnica |
| `manual_resolution_required` | rojo oscuro | ⚠ | "Requiere intervención" | Llamar soporte |

**Sección "Ventas hoy" con filtros por estado** — el cajero puede ver al toque cuántas ventas hay en cada estado.

---

## 8. Density, motion, glass (decisiones cerradas)

### Density (ADR-0017)
```css
[data-atmosphere="operational"][data-zone="cart"] { --density: 4px; }   /* tight */
[data-atmosphere="operational"][data-zone="catalog"] { --density: 8px; } /* compact */
[data-atmosphere="operational"][data-zone="status"] { --density: 12px; } /* mid */
[data-atmosphere="operational"][data-zone="action"] { --density: 16px; }/* comfortable */
```

Padding/gap derivan de `--density * N`.

### Motion presets (ADR-0015 — lista cerrada operacional)
- `fade-in-fast` 150ms ease-out — apariciones simples
- `slide-up-modal` 250ms cubic-bezier(0.16, 1, 0.3, 1) — sheets / drawers
- `pop-success` 350ms cubic-bezier(0.34, 1.56, 0.64, 1) — add-to-cart, CAE recibido
- `pulse-pending` 1200ms ease-in-out loop — estados de espera (requesting CAE)
- `shake-error` 300ms — rechazo de AFIP, error visible (sin abusar)

**Prohibido en operational**: animaciones decorativas de fondo, hover effects >200ms, scroll-triggered animations en catalog.

### Glass system (ADR-0013)
- **Status bar**: glass blur 16px + Dawn Sky tinted background. Degradable a solid color en hardware bajo.
- **Action bar**: glass blur 20px + Dawn Sky tint. Degradable.
- **Modal sheet cobro**: glass blur 24px sobre background dimmed. Degradable.
- **Cart rail**: NO glass — siempre solid para máxima legibilidad de números.
- **Catalog cards**: NO glass — productos primero.

Detección de capability al boot:
```typescript
const supportsGlass = (
  CSS.supports('backdrop-filter', 'blur(20px)') &&
  navigator.hardwareConcurrency >= 4
);
document.documentElement.dataset.glass = supportsGlass ? 'full' : 'degraded';
```

---

## 9. Tokens Dawn Sky (decisiones cerradas)

Paleta oklch (CSS custom properties en `globals.css`):

```css
:root {
  /* Surface */
  --surface-base: oklch(98% 0.005 240);
  --surface-elevated: oklch(99% 0.003 240);
  --surface-glass: oklch(98% 0.005 240 / 0.72);
  --surface-overlay: oklch(15% 0.02 240 / 0.55);

  /* Text */
  --text-primary: oklch(20% 0.02 240);
  --text-secondary: oklch(45% 0.015 240);
  --text-muted: oklch(60% 0.01 240);
  --text-inverse: oklch(98% 0.005 240);

  /* Brand Dawn Sky */
  --brand-dawn-50:  oklch(97% 0.03 240);
  --brand-dawn-200: oklch(85% 0.09 240);
  --brand-dawn-500: oklch(62% 0.18 240);  /* Primary accent */
  --brand-dawn-700: oklch(48% 0.16 240);  /* Hover/pressed */
  --brand-dawn-900: oklch(28% 0.10 240);  /* Text on light */

  /* Semantic */
  --semantic-success: oklch(64% 0.18 145);
  --semantic-warning: oklch(75% 0.16 75);
  --semantic-error: oklch(60% 0.21 25);
  --semantic-info: oklch(65% 0.15 220);

  /* Fiscal-specific (NUEVO Pandora) */
  --fiscal-tdf:       oklch(60% 0.20 210);  /* Azul Ley 19.640 */
  --fiscal-cae:       oklch(64% 0.18 145);  /* Verde CAE OK */
  --fiscal-pending:   oklch(75% 0.16 75);   /* Ámbar pending */
  --fiscal-contingency: oklch(65% 0.20 35); /* Rojo-naranja */

  /* Typography */
  --font-display: 'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace;
  --text-amount: 'tabular-nums';

  /* Sizing */
  --total-display-size: clamp(2.5rem, 4vw, 4rem);  /* Total cart */
  --price-tile-size: 1.125rem;
  --status-badge-size: 0.875rem;
}
```

---

## 10. Component breakdown (orden de implementación)

### Sprint POS-A — Foundation (1 sesión)
1. `<POSLayout>` shell con grid zones (S/C/K/A)
2. `<StatusBar>` con slots para fiscal/cash/clock
3. `<ActionBar>` con keyboard hint row + CTA Cobrar
4. `<CartRail>` shell vacío + responsive
5. Tokens Dawn Sky en `globals.css`
6. `[data-atmosphere="operational"]` density rules
7. **Tests visual baseline** Playwright (screenshots 1024×768, 1440×900)

### Sprint POS-B — Catalog (1 sesión)
8. `<UniversalSearch>` con cmdk integrado (Cmd+K)
9. `<CategoryChips>` horizontal scrollable
10. `<ProductCard>` con stock indicator + badge Ley 19.640
11. `<ProductGrid>` responsive con virtualization para >100 items
12. Hook `useProducts({ tenantId, category, search })` server-side
13. Animation `pop-success` en add-to-cart
14. **Tests interactivos**: agregar item, búsqueda, filtro categoría

### Sprint POS-C — Cart & checkout (1 sesión)
15. `<CartItem>` con stepper inline + hover delete
16. `<CartCustomerSlot>` con modal customer search
17. `<CartFiscalBreakdown>` alineado Ley 27.743
18. `<CartTotal>` display grande con tabular-nums
19. `<PaySheet>` con tabs Efectivo / Tarjeta / MP QR (MP placeholder)
20. `<PayProgressModal>` con steps cobro → stock → AFIP
21. **Tests flow completo**: agregar items → cobrar efectivo → finalize (mock fiscal_status='not_required')

### Sprint POS-D — Polish & states (1 sesión)
22. `<FiscalStatusBadge>` con 10 estados visuales (§7)
23. `<AfipStatusHero>` en status bar con mini-dashboard hover
24. `<EmptyState>` variants (cart, catalog, search results)
25. `<ErrorState>` AFIP rechazo + UX recovery
26. Keyboard shortcuts hook `useKeyboardShortcuts()`
27. F1 help mini-modal
28. **Tests a11y** (axe-core + keyboard navigation)
29. **Tests performance** (Lighthouse + 60fps catalog scroll)

### Sprint POS-E (opcional, post-validación) — Diferenciadores
30. Multi-cart (F4 hold + retomar)
31. Quick-suggestions per hora del día (kioskero a las 11pm = cigarrillos)
32. Print preview ticket pre-AFIP
33. Cash drawer real-time + Z preview
34. Receipt design Pandora editorial

---

## 11. Performance budget (no negociable)

| Métrica | Target | Cómo medir |
|---|---|---|
| LCP POS first load | < 2s | Lighthouse |
| Catalog scroll | 60fps consistente | Chrome DevTools perf |
| Add-to-cart feedback | < 100ms | Performance.mark |
| Search results render (≤50 items) | < 150ms | Performance.mark |
| Pay sheet open | < 80ms | Performance.mark |
| Bundle size POS page | < 250kb gzipped | Next bundle analyzer |
| Animation thread blocking | 0 | Long task observer |

---

## 12. Accessibility (WCAG AA mínimo)

- Todo botón con `aria-label` cuando icon-only
- Contraste 4.5:1 mínimo (text-primary sobre surface-base = 14:1, supera)
- Focus visible en TODO interactivo (outline 2px Dawn Sky 500)
- Keyboard navigation completa SIN excepción
- `aria-live="polite"` para AFIP status changes
- `aria-live="assertive"` para errores críticos (rechazo AFIP)
- `prefers-reduced-motion` → motion presets se reducen al 50% duration
- Screen reader-friendly cart updates (`role="region"` + `aria-label="Carrito"`)

---

## 13. Plan de validación con cajero real

**Antes de Sprint POS-E (después de A-D)**:

1. **Demo grabado** (video 90s) mostrando: abrir → buscar → agregar 3 items → cobrar efectivo → cambio → status fiscal mock OK.
2. **Mostrar al papá rotisería** (cliente confirmado #2): ¿qué le falta? ¿qué le sobra? ¿le sirve la tablet?
3. **Mostrar a 2 kioskeros TDF** (pendientes): mismo guión + preguntas de uso real (¿cigarrillos por código? ¿cuántos productos tenés?).
4. **Iterar** sobre feedback antes de seguir polish.

**Antes de Sprint POS-D**: parar y hacer **lectura tipográfica** + check Dawn Sky en pantalla real (no solo Figma). El monitor del owner es Windows — verificar también en tablet Android común y en iPad si hay acceso.

---

## 14. Anti-patterns explícitos (rechazar si aparecen)

- ❌ Modal full-screen para cobrar (oscurece cart — el cajero pierde contexto)
- ❌ Animaciones de hover en productos > 200ms (lentea la operación)
- ❌ Status fiscal escondido en menú (DIFERENCIADOR perdido)
- ❌ Búsqueda con debounce > 200ms (frustra cajero rápido)
- ❌ Iconos sin label en F-keys (cajero novato no aprende)
- ❌ Confirmación de pago en 2 pasos sin razón (acelerar)
- ❌ Texto en inglés en strings de UI (target ES rioplatense)
- ❌ Carga lazy del catálogo principal (debe estar listo al primer paint)
- ❌ Cualquier emoji en estados fiscales serios (CLAUDE.md no emoji en UI)
- ❌ Color como única señal (siempre acompañar con texto/ícono — WCAG)
- ❌ Stock count con decimales (todos son integers en F0)
- ❌ "Are you sure?" para cancelar — usar undo con timeout en su lugar (excepto delete masivo)

---

## 15. Decisiones abiertas (a confirmar con uso real)

| Tema | Opciones | Cuándo decidir |
|---|---|---|
| Sound feedback (beep al agregar item) | sí / opcional / no | Validación con cajero |
| Print automático vs manual | auto post-CAE / manual con confirmación | Validación |
| Modo "cliente esperando" (visible al cliente) | implementar / no F0 | F0.5 |
| Tema oscuro POS | F0 / F1+ | Pendiente — el operacional típico es light, pero kiosco nocturno puede pedirlo |
| Customer display pole/segunda pantalla | F1+ | No F0 |

---

## 16. Mapping a código existente

| Componente | Wire-up a service |
|---|---|
| `<CartItem>` qty change | `cartService.updateQty(saleId, productId, qty)` |
| `<CartCustomerSlot>` set customer | `salesService.setSaleCustomer(saleId, customer)` |
| `<PaySheet>` confirm efectivo | `salesService.finalizeSale(saleId, { method: 'cash', ... })` |
| `<UniversalSearch>` busca producto | `inventoryService.searchProducts({ tenantId, query })` |
| `<StatusBar>` cash balance | `cashService.getCurrentBalance(tenantId, salePointId)` |
| `<AfipStatusHero>` | `metricsService.getRecentFiscalMetrics(tenantId)` (whitelist `afip.cae_received`) |
| `<FiscalStatusBadge>` | reactivo a `sales.fiscal_status` via Realtime broadcast (F0 fallback: refresh on focus) |

Todos los services ya tienen tests verde (792 actual).

---

## 17. Riesgos identificados

1. **Tablet vs desktop diff real**: el target real es tablet pero el owner está desarrollando en desktop. **Mitigación**: test continuo en tablet emulator + verificación con tablet física antes de validación con cajero.
2. **Performance con catálogos grandes**: si un kiosco tiene 800 productos, grid sin virtualization mata el render. **Mitigación**: virtualization desde Sprint POS-B con `@tanstack/react-virtual` o equivalente.
3. **Dawn Sky en monitor de baja calidad**: oklch colors pueden verse muy distinto. **Mitigación**: snapshot tests en CI con valores RGB convertidos + verificación visual en pantalla real cajero.
4. **AFIP status visible PERO no funcional F0**: hasta Sprint 6 fiscal real, el AFIP status mostrará "homologación / mock". **Mitigación**: copiar de homologación real para que la UI esté lista cuando se conecte. NO mostrar `mock` en producción.

---

## 18. Trazabilidad

- ADR-0012 — 3 atmospheres → POS es **Operational**
- ADR-0013 — Glass system → §8 reglas concretas
- ADR-0014 — Charts SVG → no aplica POS (es Insight atmosphere)
- ADR-0015 — Motion presets → §8 lista cerrada operacional
- ADR-0016 — Dawn Sky → §9 tokens
- ADR-0017 — Density obligatoria → §8 density rules
- CLAUDE.md §14 — UI/UX Constitution → todo este doc respeta
- CLAUDE.md §14.13 — forbidden patterns → §14 acá los repite con más detalle
- CAPABILITY-MAP.md — capabilities Sales/Inventory/Cash → §16 mapping

---

## 19. Estado del doc

**v1.0 — 2026-06-13** — primera versión spec base.

**Próximas iteraciones esperadas**:
- v1.1 post-Sprint POS-A: ajustes después de probar tokens reales
- v1.2 post-validación cajero: cambios reales en flujo
- v2.0 cuando se valide con 3+ comerciantes piloto

---

**Tagline interno del POS Pandora**:
> "El único POS argentino donde AFIP es la primera cosa que ves, no la última que descubrís cuando algo falla."

Esa es la promesa. Todo lo demás existe para no traicionarla.
