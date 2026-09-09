/**
 * Un solo lugar donde se arma el CSV que abre la contadora.
 *
 * ── POR QUÉ ESTÁ ACÁ Y NO EN CADA EXPORT ──────────────────────────────────
 * El formato tiene cuatro detalles que no se ven y que rompen el archivo si
 * uno solo se pierde: separador `;` (en es-AR Excel usa punto y coma; con coma
 * abre todo en UNA columna), decimales con coma, fin de línea CRLF, y BOM al
 * principio (sin él Excel abre en ANSI y rompe los acentos y la ñ).
 *
 * Cuando el export de gastos se sumó al de ventas, la primera versión repetía
 * la receta. Copiada, cualquiera de las dos puede derivar en un detalle y el
 * test propio de cada una pasa igual: mide lo que ESE archivo hace, no lo que
 * hace el otro. Con un solo helper, derivar es imposible.
 */
import Decimal from 'decimal.js';

/** Número para Excel es-AR: dos decimales, coma decimal. */
export function csvNum(v: string): string {
  return new Decimal(v || '0').toFixed(2).replace('.', ',');
}

/** Texto: entrecomilla si trae `;`, comillas o salto de línea. */
export function csvTxt(v: string): string {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Cabecera + filas ya formateadas, con BOM y CRLF. */
export function csvArmar(cabecera: string[], filas: string[][]): string {
  const lineas = filas.map((f) => f.join(';'));
  return '﻿' + [cabecera.join(';'), ...lineas].join('\r\n') + '\r\n';
}
