import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    <html
      lang="es-AR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
