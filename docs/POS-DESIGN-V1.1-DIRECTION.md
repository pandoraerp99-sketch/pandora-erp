# POS Design Direction v1.1 — Dawn Industrial Editorial

**Fecha:** 2026-06-13
**Versión:** 1.1 (extiende v1.0)
**Estado:** dirección visual COMPROMETIDA (no múltiples opciones — una decisión)
**Documento padre:** [POS-DESIGN-V1.md](POS-DESIGN-V1.md)

---

## 0. Por qué este doc existe

v1.0 dejó la spec funcional cerrada pero la **dirección visual** en abstracto ("Dawn Sky", "atmospheres", "glass"). Esto es esa decisión hecha concreta: **un estilo nombrado, con valores oklch cerrados, tipografía elegida, estrategia de capas, y motion definitivo**.

No hay opciones múltiples acá. **Una dirección, ejecutada con convicción**.

---

## 1. El estilo: Dawn Industrial Editorial (DIE)

Tres voces conviviendo, cada una con función:

### Dawn — atmósfera y alma
Paleta sky/dawn. Es la luz del amanecer en Tierra del Fuego: azul frío profundo que se va calentando hacia el horizonte. La paleta navega de hue 240 (azul frío) a hue 210 (azul tibio) en steps controlados. No es "azul plano".

**Función operacional**: respiración visual. El POS pasa horas frente al cajero — la paleta debe ser **calmante bajo presión**, no estimulante. Dawn da contexto emocional sin distraer.

### Industrial — datos como terminal
**Monospace tabular para todo dato fiscal**: totales, IVA, CAEs, CUITs, tickets. Geist Mono con `font-variant-numeric: tabular-nums` + tracking ajustado.

**Por qué crítico**: el competidor argentino usa fonts genéricos para los números. Resultado: la app se ve como "Excel de kiosco". Cuando el money está en monospace tabular, el cerebro lee "Sistema serio, auditable, profesional". Diferenciador subliminal real.

**Función operacional**: alineación vertical perfecta cuando se listan precios en columna. El cajero escanea total sin tener que enfocar — los dígitos están donde el ojo espera.

### Editorial — jerarquía de magazine
Jerarquía tipográfica con **un serif display puntual** (Instrument Serif) para "el número héroe" (Total cart + número de CAE recibido). El resto en Geist Sans.

**Función operacional**: el Total es el número que el **cliente** mira. Si está en sans corriente, es funcional. Si está en serif editorial con tamaño hero, transmite **valor**, **carácter** y **confianza visual**. Pandora hace esa promesa.

**Por qué no full serif**: serif everywhere = revista, no app rápida. Un solo serif puntual = "este número importa".

---

## 2. Anti-patterns explícitos rechazados (el skill los cita; los descartamos)

| Anti-pattern | Por qué lo evitamos |
|---|---|
| Card grid simétrico SaaS | El catalog SÍ es grid (es lo correcto), pero el LAYOUT global del POS rompe simetría (cart fixed left ≠ catalog grid). No es "tres cards iguales". |
| Purple gradient on white | Era el `themeColor: '#6b5fff'` del layout original. Cambiado a Dawn Sky 500. |
| Glass everywhere | Glass SOLO en 2 superficies: action bar bottom + pay sheet modal. Resto: solid surfaces con shadows finas. (Sección 5 desarrolla.) |
| Hero genérico | El POS no tiene "hero" en sentido marketing. El hero **es** el Total + AFIP status, embedded en la operación. |
| Random accents | Sistema cerrado de 4 acentos semánticos + 4 fiscales-specific. Nada fuera de esa lista. |
| Micro-interactions everywhere | 6 motion presets cerrados. Sin hover effects gratuitos. Una sola "celebración" (CAE recibido). |
| Flat empty backgrounds | Surface base tiene **noise texture sutil** (10% opacity SVG 2x2 pattern) + status bar tiene gradient horizontal sutil dawn-50 → dawn-100 (referencia: amanecer real). |

---

## 3. Paleta cerrada — valores oklch finales

