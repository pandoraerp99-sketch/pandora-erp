/**
 * T-CSV-01 — el formato del CSV que abre la contadora.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE APARTE ────────────────────────────────────
 * El formato tiene cuatro detalles invisibles: separador `;`, coma decimal,
 * CRLF y BOM. Si uno se pierde, Excel abre el archivo en una sola columna o con
 * los acentos rotos — y el contador vuelve a hacer a mano el trabajo que esto
 * viene a sacarle.
 *
 * Ventas y gastos usan el MISMO helper a propósito. Antes cada uno tenía su
 * copia de la receta, y ahí el riesgo es sutil: si una deriva, su propio test
 * pasa igual, porque mide ese archivo y no el otro. Estos tests miden el helper
 * compartido, y después verifican que los dos exports realmente lo usan.
 */
import { describe, expect, it } from 'vitest';
import { csvArmar, csvNum, csvTxt } from '@/lib/services/reporting/csv';
import { armarCsv, type FilaExport } from '@/lib/services/reporting/accountant.report';
import { armarCsvGastos } from '@/lib/services/expenses/expense.service';
import type { Expense } from '@/lib/db/schema/expenses';

const gasto = (over: Partial<Expense> = {}): Expense =>
  ({
    id: crypto.randomUUID(),
    tenant_id: crypto.randomUUID(),
    fecha: '2026-09-07',
    categoria: 'servicios',
    tercero_id: null,
    payee_name: 'Edenor',
    payee_doc: '30-12345678-9',
    neto: '1000.0000',
    iva: '210.0000',
    total: '1210.0000',
    descripcion: 'Luz de agosto',
    comprobante_tipo: 'Factura',
    comprobante_numero: '0001-00001234',
    en_iva_compras: true,
    medio_pago: 'transferencia',
    cash_movement_id: null,
    created_by: null,
    created_at: new Date(),
    ...over,
  }) as Expense;

const venta = (over: Partial<FilaExport> = {}): FilaExport =>
  ({
    fecha: '2026-09-07',
    cliente: 'Consumidor final',
    doc: '',
    condicion: 'consumidor_final',
    neto: '1000.00',
    iva: '210.00',
    exento: '0.00',
    total: '1210.00',
    medio: 'efectivo',
    ...over,
  }) as FilaExport;

describe('T-CSV-01 — formato compartido', () => {
  it('el número lleva coma decimal, no punto', () => {
    // Con punto decimal Excel es-AR lee "1210.00" como TEXTO y el contador no
    // puede sumar la columna.
    expect(csvNum('1210.5')).toBe('1210,50');
    expect(csvNum('0')).toBe('0,00');
  });

  it('un importe vacío es cero, no rompe el archivo', () => {
    expect(csvNum('')).toBe('0,00');
  });

  it('entrecomilla el texto que trae punto y coma', () => {
    // "Pérez; e hijos" partiría la fila en dos columnas.
    expect(csvTxt('Pérez; e hijos')).toBe('"Pérez; e hijos"');
  });

  it('duplica las comillas de un texto entrecomillado', () => {
    expect(csvTxt('El "Rojo"')).toBe('"El ""Rojo"""');
  });

  it('no toca el texto que no lo necesita', () => {
    expect(csvTxt('Edenor')).toBe('Edenor');
  });

  it('arranca con BOM: sin él Excel abre en ANSI y rompe los acentos', () => {
    expect(csvArmar(['A'], []).charCodeAt(0)).toBe(0xfeff);
  });

  it('separa las filas con CRLF, que es lo que espera Excel', () => {
    const csv = csvArmar(['A', 'B'], [['1', '2']]);
    expect(csv).toContain('A;B\r\n1;2\r\n');
  });
});

describe('T-CSV-01 — los dos exports usan la MISMA receta', () => {
  // Éste es el test que importa: si mañana alguien vuelve a escribir la receta
  // a mano en uno de los dos, acá se ve.
  const ventas = armarCsv([venta()]);
  const gastos = armarCsvGastos([gasto()]);

  it('los dos arrancan con BOM', () => {
    expect(ventas.charCodeAt(0)).toBe(0xfeff);
    expect(gastos.charCodeAt(0)).toBe(0xfeff);
  });

  it('los dos terminan las líneas con CRLF', () => {
    expect(ventas.endsWith('\r\n')).toBe(true);
    expect(gastos.endsWith('\r\n')).toBe(true);
  });

  it('los dos escriben los importes igual', () => {
    expect(ventas.split('\r\n')[1]).toContain('1210,00');
    expect(gastos.split('\r\n')[1]).toContain('1210,00');
    expect(gastos).not.toContain('1210.00');
  });
});

describe('T-CSV-01 — CSV de gastos', () => {
  it('lleva el CUIT del proveedor: la contadora lo pide en el detalle', () => {
    // Es la columna más fácil de dejar afuera y la que después obliga a
    // pedirla de nuevo, gasto por gasto.
    const csv = armarCsvGastos([gasto()]);
    expect(csv).toContain('CUIT');
    expect(csv).toContain('30-12345678-9');
  });

  it('junta tipo y número de comprobante en una sola columna', () => {
    const csv = armarCsvGastos([gasto()]);
    expect(csv).toContain('Factura 0001-00001234');
  });

  it('un gasto sin comprobante deja la celda vacía, no dice "null"', () => {
    const csv = armarCsvGastos([
      gasto({ comprobante_tipo: null, comprobante_numero: null, payee_doc: null }),
    ]);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
  });

  it('dice en cada fila si entra al IVA compras', () => {
    // Es la separación que motiva todo el módulo: el estudio ya baja de ARCA
    // los que sí, y necesita saber cuáles son los que no.
    const si = armarCsvGastos([gasto({ en_iva_compras: true })]);
    const no = armarCsvGastos([gasto({ en_iva_compras: false })]);
    expect(si.split('\r\n')[1]).toContain(';Sí;');
    expect(no.split('\r\n')[1]).toContain(';No;');
  });

  it('siempre lleva la fila de encabezados, aunque no haya gastos', () => {
    const csv = armarCsvGastos([]);
    expect(csv).toContain('Fecha;Categoría;Proveedor;CUIT');
    expect(csv.split('\r\n').filter((l) => l !== '').length).toBe(1);
  });

  it('un detalle con punto y coma no parte la fila en dos', () => {
    const csv = armarCsvGastos([gasto({ descripcion: 'Luz; agua y gas' })]);
    expect(csv).toContain('"Luz; agua y gas"');
  });
});
