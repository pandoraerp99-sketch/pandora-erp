import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Instrument Serif — DISPLAY ONLY. Reservado para 2 lugares:
 * 1. <CartTotal> el monto total grande (hero number)
 * 2. <CaeNumber> al recibir CAE (momento de éxito)
 *
 * NO usar como body. NO usar como label. Solo donde un número debe
 * tener carácter editorial.
 *
 * Pairing: Geist Sans (UI) + Geist Mono (data) + Instrument Serif (display).
 * Ver docs/POS-DESIGN-V1.1-DIRECTION.md §4.
 */
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
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
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