### Surface scale (light mode — default)
```css
--surface-base:      oklch(98.5% 0.005 240);  /* Casi blanco, tinte sky frío imperceptible */
--surface-sunken:    oklch(96.8% 0.008 238);  /* Hover catalog cards */
--surface-elevated:  oklch(99.2% 0.003 240);  /* Cart panel, sidebar */
--surface-raised:    oklch(99.6% 0.002 240);  /* Cart items hover */
--surface-overlay:   oklch(15% 0.020 240 / 0.55); /* Modal backdrop */
```

### Text scale
```css
--text-primary:      oklch(18% 0.020 240);  /* Ink dark — casi negro pero con alma sky */
--text-secondary:    oklch(42% 0.015 238);  /* Body secundario */
--text-muted:        oklch(60% 0.010 235);  /* Hints, captions */
--text-emphasis:     oklch(28% 0.100 230);  /* Editorial accent on light */
--text-inverse:      oklch(98.5% 0.005 240); /* Sobre surfaces dark */
```

### Dawn Sky brand scale (la paleta CORE — la navegación hue 230→210 es intencional)
```css
--dawn-50:   oklch(97.0% 0.025 230);  /* Niebla matinal — backgrounds sutiles */
--dawn-100:  oklch(94.0% 0.045 228);  /* Cielo alto pre-amanecer */
--dawn-200:  oklch(86.0% 0.090 225);  /* Celeste claro */
--dawn-300:  oklch(76.0% 0.140 222);  /* Cielo medio */
--dawn-400:  oklch(68.0% 0.175 220);  /* Azul intenso de las 6am */
--dawn-500:  oklch(60.0% 0.195 218);  /* ★ PRIMARY — Dawn Sky core */
--dawn-600:  oklch(52.0% 0.180 216);  /* Hover / pressed */
--dawn-700:  oklch(42.0% 0.150 214);  /* Dark accent */
--dawn-800:  oklch(32.0% 0.115 212);  /* Text on light surfaces */
--dawn-900:  oklch(22.0% 0.080 210);  /* Deep ink — tibio sutil */
```

**Por qué hue 230→210**: el cielo real al amanecer pasa de hue frío profundo (cuando aún hay restos de noche, ~240) a tibio cálido cuando el sol asoma (~205-210). Cada step de la paleta refleja un momento de ese pase. **No es decoración** — es referencia visual a la geografía TDF del owner.

### Semantic scale (cool y editorial, no banales)
```css
--semantic-success: oklch(62% 0.175 148);  /* Verde teal — no neón */
--semantic-warning: oklch(76% 0.155 78);   /* Ámbar warm */
--semantic-error:   oklch(58% 0.215 27);   /* Coral — más editorial que rojo puro */
--semantic-info:    oklch(64% 0.155 215);  /* Sky distinto del brand */
```

### Fiscal-specific (DIFERENCIADOR Pandora — el badge Ley 19.640 lo usa)
```css
--fiscal-tdf:           oklch(58% 0.210 205);  /* Turquesa-azul Ley 19.640 (distinto de dawn) */
--fiscal-cae-ok:        oklch(62% 0.175 148);  /* = success */
--fiscal-cae-pending:   oklch(76% 0.155 78);   /* = warning */
--fiscal-cae-error:     oklch(58% 0.215 27);   /* = error */
--fiscal-contingency:   oklch(65% 0.195 35);   /* Naranja warning fuerte */
```

**Por qué fiscal-tdf en hue 205** y no en dawn: necesita ser **distinguible** del brand. Dawn es la atmósfera, TDF es información. Cyan-teal en 205 hace que el badge salte sin gritar.

---

## 4. Typography pairing definitivo

Tres familias, cada una con función indubitable:

| Familia | Uso | Cargada de |
|---|---|---|
| **Geist Sans** | UI base, body, labels, botones, navigation | `next/font/google` (ya cargada) |
| **Geist Mono** | Money, totales, CUITs, CAEs, IDs, códigos de barra | `next/font/google` (ya cargada) |
| **Instrument Serif** | Total héroe (hero number) + número CAE recibido | `next/font/google` (a agregar) |

