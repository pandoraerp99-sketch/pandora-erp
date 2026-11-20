'use client';

/**
 * La compra de mercadería al estilo "Recibidas" del mockup (`facturas-v4.html`):
 * los artículos de la factura, lo que cada uno le hace al stock, al costo y al
 * margen, y si lo cargado coincide con la factura.
 *
 * ── POR QUÉ ACÁ SE VEN LOS COSTOS ─────────────────────────────────────────
 * Pedido del owner (2026-11-19): que Facturas "vaya de la mano de los gastos
 * y costos". El momento de revisar un precio de venta es cuando entra un costo
 * nuevo; hasta ahora se cargaba el renglón y el margen cambiaba en silencio.
 * Cada renglón dice, antes de registrar: stock antes → después, costo actual
 * → nuevo (y cuánto subió) y margen actual → nuevo, con las mismas reglas que
 * va a aplicar el servidor (`domain/impacto-compra.ts`).
 *
 * ── "COINCIDE" ES LA MISMA CUENTA QUE HABILITA EL BOTÓN ───────────────────
 * La tarjeta no calcula nada propio: recibe del formulario la suma, la base
 * (el neto si la factura discrimina IVA, el total si no) y si cierra con la
 * tolerancia de $0,50. Si la tarjeta y el botón hicieran cuentas separadas,
 * la pantalla podría decir "Coincide" con el botón apagado.
 */
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import Decimal from 'decimal.js';
import { fletePorUnidad, impactoDeCompra, type ImpactoProducto } from '@/lib/domain/impacto-compra';
import { normalizarMontoTipeado } from '@/lib/money/monto-tipeado';
import { plata } from './gastosFormato';
import { buscarProductosAction, type FleteFormInput, type ProductoBuscadoDTO } from './actions';

/**
 * Un renglón mientras se está cargando. Guarda `productId` porque una línea
 * ES un lote: sin producto no puede mover stock ni valorizar nada. Trae del
 * catálogo lo que hace falta para anticipar el impacto.
 */
export interface BorradorLinea {
  key: string;
  productId: string;
  nombre: string;
  qty: string;
  costo: string;
  /** Precio de venta sin IVA, stock y costo actuales, y última compra. */
  precio: string;
  stock: string;
  costoActual: string | null;
  ultimaCompra: string | null;
}

/** El flete que vino con la compra (0046), mientras se carga. */
export interface BorradorFlete {
  activo: boolean;
  terceroId: string;
  numero: string;
  total: string;
  /** IVA discriminado en la factura del flete; vacío si no tiene. */
  iva: string;
  medio: FleteFormInput['medio_pago'];
  enIvaCompras: boolean;
}

/**
 * Flete vacío, con el expreso ya elegido si hay un proveedor que lo parezca:
 * el comercio trabaja con uno solo, y elegirlo cada vez es un paso de más.
 */
export function fleteInicial(proveedores: Array<{ id: string; name: string }>): BorradorFlete {
  const expreso = proveedores.find((p) => /expreso|transporte|flete|log[ií]stica/i.test(p.name));
  return {
    activo: false,
    terceroId: expreso?.id ?? '',
    numero: '',
    total: '',
    iva: '',
    medio: 'cuenta_corriente',
    enIvaCompras: true,
  };
}

/**
 * ¿El flete está completo? Devuelve lo que falta (en palabras, para el botón
 * apagado), el NETO que se reparte y lo que viaja al servidor.
 */
export function revisarFlete(
  f: BorradorFlete,
  hayArticulos: boolean
): { falta: string | null; neto: Decimal | null; payload: FleteFormInput | null } {
  if (!f.activo) return { falta: null, neto: null, payload: null };
  const total = dec(f.total);
  const iva = f.iva.trim() === '' ? new Decimal(0) : dec(f.iva);
  const neto = total !== null && iva !== null && iva.lt(total) ? total.minus(iva) : null;
  const falta = !hayArticulos
    ? 'Cargá los artículos: el flete se reparte entre ellos.'
    : f.terceroId === ''
      ? 'Elegí el proveedor del flete.'
      : total === null || total.lte(0)
        ? 'Falta el monto del flete.'
        : neto === null
          ? 'Revisá el IVA del flete.'
          : f.enIvaCompras && f.numero.trim() === ''
            ? 'Falta el número de la factura del flete.'
            : null;
  return {
    falta,
    neto,
    payload:
      falta === null && total !== null && iva !== null
        ? {
            tercero_id: f.terceroId,
            comprobante_numero: f.numero.trim(),
            total: total.toFixed(2),
            ...(iva.gt(0) ? { iva: iva.toFixed(2) } : {}),
            medio_pago: f.medio,
            en_iva_compras: f.enIvaCompras,
          }
        : null,
  };
}

