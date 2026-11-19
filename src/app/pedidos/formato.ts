/**
 * Formato de /pedidos (cliente). Sin Number en la plata: se arma el texto
 * desde el string de Decimal. No importa `money/format` porque arrastra `env`
 * al bundle del navegador (memoria "Margen bruto histórico").
 */
import Decimal from 'decimal.js';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import type { OrderStatus } from '@/lib/db/schema/orders';

/** "$160.000" o "$3.950,62": sin decimales cuando son cero, como la maqueta. */
export function plata(valor: string | Decimal): string {
  const d = (valor instanceof Decimal ? valor : new Decimal(valor || '0')).toDecimalPlaces(
    2,
    Decimal.ROUND_HALF_EVEN
  );
  const negativo = d.isNegative();
  const [entero, dec] = d.abs().toFixed(2).split('.') as [string, string];
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '−' : ''}$${miles}${dec === '00' ? '' : ',' + dec}`;
}

/** Cantidad como se dice en el mostrador: "3,2", "1". */
export function cantidad(valor: string): string {
  const d = new Decimal(valor || '0');
  return d.toDecimalPlaces(3).toString().replace('.', ',');
}

/** 'AAAA-MM-DD' → 'DD/MM'. */
export function ddmm(dia: string | null): string {
  if (!dia) return '—';
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** Día del comercio en que pasó un instante ISO. */
export function diaDe(iso: string): string {
  return diaDelComercio(new Date(iso));
}

/** Hora del comercio de un instante ISO, "14:05". */
export function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Ushuaia',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function restarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split('-').map((x) => parseInt(x, 10)) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d - n));
  return t.toISOString().slice(0, 10);
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
export function nombreDelMes(dia: string): string {
  return MESES[parseInt(dia.slice(5, 7), 10) - 1] ?? '';
}

export function iniciales(nombre: string): string {
  // Sólo lo que empieza con letra o número: "Norma (vecina)" da "NV", no "N(".
  const partes = nombre
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean);
  const a = partes[0]?.[0] ?? '?';
  const b = partes.length > 1 ? (partes[1]?.[0] ?? '') : (partes[0]?.[1] ?? '');
  return (a + b).toUpperCase();
}

/** Color estable por nombre (mismo cliente, mismo color en todas las filas). */
export function colorDe(nombre: string, cuantos: number): number {
  let h = 0;
  for (const ch of nombre) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % cuantos;
}

export const ESTADO_CLASE: Record<OrderStatus, string> = {
  tomado: 'tomado',
  en_preparacion: 'prep',
  listo: 'listo',
  entregado: 'entregado',
  cancelado: 'cancelado',
};

export const ESTADO_TEXTO: Record<OrderStatus, string> = {
  tomado: 'Tomado',
  en_preparacion: 'En preparación',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export const MEDIO_TEXTO: Record<string, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
};

export const COBRO_TEXTO: Record<string, string> = {
  sena: 'Seña',
  parcial: 'A cuenta',
  saldo: 'Saldo',
};