### Por qué Instrument Serif y no [otras opciones consideradas]

- ❌ Fraunces — demasiado decorativo, no "operational"
- ❌ EB Garamond — clásico pero blando
- ❌ Söhne — comercial caro
- ❌ GT America — sans, no aporta contraste con Geist
- ✅ **Instrument Serif** — serif transitional, **gratis Google Fonts**, peso característico, italics expresivos, **funciona excelente a tamaño grande** (es justo donde lo usamos).

Es el serif que estás viendo en Vercel/Linear/v0 para números hero. Funciona porque tiene **personalidad sin perder funcionalidad**. Es lo que el skill llama "fonts with character".

### Reglas de uso
- **Instrument Serif** solo en 2 lugares:
  1. `<CartTotal>` el monto total grande (text-6xl / 64-80px)
  2. `<CaeNumber>` cuando se recibe CAE, en momento de éxito (text-3xl / 32px)
- **Geist Mono** para TODO dato numérico fiscal/money/identificador
- **Geist Sans** todo el resto (labels, botones, body, status text)

### Escala tipográfica
```css
--font-display:       'Instrument Serif', Georgia, serif;
--font-sans:          'Geist Sans', system-ui, sans-serif;
--font-mono:          'Geist Mono', 'SF Mono', monospace;

--text-display-hero:  clamp(3.5rem, 8vw, 5rem);   /* 56-80px — Total cart */
--text-display-md:    clamp(2rem, 4vw, 3rem);     /* 32-48px — CAE recibido */
--text-headline:      1.5rem;                     /* 24px — section titles */
--text-body-lg:       1.125rem;                   /* 18px — labels prominentes */
--text-body:          0.9375rem;                  /* 15px — body */
--text-caption:       0.8125rem;                  /* 13px — captions, status */
--text-micro:         0.6875rem;                  /* 11px — keyboard hints */
```

---

## 5. Layering strategy — 4 niveles con propósito

El glass system NO es "todo cristal". Es **4 niveles de elevación**, cada uno con uso semántico distinto.

### Layer 0 — Stage (catálogo, fondo principal)
```css
background: var(--surface-base);
background-image: url("data:image/svg+xml,...noise..."); /* 2x2 noise 10% opacity */
```
**Cuándo**: piso del POS. Catalog grid vive acá. Status bar también.
**Por qué noise**: rompe la planitud sin gritar. El skill pide "atmosphere", esto la da.

### Layer 1 — Operational surfaces (cart, sidebars)
```css
background: var(--surface-elevated);
border: 1px solid oklch(94% 0.020 235);
box-shadow:
  0 0 0 1px oklch(94% 0.020 235),
  0 1px 2px oklch(20% 0.020 240 / 0.04);
```
**Cuándo**: paneles funcionales que necesitan presencia visual pero **NO** flotar. Cart rail, sidebar desktop.
**Por qué NO glass**: el cajero LEE estos paneles todo el tiempo. Glass = lectura más difícil = pierde la apuesta.

### Layer 2 — Action surfaces (action bar bottom, pay sheet)
```css
background: oklch(98.5% 0.005 240 / 0.78);
backdrop-filter: blur(24px) saturate(140%);
border-top: 1px solid oklch(94% 0.020 235);
box-shadow: 0 -8px 32px oklch(20% 0.040 240 / 0.06);
```
**Cuándo**: superficies que SOLICITAN acción. Action bar (CTA Cobrar) + pay sheet modal.
**Por qué SÍ glass acá**: porque flotan semánticamente sobre el contenido. El glass dice "estoy por encima de lo que estabas haciendo".
**Degradación hardware bajo**: fallback solid `var(--surface-elevated)` + shadow más marcado.