const dec = (v: string): Decimal | null => {
  const n = normalizarMontoTipeado(v);
  return n === null ? null : new Decimal(n);
};
/** "58" o "12,5": cantidades, sin ceros de más. */
const cant = (d: Decimal) => d.toDecimalPlaces(3).toString().replace('.', ',');
/** "37,0%" */
const pct = (d: Decimal) => `${d.toFixed(1).replace('.', ',')}%`;
/** 'AAAA-MM-DD' → '01/10/2026' */
const fecha = (iso: string) => iso.split('-').reverse().join('/');

export function CompraMercaderia({
  proveedores,
  flete,
  setFlete,
  lineas,
  setLineas,
  fechaCompra,
  discrimina,
  sumaDetalle,
  baseDetalle,
  detalleNoCierra,
  lineasIncompletas,
  subtotalDe,
}: {
  proveedores: Array<{ id: string; name: string }>;
  flete: BorradorFlete;
  setFlete: Dispatch<SetStateAction<BorradorFlete>>;
  lineas: BorradorLinea[];
  setLineas: Dispatch<SetStateAction<BorradorLinea[]>>;
  fechaCompra: string;
  discrimina: boolean;
  sumaDetalle: Decimal;
  baseDetalle: Decimal | null;
  detalleNoCierra: boolean;
  lineasIncompletas: boolean;
  subtotalDe: (l: BorradorLinea) => Decimal | null;
}) {
  // La parte del flete de cada renglón: la misma cuenta que hace el servidor.
  const fleteNeto = revisarFlete(flete, true).neto;
  const impacto = useMemo(() => {
    const valores = lineas.map((l) => ({ qty: dec(l.qty), costo: dec(l.costo) }));
    const partes = fletePorUnidad(valores, fleteNeto);
    return impactoDeCompra(
      lineas.map((l, i) => ({
        productId: l.productId,
        qty: valores[i]!.qty,
        costo: valores[i]!.costo,
        flete: partes[i] ?? null,
        precio: l.precio,
        stock: l.stock,
        costoActual: l.costoActual,
        ultimaCompra: l.ultimaCompra,
      })),
      fechaCompra
    );
  }, [lineas, fechaCompra, fleteNeto]);

  const cambiar = (i: number, cambio: Partial<BorradorLinea>) =>
    setLineas((prev) => prev.map((x, j) => (j === i ? { ...x, ...cambio } : x)));

  // Resumen de una línea: cuántos productos entran, en cuántos cambia el
  // costo y en cuántos baja el margen.
  const productos = [...impacto.values()];
  const cambianCosto = productos.filter(
    (p) => p.motivo === 'cambia' && p.variacionCosto !== null && !p.variacionCosto.isZero()
  ).length;
  const bajaMargen = productos.filter(
    (p) => p.margenAntes !== null && p.margenDespues !== null && p.margenDespues.lt(p.margenAntes)
  ).length;

  return (
    <div className="cm">
      <div className="cm-h">
        <span className="cm-t">Artículos de la factura</span>
        <span className="cm-s">
          Opcional. Si los cargás, entran al stock y queda el costo de cada producto: antes de
          registrar ves cómo cambian el stock, el costo y el margen.
        </span>
      </div>

      {lineas.length > 0 ? (
        <div className="cm-tab">
          <div className="cm-th">
            <span>Producto</span>
            <span className="r">Cant.</span>
            <span className="r">Costo u. neto</span>
            <span className="r">Subtotal</span>
            <span />
          </div>
          {lineas.map((l, i) => {
            const sub = subtotalDe(l);
            const imp = impacto.get(l.productId);
            const ultimoDelProducto = !lineas.slice(i + 1).some((x) => x.productId === l.productId);
            return (
              <div key={l.key} className="cm-tr">
                <div className="cm-fila">
                  <span className="cm-nom">{l.nombre}</span>
                  <input
                    className="cm-in"
                    inputMode="decimal"
                    value={l.qty}
                    aria-label={`Cantidad de ${l.nombre}`}
                    onChange={(e) => cambiar(i, { qty: e.target.value })}
                  />
                  <input
                    className="cm-in"
                    inputMode="decimal"
                    value={l.costo}
                    aria-label={`Costo unitario neto de ${l.nombre}`}
                    onChange={(e) => cambiar(i, { costo: e.target.value })}
                  />
                  <span className="cm-sub">{sub === null ? '—' : plata(sub.toFixed(4))}</span>
                  <button
                    type="button"
                    className="cm-x"
                    aria-label={`Sacar ${l.nombre}`}
                    onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
                {/* El impacto va en el último renglón del producto: si aparece
                    dos veces, es el que fija el costo. */}
                {imp !== undefined && ultimoDelProducto ? <ImpactoRenglon imp={imp} /> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <BuscadorProducto
        onElegir={(p) =>
          setLineas((prev) => [
            ...prev,
            {
              key: `${p.id}-${prev.length}-${Date.now()}`,
              productId: p.id,
              nombre: p.name,
              qty: '',
              // El costo de la última compra viene cargado: el proveedor casi
              // siempre repite precio, y si aumentó se ve contra qué.
              costo: p.cost !== null ? new Decimal(p.cost).toFixed(2) : '',
              precio: p.price,
              stock: p.stock_current,
              costoActual: p.cost,
              ultimaCompra: p.ultima_compra,
            },
          ])
        }
      />

      <BloqueFlete proveedores={proveedores} flete={flete} setFlete={setFlete} />

      {lineas.length > 0 ? (
        <>
          <Conciliacion
            discrimina={discrimina}
            suma={sumaDetalle}
            base={baseDetalle}
            noCierra={detalleNoCierra}
            incompleto={lineasIncompletas}
          />
          <p className="cm-resumen">
            Entran al stock <b>{productos.length}</b> producto{productos.length === 1 ? '' : 's'}.
            {cambianCosto > 0 ? (
              <>
                {' '}
                En <b>{cambianCosto}</b> cambia el costo.
              </>
            ) : null}
            {bajaMargen > 0 ? (
              <>
                {' '}
                En <b className="cm-ojo">{bajaMargen}</b> baja el margen: revisá el precio de venta.
              </>
            ) : null}
            {discrimina ? ' Los costos van netos: el IVA discriminado se recupera.' : null}
          </p>
        </>
      ) : null}
    </div>
  );
}

/** Stock, costo y margen de un producto, antes → después. Siempre con texto, no sólo color. */
function ImpactoRenglon({ imp }: { imp: ImpactoProducto }) {
  const sube = imp.variacionCosto !== null && imp.variacionCosto.gt(0);
  const baja = imp.variacionCosto !== null && imp.variacionCosto.lt(0);
  const margenBaja =
    imp.margenAntes !== null && imp.margenDespues !== null && imp.margenDespues.lt(imp.margenAntes);
  const margenSube =
    imp.margenAntes !== null && imp.margenDespues !== null && imp.margenDespues.gt(imp.margenAntes);

  let costo: ReactNode;
  if (imp.motivo === 'sin_costo') {
    costo = <span className="cm-chip">Falta el costo</span>;
  } else if (imp.motivo === 'compra_mas_nueva') {
    costo = (
      <span className="cm-chip">
        Costo queda en {imp.costoAntes === null ? '—' : plata(imp.costoAntes.toFixed(2))}: hay una
        compra más nueva
      </span>
    );
  } else if (imp.costoAntes === null) {
    costo = (
      <span className="cm-chip">
        Primer costo: {plata((imp.costoDespues ?? new Decimal(0)).toFixed(2))}
      </span>
    );
  } else {
    costo = (
      <span className={`cm-chip${sube ? ' mal' : baja ? ' bien' : ''}`}>
        Costo {plata(imp.costoAntes.toFixed(2))} →{' '}
        {plata((imp.costoDespues ?? new Decimal(0)).toFixed(2))}
        {imp.variacionCosto !== null && !imp.variacionCosto.isZero()
          ? ` · ${sube ? 'sube' : 'baja'} ${pct(imp.variacionCosto.abs())}`
          : ' · igual'}
      </span>
    );
  }

  let margen: ReactNode = null;
  if (imp.margenDespues === null) {
    margen = <span className="cm-chip">Sin precio de venta: no hay margen</span>;
  } else if (imp.margenDespues.lt(0)) {
    margen = (
      <span className="cm-chip mal">
        Con este costo se vende a pérdida ({pct(imp.margenDespues)}): revisá el precio
      </span>
    );
  } else if (imp.margenAntes === null) {
    margen = <span className="cm-chip">Margen {pct(imp.margenDespues)}</span>;
  } else {
    margen = (
      <span className={`cm-chip${margenBaja ? ' mal' : margenSube ? ' bien' : ''}`}>
        Margen {pct(imp.margenAntes)} → {pct(imp.margenDespues)}
        {margenBaja ? ' · baja' : margenSube ? ' · sube' : ''}
      </span>
    );
  }

  return (
    <div className="cm-imp">
      <span className="cm-chip">
        Stock {cant(imp.stockAntes)} → {cant(imp.stockDespues)}
      </span>
      {costo}
      {imp.fleteUnitario !== null && imp.motivo === 'cambia' ? (
        <span className="cm-chip">incluye flete {plata(imp.fleteUnitario.toFixed(2))} c/u</span>
      ) : null}
      {margen}
      {imp.repetido ? (
        <span className="cm-chip">Está en más de un renglón: vale el costo del último</span>
      ) : null}
    </div>
  );
}

/**
 * "Vino con flete": la factura del expreso, que llega junto con la de la
 * mercadería. Se registra junto con la compra y su costo (sin IVA) se reparte
 * entre los artículos por valor (decisión del owner, 2026-11-19).
 */
function BloqueFlete({
  proveedores,
  flete,
  setFlete,
}: {
  proveedores: Array<{ id: string; name: string }>;
  flete: BorradorFlete;
  setFlete: Dispatch<SetStateAction<BorradorFlete>>;
}) {
  const cambiar = (c: Partial<BorradorFlete>) => setFlete((f) => ({ ...f, ...c }));
  const prov = proveedores.find((p) => p.id === flete.terceroId);
  return (
    <div className={`cm-flete${flete.activo ? ' on' : ''}`}>
      <label className="pm-check cg-check" htmlFor="cmFlete">
        <input
          id="cmFlete"
          type="checkbox"
          checked={flete.activo}
          onChange={(e) => cambiar({ activo: e.target.checked })}
        />
        <span>
          <span className="t">Vino con flete</span>
          <span className="s">
            La factura del expreso se registra junto con esta compra, y su costo sin IVA se suma al
            de los artículos, repartido según su valor.
          </span>
        </span>
      </label>
      {flete.activo ? (
        <>
          <div className="fgrid3">
            <div className="field">
              <label htmlFor="cmFleteProv">Expreso / transporte</label>
              <select
                id="cmFleteProv"
                className="fselect"
                value={flete.terceroId}
                onChange={(e) => cambiar({ terceroId: e.target.value })}
              >
                <option value="">Elegí el proveedor…</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cmFleteNro">Número de su factura</label>
              <input
                id="cmFleteNro"
                className="finput mono"
                value={flete.numero}
                onChange={(e) => cambiar({ numero: e.target.value })}
                placeholder="0101-00229412"
              />
            </div>
            <div className="field">
              <label htmlFor="cmFleteTotal">Monto del flete</label>
              <input
                id="cmFleteTotal"
                className="finput mono"
                inputMode="decimal"
                value={flete.total}
                onChange={(e) => cambiar({ total: e.target.value })}
                placeholder="0,00"
              />
            </div>
          </div>
          <div className="fgrid3 cg-gap-s">
            <div className="field">
              <label htmlFor="cmFleteIva">IVA discriminado (si tiene)</label>
              <input
                id="cmFleteIva"
                className="finput mono"
                inputMode="decimal"
                value={flete.iva}
                onChange={(e) => cambiar({ iva: e.target.value })}
                placeholder="0,00"
              />
            </div>
            <div className="field">
              <label htmlFor="cmFleteMedio">Cómo se paga</label>
              <select
                id="cmFleteMedio"
                className="fselect"
                value={flete.medio}
                onChange={(e) => cambiar({ medio: e.target.value as BorradorFlete['medio'] })}
              >
                <option value="cuenta_corriente">Cuenta corriente</option>
                <option value="transferencia">Transferencia</option>
                <option value="debito">Débito</option>
                <option value="credito">Crédito</option>
              </select>
            </div>
            <label className="pm-check cm-flete-arca" htmlFor="cmFleteArca">
              <input
                id="cmFleteArca"
                type="checkbox"
                checked={flete.enIvaCompras}
                onChange={(e) => cambiar({ enIvaCompras: e.target.checked })}
              />
              <span>
                <span className="t">Entra al IVA compras</span>
              </span>
            </label>
          </div>
          <p className="cm-s cm-flete-pie">
            {flete.medio === 'cuenta_corriente'
              ? `Queda como deuda con ${prov?.name ?? 'el expreso'}, igual que si la cargaras aparte.`
              : 'Se registra como pagado.'}{' '}
            Si después anulás esta compra, el flete queda cargado: la deuda con el expreso sigue.
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * ¿Lo cargado da lo mismo que la factura? Recibe la cuenta ya hecha por el
 * formulario: acá no se decide nada, sólo se muestra.
 */
function Conciliacion({
  discrimina,
  suma,
  base,
  noCierra,
  incompleto,
}: {
  discrimina: boolean;
  suma: Decimal;
  base: Decimal | null;
  noCierra: boolean;
  incompleto: boolean;
}) {
  const estado = incompleto || base === null ? 'falta' : noCierra ? 'mal' : 'ok';
  return (
    <div className={`cm-rec ${estado}`} role="status">
      <div className="cm-rec-fila">
        <span>Suma de los artículos{discrimina ? ' (neto)' : ''}</span>
        <b>{plata(suma.toFixed(2))}</b>
      </div>
      <div className="cm-rec-fila">
        <span>{discrimina ? 'Neto de la factura' : 'Total de la factura (el monto)'}</span>
        <b>{base === null ? '—' : plata(base.toFixed(2))}</b>
      </div>
      <div className="cm-rec-res">
        {estado === 'ok' ? (
          <>
            <span className="cm-rec-k">✓ Coincide</span>
            <b>
              {plata(
                suma
                  .minus(base ?? 0)
                  .abs()
                  .toFixed(2)
              )}
            </b>
          </>
        ) : estado === 'mal' ? (
          <>
            <span className="cm-rec-k">
              {suma.lt(base ?? 0) ? 'A los artículos les faltan' : 'Los artículos suman de más'}
            </span>
            <b>
              {plata(
                suma
                  .minus(base ?? 0)
                  .abs()
                  .toFixed(2)
              )}
            </b>
          </>
        ) : (
          <span className="cm-rec-k">
            {incompleto
              ? 'Completá cantidad y costo de cada renglón para comparar'
              : 'Escribí el monto de la factura para comparar'}
          </span>
        )}
      </div>
      {estado === 'mal' ? (
        <p className="cm-rec-ayuda">
          Revisá cantidades y costos contra el papel. Si la factura tiene percepciones u otros
          impuestos, Pandora todavía no los separa: consultalo con la contadora antes de cargarla.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Buscador de productos del catálogo. Mismo gesto que el POS: se tipea, se
 * elige, se agrega el renglón.
 *
 * No permite crear productos desde acá, y es a propósito: un alta de catálogo
 * (precio, alícuota, rubro, exención Ley 19.640) metida adentro de la carga de
 * una factura son dos decisiones distintas en el mismo formulario.
 */
function BuscadorProducto({ onElegir }: { onElegir: (p: ProductoBuscadoDTO) => void }) {
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState<ProductoBuscadoDTO[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const q = texto.trim();
    let vivo = true;
    // Todo el estado se toca DENTRO del timer, nunca sincrónicamente en el
    // efecto (encadena renders y el lint lo marca). El timer evita una
    // consulta por tecla.
    const t = setTimeout(async () => {
      if (q === '') {
        if (vivo) {
          setBuscando(false);
          setOpciones([]);
        }
        return;
      }
      if (vivo) setBuscando(true);
      const res = await buscarProductosAction(q);
      if (!vivo) return;
      setBuscando(false);
      setOpciones(res.ok ? res.data : []);
    }, 220);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [texto]);

  return (
    <div className="det-busc">
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Agregar un artículo: buscá el producto por nombre, código o SKU…"
        aria-label="Buscar un producto para agregar a la compra"
      />
      {texto.trim() !== '' ? (
        <div className="det-op">
          {buscando && opciones.length === 0 ? (
            <div className="det-vacio">Buscando…</div>
          ) : opciones.length === 0 ? (
            <div className="det-vacio">
              No hay productos que coincidan. Si es nuevo, cargalo primero en Productos.
            </div>
          ) : (
            opciones.map((p) => (
              <button
                key={p.id}
                type="button"
                className="det-opi"
                onClick={() => {
                  onElegir(p);
                  setTexto('');
                  setOpciones([]);
                }}
              >
                <span className="det-opn">{p.name}</span>
                <span className="det-opc">
                  {p.sku !== null ? `${p.sku} · ` : ''}
                  stock {cant(new Decimal(p.stock_current))} ·{' '}
                  {p.cost !== null ? `última compra ${plata(p.cost)}` : 'sin costo cargado'}
                  {p.ultima_compra !== null ? ` (${fecha(p.ultima_compra)})` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
