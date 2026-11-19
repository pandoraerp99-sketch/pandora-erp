/**
 * ¿Es la MISMA factura que una ya cargada? — lógica pura, sin base.
 *
 * Pedido del owner (2026-11-19, a partir del prompt de "Operativa & Control"
 * de la cursada de costos): hoy se puede cargar dos veces la misma factura del
 * mismo proveedor y Pandora no dice nada. En efectivo eso son dos salidas de
 * la caja; a cuenta corriente, una deuda que no existe; y en el IVA compras,
 * un crédito fiscal contado dos veces.
 *
 * ── CUÁNDO DOS COMPROBANTES SON EL MISMO ──────────────────────────────────
 * Mismo número (normalizado), mismo tipo y mismo proveedor. Las tres cosas:
 *   - el NÚMERO solo no alcanza: dos proveedores distintos pueden tener la
 *     factura 0001-00001234;
 *   - el TIPO separa una factura de una nota de débito con el mismo número;
 *   - el PROVEEDOR se reconoce por cualquiera de tres llaves, porque el mismo
 *     proveedor se carga a veces con ficha y a veces escrito a mano: la ficha
 *     (`tercero_id`), el CUIT (sólo dígitos) o el nombre escrito igual
 *     (sin mayúsculas, acentos ni espacios de más).
 *
 * ── EL NÚMERO SE COMPARA NORMALIZADO ──────────────────────────────────────
 * "0001-00001234", "1-1234", "00001 00001234" y "FC A 0001-00001234" son la
 * misma factura: punto de venta 1, número 1234. Se toman los dos últimos
 * grupos de dígitos (punto de venta y número) sin los ceros de adelante. Un
 * solo grupo ("1234") es sólo número.
 */

export interface DatosComprobante {
  tercero_id: string | null;
  payee_doc: string | null;
  payee_name: string | null;
  comprobante_tipo: string | null;
  comprobante_numero: string | null;
}

const sinCeros = (s: string) => s.replace(/^0+(?=\d)/, '');

/** "0001-00001234" → "1-1234"; sin dígitos → null. */
export function normalizarNumero(numero: string | null | undefined): string | null {
  if (numero === null || numero === undefined) return null;
  const grupos = numero.match(/\d+/g);
  if (grupos === null || grupos.length === 0) return null;
  if (grupos.length === 1) return sinCeros(grupos[0]!);
  const pv = grupos[grupos.length - 2]!;
  const nro = grupos[grupos.length - 1]!;
  return `${sinCeros(pv)}-${sinCeros(nro)}`;
}

/** Texto comparable: sin mayúsculas, acentos ni espacios de más. Vacío → null. */
export function normalizarTexto(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t === '' ? null : t;
}

/** CUIT con sólo sus dígitos; menos de 8 dígitos no identifica a nadie → null. */
export function normalizarCuit(doc: string | null | undefined): string | null {
  if (doc === null || doc === undefined) return null;
  const d = doc.replace(/\D/g, '');
  return d.length >= 8 ? d : null;
}

/** El mismo proveedor por alguna de las tres llaves. Sin llaves de los dos lados → no. */
export function mismoProveedor(a: DatosComprobante, b: DatosComprobante): boolean {
  if (a.tercero_id !== null && a.tercero_id === b.tercero_id) return true;
  const ca = normalizarCuit(a.payee_doc);
  if (ca !== null && ca === normalizarCuit(b.payee_doc)) return true;
  const na = normalizarTexto(a.payee_name);
  return na !== null && na === normalizarTexto(b.payee_name);
}

/**
 * El tipo tiene que coincidir. Un tipo vacío de un lado no separa: hay gastos
 * viejos cargados con número y sin tipo, y no por eso son otra factura.
 */
function mismoTipo(a: string | null, b: string | null): boolean {
  const ta = normalizarTexto(a);
  const tb = normalizarTexto(b);
  return ta === null || tb === null || ta === tb;
}

/** ¿`nuevo` es el mismo comprobante que `existente`? */
export function mismoComprobante(nuevo: DatosComprobante, existente: DatosComprobante): boolean {
  const n = normalizarNumero(nuevo.comprobante_numero);
  if (n === null || n !== normalizarNumero(existente.comprobante_numero)) return false;
  if (!mismoTipo(nuevo.comprobante_tipo, existente.comprobante_tipo)) return false;
  return mismoProveedor(nuevo, existente);
}

/**
 * ¿Tiene alguna llave de proveedor? Sin ninguna ("Mercadería" sin nombre) no se
 * puede decir que dos gastos sean del mismo proveedor, y el aviso de posible
 * duplicado no corre.
 */
export function tieneProveedor(d: DatosComprobante): boolean {
  return (
    d.tercero_id !== null ||
    normalizarCuit(d.payee_doc) !== null ||
    normalizarTexto(d.payee_name) !== null
  );
}