### Layer 3 — Critical alerts (errores fiscales, AFIP rejected)
```css
background: var(--surface-elevated);
border: 2px solid var(--semantic-error);
border-left: 4px solid var(--semantic-error);
box-shadow:
  0 0 0 1px var(--semantic-error),
  0 4px 24px oklch(58% 0.215 27 / 0.18);
```
**Cuándo**: AFIP rechazó, error crítico, intervención requerida.
**Por qué NO glass**: glass = elegante = no transmite urgencia. Un error fiscal **debe verse urgente, no bonito**.

### Resultado: 4 superficies, 4 lenguajes visuales distintos
- Stage: respira
- Operational: contiene
- Action: invita
- Critical: alerta

Si todo fuera glass, nada sería importante. Esto **es** la diferencia con glassmorphism template.

---

## 6. Composition — rompemos el grid intencionalmente

El skill dice "Avoid defaulting to a symmetrical card grid unless it is clearly the right fit."

### Layout global asimétrico
```
┌─────────────────────────────────────┐
│   STATUS BAR (56px)                 │  ← single horizontal, asimétrico interno
├──────────┬──────────────────────────┤
│          │                          │
│  CART    │        CATALOG           │
│  340px   │        flex-1            │
│  FIXED   │        (grid SI)         │
│          │                          │
│          │                          │
├──────────┴──────────────────────────┤
│   ACTION BAR (88px) — gradiente fade│  ← CTA alineado derecha, no centrado
└─────────────────────────────────────┘
```

- **Cart fixed left + flex-1 catalog**: ratio NO 50/50. Cart 340px de ancho fijo + catalog devorador del resto. Asimetría operacional honesta.
- **Action bar CTA alineado derecha**: el botón "Cobrar" NO está centrado (genérico). Está alineado al borde derecho con padding, sutil flecha "→" implicando movimiento adelante (cobro = avance).
- **Status bar interno asimétrico**: el AFIP status indicator es **3× más grande** que los otros badges (cash, hora). No igualados → DIFERENCIADOR.

### Catalog grid SÍ es regular
Acá sí grid simétrico — porque LOS PRODUCTOS son una lista escaneable. Asimetría acá frenaría al cajero.

### CartItem usa overlap sutil
```
┌─────────────────────────────┐
│ Coca 600ml             x2   │
│ ┌──┐                        │
│ │🏔│ Ley 19.640              │  ← badge fiscal-tdf overlapping
│ └──┘ $1.800                 │
└─────────────────────────────┘
```
El badge Ley 19.640 hace overlap mínimo (-4px) sobre el item card. Da **profundidad** sin pedir glass.

---

## 7. Motion — uno bien hecho

Lista cerrada (6 presets, cada uno con CSS variable nombrada):

```css
--motion-duration-instant: 150ms;
--motion-duration-fast:    220ms;
--motion-duration-base:    280ms;
--motion-duration-slow:    420ms;
--motion-duration-celebration: 600ms;
--motion-duration-pending: 1400ms;

--motion-ease-out:      cubic-bezier(0.16, 1, 0.3, 1);
--motion-ease-soft-bounce: cubic-bezier(0.34, 1.20, 0.64, 1);
--motion-ease-linear:   linear;
```

| Preset | Duration | Easing | Uso |
|---|---|---|---|
| `fade-in-fast` | 150ms | ease-out | apariciones simples |
| `slide-up-sheet` | 280ms | ease-out | pay sheet, modals |
| `pop-add-cart` | 220ms | soft-bounce | item agregado al cart (NO exagerado) |
| `pulse-pending` | 1400ms loop | linear | AFIP requesting (lento = no ansioso) |
| `nudge-error` | 200ms | ease-out | error feedback (sin shake) |
| **`cae-celebration`** | 600ms compuesto | múltiple | **EL momento único** — CAE recibido |

### `cae-celebration` — el momento héroe

Cuando llega el CAE, una secuencia coreografiada (NO 20 micro-interactions random):

```
T=0ms:   pay sheet content fades out (150ms)
T=100ms: CAE number aparece en serif display + slide-up 16px (280ms ease-out)
T=380ms: Monto total cross-fade a "✓ Listo" con check semantic-success (220ms)
T=500ms: Ticket preview slides in from top (slide-up-sheet 280ms)
T=780ms: Auto-cierre countdown empieza con barra de progreso (8s linear)
```

