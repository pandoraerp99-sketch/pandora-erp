import type { Metadata, Viewport } from "next";
import "./fonts.css";
import "./globals.css";

/**
 * Instrument Serif se quitó el 2026-09-05.
 *
 * Existía para el "hero number" del total, del diseño de
 * `docs/POS-DESIGN-V1.1-DIRECTION.md` — el doc que quedó SUPERADO cuando se
 * decidió que las maquetas de `pos-preview/` son la autoridad visual. Su
 * único consumidor real era `<CartTotal>`, que quedó huérfano tras el reskin
 * del POS y se borró en este mismo commit.
 *
 * Quedaba una webfont bajando en CADA página para un componente que ya no
 * renderiza nadie. Si vuelve a hacer falta un display serif, se agrega junto
 * con el componente que lo use, no antes.
 */

/**
 * Las fuentes viven en `./fonts.css` (Inter + JetBrains Mono, auto-alojadas).
 *
 * ANTES ESTABA MAL Y NO SE VEÍA: se cargaban Geist y Geist Mono con
 * `next/font`, pero el CSS de TODAS las pantallas — copiado verbatim de
 * `pos-preview/` — pide `font-family:'Inter'` y `'JetBrains Mono'` por nombre.
 * Esas familias no existían, así que cada texto caía al sans-serif del sistema
 * y cada número al monospace genérico. Medido contra la maqueta en el mismo
 * navegador: "Monotributo" medía 64.08px acá y 71.36px en la maqueta, 11% más
 * angosto, en toda la app.
 *
 * No se usa `next/font` porque renombra la familia a un hash
 * (`__Inter_a1b2c3`) y el `font-family:'Inter'` literal del CSS copiado
 * seguiría sin resolver; la alternativa era editar ese CSS, que es lo único
 * que no hay que tocar.
 *
 * Y no van por <link> a Google porque el CSP (`style-src 'self'` +
 * `font-src 'self' data:`) las bloquea sin avisar — así fue como estuvieron
 * bloqueadas un rato acá. Auto-alojadas además abren con internet malo, que en
 * un mostrador pasa.
 */

export const metadata: Metadata = {
  title: "Pandora ERP",
  description: "POS + ERP fiscal para comercios pequeños argentinos. AFIP nativo. Hecho en Tierra del Fuego.",
  applicationName: "Pandora ERP",
};

/**
 * themeColor: Dawn Sky 500 (oklch 60% 0.195 218 → hex aproximado).
 * Reemplaza el purple genérico previo (anti-pattern §2 de la spec v1.1).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#1e88c4",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-AR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