Esto es **lo memorable**. Pasa una vez por venta. El cajero, después de 200 ventas, sigue notándolo. **Ese es el rol del motion** (el skill: "create one or two memorable moments").

### Prohibido
- ❌ Hover effects con duration > 150ms en operational
- ❌ Animaciones de fondo
- ❌ Scroll-triggered transitions en catalog
- ❌ Loading spinners decorativos (usar pulse-pending solo)
- ❌ Bounce en click feedback (soft-bounce mínima sí, full bounce no)

---

## 8. Spacing rhythm — lh-based + density

Spacing basado en `1lh` para que el ritmo sea **tipográficamente correcto** (no pixel-based arbitrario):

```css
--step-0:  0.25lh;  /* tight intra-element */
--step-1:  0.5lh;   /* between elements */
--step-2:  1lh;     /* between groups */
--step-3:  2lh;     /* between sections */
--step-4:  4lh;     /* page-level breathing */
```

Por zona del POS:
- Cart items: `--step-0` gaps internos + `--step-1` entre rows
- Catalog cards: `--step-1` gap + `--step-2` row gap
- Status bar paddings: `--step-1` vertical, `--step-2` horizontal
- Action bar: `--step-2` padding + `--step-3` para CTA breathing

---

## 9. Component primitives a construir (orden Sprint POS-A)

Esta v1.1 acompañada de 2 componentes ejemplares iniciales:

### Esta sesión (POS-A.1)
1. ✅ Tokens en `globals.css`
2. ✅ Instrument Serif cargado en `layout.tsx`
3. ✅ `<StatusBar>` — el héroe con AFIP visible 3× más grande
4. ✅ `<CartTotal>` — número editorial display
5. ✅ `app/pos/page.tsx` — preview tablet 1024×768 que el owner ve en navegador

### Próxima sesión (POS-A.2)
6. `<POSLayout>` shell con grid zones
7. `<ActionBar>` con keyboard hints + CTA
8. `<CartRail>` shell
9. Empty states de cart

### Sesión POS-B (catalog)
10. `<UniversalSearch>` con cmdk
11. `<ProductCard>` con stock indicator + badge Ley 19.640
12. `<ProductGrid>` virtualizado

---

## 10. Quality gate — antes de declarar Sprint POS-A terminado

- [ ] Tipografía: las 3 familias cargan + se usan donde corresponde (serif SOLO en hero numbers)
- [ ] Color: oklch values cerrados implementados + ningún color fuera del sistema
- [ ] Density: zones del POS tienen density correcto (tight/compact/mid/comfortable)
- [ ] Motion: 6 presets + ZERO hover effects gratuitos
- [ ] Layering: 4 niveles implementados + glass SOLO en layer 2
- [ ] Accessibility: focus visible Dawn 500, reduced-motion respetado, aria-live para fiscal status
- [ ] **No se siente AI-generated**: cada decisión tiene "por qué" no "por las dudas"
- [ ] Compose: layout asimétrico real (cart 340 fixed + catalog flex, NO 50/50)
- [ ] Atmosphere: surface base con noise texture sutil (no flat blanco template)
- [ ] **Esta dirección es replicable**: si traemos otro componente, sabemos QUÉ hacer

---

## 11. La promesa visual

> "El cajero entra al POS un lunes a las 8am. La luz del amanecer en TDF entra por la ventana. La pantalla **tiene la misma calma**. Las cifras se ven como un terminal financiero — auditables, serias. El total grande es lo que el cliente mira, y se ve como **un número que importa**. AFIP es lo primero, lo más grande, lo más claro. Cuando llega un CAE, la pantalla hace una sola cosa memorable. El cajero, al cierre Z, **no se cansó del visual**. Eso es Dawn Industrial Editorial."

Esa es la apuesta. Lo construido a continuación la honra o no.
