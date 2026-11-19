'use client';

/**
 * Cargar un gasto — el alta fija en la pantalla, como la pestaña Gastos de la
 * maqueta `pos-preview/facturas-v4.html`.
 *
 * ── POR QUÉ DEJÓ DE SER UN MODAL ──────────────────────────────────────────
 * El owner lo pidió (2026-11-18): la maqueta "es mucho más intuitiva de
 * entender". Lo que la hace intuitiva es que el gasto se ve CONECTADO antes de
 * registrarlo: la categoría como botones de color, y abajo cuánto queda en la
 * caja o cuánto se le va a deber al proveedor. Las conexiones ya existían por
 * dentro (caja, stock, cuenta corriente, comprobantes); acá se hacen visibles.
 *
 * ── LAS REGLAS SON LAS MISMAS DEL MODAL ───────────────────────────────────
 * Neto + IVA cierra contra el total, IVA compras pide número, efectivo pide
 * caja abierta, cuenta corriente pide proveedor de la lista, el detalle de
 * mercadería cierra contra el neto o el total, fijo/variable se elige. El
 * modal se BORRÓ en vez de quedar al lado: dos copias de estas reglas
 * divergen, y la que quede vieja devuelve errores del servidor que el
 * comerciante no entiende.
 *
 * ── LO QUE CAMBIA POR ESTAR FIJO ──────────────────────────────────────────
 * Un modal se cierra al guardar; un formulario fijo queda ahí y se aprieta dos
 * veces. Por eso viaja una clave de idempotencia (`registerExpenseOnce`) y hay
 * un candado local mientras se manda: en efectivo, un doble click eran dos
 * salidas de la caja.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import {
  COMPORTAMIENTO_POR_CATEGORIA,
  type Comportamiento,
} from '@/lib/domain/comportamiento-costo';
import { normalizarMontoTipeado } from '@/lib/money/monto-tipeado';
import type { MemoriaProveedor } from '@/lib/services/expenses/cost-behaviour.service';
import { MEDIOS, catLabel, hoyLocal, plata } from './gastosFormato';
import { adjuntarComprobanteAction, registrarGastoAction, type GastoFormInput } from './actions';
import { CategoriaYTipo, DetalleMercaderia, ImpactoGasto, type BorradorLinea } from './PiezasCarga';

export interface ProveedorOpcion {
  id: string;
  name: string;
  doc: string | null;
}

interface Props {
  proveedores: ProveedorOpcion[];
  /** Efectivo esperado en la caja abierta, o `null` si no hay caja abierta. */
  cajaEsperado: string | null;
  /** Lo que se le debe HOY a cada proveedor con saldo, por id de ficha. */
  deudaHoy: Record<string, string>;
  /** Categoría y tipo de la última vez, por proveedor (`memoriaPorProveedor`). */
  memoria: Record<string, MemoriaProveedor>;
  onVerLibro: () => void;
}

/**
 * Los mismos tipos y tope que el servidor (`db/schema/attachments.ts`). Se
 * repiten acá en vez de importarse porque ese archivo es un schema de Drizzle
 * y no tiene nada que hacer en el bundle del navegador. Si cambian allá,
 * cambian acá: el servidor igual valida, esto sólo evita esperar el rechazo.
 */
const TIPOS_ADJUNTO = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * El margen de $0,50 es `TOLERANCE_RECONCILIATION` de `lib/money/decimal.ts`.
 * Se repite porque ese módulo arrastra `env` al bundle del navegador y tira la
 * página (ya pasó con `formatARS`). Son dos lugares; esta nota es el hilo.
 */
const TOLERANCIA = new Decimal('0.50');

interface Hecho {
  total: string;
  categoria: string;
  medio: string;
  /** 'ok', el error de la subida, o null si no se eligió archivo. */
  adjunto: string | null;
}

/**
 * Texto tipeado → Decimal, con la misma lectura que la caja y los pedidos
 * (`normalizarMontoTipeado`, T-MONEY-08): "38.500" son treinta y ocho mil
 * quinientos y "12.500,50" lleva centavos. El modal viejo hacía
 * `replace(',', '.')` y "38.500" entraba como $38,50. El recuadro de impacto
 * muestra el número ya interpretado, que es lo que esa regla pide de quien la
 * usa.
 */
function dec(v: string): Decimal | null {
  const n = normalizarMontoTipeado(v);
  return n === null ? null : new Decimal(n);
}

const ICONO_CLIP = (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);
const ICONO_OK = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const FLECHA = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

export function CargarGasto({ proveedores, cajaEsperado, deudaHoy, memoria, onVerLibro }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const hayCaja = cajaEsperado !== null;

  const [fecha, setFecha] = useState(hoyLocal);
  const [categoria, setCategoria] = useState('servicios');
  const [comportamiento, setComportamiento] = useState<Comportamiento | null>(
    COMPORTAMIENTO_POR_CATEGORIA.servicios
  );
  /** De dónde salió el tipo: se le dice al comerciante para que sepa por qué. */
  const [origen, setOrigen] = useState<'categoria' | 'proveedor' | 'manual'>('categoria');
  const [descripcion, setDescripcion] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [total, setTotal] = useState('');
  // Arranca en el medio que NO depende de que haya caja: si no hay ninguna
  // abierta, elegir efectivo dejaría el formulario trabado desde el vamos.
  const [medio, setMedio] = useState(hayCaja ? 'efectivo' : 'transferencia');

  const [verFactura, setVerFactura] = useState(false);
  const [compTipo, setCompTipo] = useState('Factura');
  const [compNumero, setCompNumero] = useState('');
  const [enIvaCompras, setEnIvaCompras] = useState(false);
  const [discrimina, setDiscrimina] = useState(false);
  const [neto, setNeto] = useState('');
  const [iva, setIva] = useState('');

  const [lineas, setLineas] = useState<BorradorLinea[]>([]);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<Hecho | null>(null);

  // ── Clave de idempotencia ──
  // Se reusa mientras el contenido no cambie (un doble click manda la misma)
  // y `generacion` sube después de cada gasto registrado: dos gastos iguales a
  // propósito (dos cafés de $500 el mismo día) son dos gastos, no un reintento.
  const [generacion, setGeneracion] = useState(0);
  const claveRef = useRef<{ firma: string; clave: string } | null>(null);
  const enviando = useRef(false);
  const claveDe = (contenido: unknown) => {
    const firma = JSON.stringify([generacion, contenido]);
    if (claveRef.current === null || claveRef.current.firma !== firma) {
      claveRef.current = { firma, clave: crypto.randomUUID() };
    }
    return claveRef.current.clave;
  };

  // ── Validación (las reglas del modal, sin cambios) ──
  const dTotal = dec(total);
  const dNeto = dec(neto);
  const dIva = dec(iva);
  const totalInvalido = dTotal === null || dTotal.lte(0);
  const noCierra =
    discrimina &&
    dTotal !== null &&
    dNeto !== null &&
    dIva !== null &&
    !dNeto.plus(dIva).eq(dTotal);
  const faltaDiscriminar = discrimina && (dNeto === null || dIva === null);
  const faltaComprobante = enIvaCompras && compNumero.trim() === '';
  const efectivoBloqueado = medio === 'efectivo' && !hayCaja;
  // Un gasto a cuenta corriente NO es plata que salió: es una deuda, y exige
  // proveedor de la lista (ADR-0028 §3).
  const esCtaCte = medio === 'cuenta_corriente';
  const faltaProveedor = esCtaCte && proveedorId === '';
  const esMercaderia = categoria === 'mercaderia';
  const faltaComportamiento = !esMercaderia && comportamiento === null;

  const subtotalDe = (l: BorradorLinea): Decimal | null => {
    const q = dec(l.qty);
    const c = dec(l.costo);
    if (q === null || c === null || q.lte(0) || c.lt(0)) return null;
    return q.times(c);
  };
  const lineasIncompletas = esMercaderia && lineas.some((l) => subtotalDe(l) === null);
  const sumaDetalle = lineas.reduce((acc, l) => acc.plus(subtotalDe(l) ?? 0), new Decimal(0));
  // Contra el NETO si el comprobante discrimina IVA, contra el TOTAL si no: el
  // IVA discriminado se recupera y no es costo de la mercadería.
  const baseDetalle = discrimina ? dNeto : dTotal;
  const detalleNoCierra =
    esMercaderia &&
    lineas.length > 0 &&
    !lineasIncompletas &&
    baseDetalle !== null &&
    sumaDetalle.minus(baseDetalle).abs().gt(TOLERANCIA);

  const puedeGuardar =
    !totalInvalido &&
    !noCierra &&
    !faltaDiscriminar &&
    !faltaComprobante &&
    !efectivoBloqueado &&
    !faltaProveedor &&
    !lineasIncompletas &&
    !detalleNoCierra &&
    !faltaComportamiento &&
    !pending;

  // Lo que falta, en palabras: un botón apagado sin explicación es un misterio.
  const motivoApagado = totalInvalido
    ? 'Falta el monto.'
    : efectivoBloqueado
      ? 'No hay una caja abierta para pagar en efectivo.'
      : faltaProveedor
        ? 'Elegí a qué proveedor se le debe.'
        : faltaComportamiento
          ? 'Elegí si es fijo, variable o mixto.'
          : faltaComprobante
            ? 'Falta el número de la factura.'
            : faltaDiscriminar || noCierra
              ? 'Revisá el neto y el IVA de la factura.'
              : lineasIncompletas || detalleNoCierra
                ? 'Revisá el detalle de la mercadería.'
                : null;

  const tipoDeCategoria = (c: string): Comportamiento | null =>
    COMPORTAMIENTO_POR_CATEGORIA[c as keyof typeof COMPORTAMIENTO_POR_CATEGORIA] ?? null;

  const elegirCategoria = (c: string) => {
    setCategoria(c);
    setComportamiento(tipoDeCategoria(c));
    setOrigen('categoria');
  };

  /**
   * Elegir un proveedor que ya se usó completa la categoría y el tipo con los
   * de la última vez (`memoriaPorProveedor`). Si no hay memoria, no toca nada:
   * lo que el comerciante ya eligió arriba vale más que un default.
   */
  const elegirProveedor = (id: string) => {
    setProveedorId(id);
    const m = id !== '' ? memoria[id] : undefined;
    if (m === undefined) return;
    setCategoria(m.categoria);
    setComportamiento(m.comportamiento ?? tipoDeCategoria(m.categoria));
    setOrigen('proveedor');
  };

  /** Completa el IVA al 21% desde el total, que es el caso común. */
  const calcular21 = () => {
    if (dTotal === null || dTotal.lte(0)) return;
    const base = dTotal.div('1.21');
    setNeto(base.toFixed(2));
    // El IVA sale por RESTA: los dos redondeos siempre suman el total exacto.
    setIva(dTotal.minus(base.toFixed(2)).toFixed(2));
  };

  const elegirArchivo = (f: File | null) => {
    setArchivoError(null);
    if (archivoRef.current) archivoRef.current.value = '';
    if (f === null) {
      setArchivo(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setArchivoError('El archivo pesa más de 15 MB. Probá con una foto más chica o un PDF.');
      return;
    }
    if (f.type !== '' && !TIPOS_ADJUNTO.split(',').includes(f.type)) {
      setArchivoError('Sólo fotos (JPG, PNG, WEBP, HEIC) o PDF.');
      return;
    }
    setArchivo(f);
  };

  const armarForm = (d: Decimal): GastoFormInput => ({
    fecha,
    categoria: categoria as GastoFormInput['categoria'],
    total: d.toFixed(2),
    ...(discrimina && dNeto !== null && dIva !== null
      ? { neto: dNeto.toFixed(2), iva: dIva.toFixed(2) }
      : {}),
    medio_pago: medio as GastoFormInput['medio_pago'],
    ...(proveedorId !== '' ? { tercero_id: proveedorId } : {}),
    ...(proveedorId === '' && payeeName.trim() !== '' ? { payee_name: payeeName.trim() } : {}),
    ...(compNumero.trim() !== ''
      ? { comprobante_tipo: compTipo, comprobante_numero: compNumero.trim() }
      : {}),
    en_iva_compras: enIvaCompras,
    ...(!esMercaderia && comportamiento !== null ? { comportamiento } : {}),
    ...(descripcion.trim() !== '' ? { descripcion: descripcion.trim() } : {}),
    // Sólo viajan si hay: un `items: []` en una categoría que no es mercadería
    // haría rechazar el gasto entero.
    ...(esMercaderia && lineas.length > 0
      ? {
          items: lineas.map((l) => ({
            product_id: l.productId,
            qty: (dec(l.qty) ?? new Decimal(0)).toFixed(4),
            unit_cost: (dec(l.costo) ?? new Decimal(0)).toFixed(4),
          })),
        }
      : {}),
  });

  /** Vacía lo que es de ESTE gasto. Fecha, categoría y medio quedan: se cargan de a varios. */
  const limpiar = () => {
    setDescripcion('');
    setProveedorId('');
    // El tipo vuelve al de la categoría: el que vino del proveedor anterior
    // ya no tiene de dónde salir.
    setComportamiento(tipoDeCategoria(categoria));
    setOrigen('categoria');
    setPayeeName('');
    setTotal('');
    setVerFactura(false);
    setCompTipo('Factura');
    setCompNumero('');
    setEnIvaCompras(false);
    setDiscrimina(false);
    setNeto('');
    setIva('');
    setLineas([]);
    setArchivo(null);
    setArchivoError(null);
    if (archivoRef.current) archivoRef.current.value = '';
  };

  const enviar = () => {
    if (!puedeGuardar || dTotal === null || enviando.current) return;
    const form = armarForm(dTotal);
    const clave = claveDe(form);
    const elegido = archivo;
    enviando.current = true;
    setError(null);
    setHecho(null);
    startTransition(async () => {
      try {
        const res = await registrarGastoAction(form, clave);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // El comprobante va DESPUÉS: necesita el id del gasto. Si falla, el
        // gasto ya quedó y se dice así, sin un error que haga creer que hay
        // que cargarlo de nuevo (sería cargarlo dos veces).
        let adjunto: string | null = null;
        if (elegido !== null) {
          try {
            const fd = new FormData();
            fd.set('expense_id', res.data.id);
            fd.set('archivo', elegido);
            const r2 = await adjuntarComprobanteAction(fd);
            adjunto = r2.ok ? 'ok' : r2.error;
          } catch {
            adjunto = 'no se pudo subir el archivo';
          }
        }
        setHecho({
          total: form.total,
          categoria: catLabel(form.categoria),
          medio: form.medio_pago,
          adjunto,
        });
        limpiar();
        setGeneracion((g) => g + 1);
        router.refresh();
      } finally {
        enviando.current = false;
      }
    });
  };

  // ── Impacto: la conexión que la maqueta muestra antes de registrar ──
  const monto = dTotal !== null && dTotal.gt(0) ? dTotal : new Decimal(0);
  const proveedorElegido = proveedores.find((p) => p.id === proveedorId) ?? null;
  const debeHoy = new Decimal(proveedorId !== '' ? (deudaHoy[proveedorId] ?? '0') : '0');

  // Resumen de la factura, siempre a la vista aunque los campos estén
  // plegados: es la distinción que sostiene la pantalla (ARCA o export).
  const resumenFactura = enIvaCompras
    ? {
        clase: 'arca',
        texto: `${compTipo} ${compNumero.trim() || '(falta el número)'} · entra al IVA compras: el estudio la baja de ARCA`,
      }
    : compNumero.trim() !== ''
      ? {
          clase: 'manda',
          texto: `${compTipo} ${compNumero.trim()} · no entra al IVA compras: va en el export para el estudio`,
        }
      : {
          clase: 'manda',
          texto: 'Sin factura cargada · va en el export para el estudio',
        };

  return (
    <section className="card glass cg" aria-labelledby="cgTitulo">
      <h2 className="sec-h" id="cgTitulo">
        <span className="n" aria-hidden="true">
          1
        </span>
        Cargar gasto
      </h2>

      <CategoriaYTipo
        categoria={categoria}
        comportamiento={comportamiento}
        origen={origen}
        proveedorNombre={proveedorElegido?.name ?? null}
        onCategoria={elegirCategoria}
        onTipo={(c) => {
          setComportamiento(c);
          setOrigen('manual');
        }}
      />

      <div className="fgrid2 cg-gap">
        <div className="field">
          <label htmlFor="cgDesc">Concepto</label>
          <input
            id="cgDesc"
            className="finput"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Luz de agosto, alquiler de septiembre…"
          />
        </div>
        {/* Con cuenta corriente el proveedor es OBLIGATORIO y de la lista: una
            deuda sin acreedor identificado no se puede pagar ni informar. */}
        <div className="field">
          <label htmlFor="cgProv">
            {esCtaCte ? 'A quién se le debe' : 'Beneficiario / Proveedor'}
          </label>
          <select
            id="cgProv"
            className="fselect"
            value={proveedorId}
            onChange={(e) => elegirProveedor(e.target.value)}
          >
            <option value="">
              {esCtaCte ? 'Elegí el proveedor…' : 'Otro (escribir el nombre)'}
            </option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.doc !== null ? ` · ${p.doc}` : ''}
              </option>
            ))}
          </select>
          {proveedorId === '' && !esCtaCte ? (
            <input
              className="finput"
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
              placeholder="Nombre (opcional)"
              aria-label="Nombre del beneficiario o proveedor"
            />
          ) : null}
        </div>
      </div>

      <div className="fgrid3 cg-gap-s">
        <div className="field">
          <label htmlFor="cgTotal">{esCtaCte ? 'Monto que queda debiendo' : 'Monto'}</label>
          <input
            id="cgTotal"
            className="finput mono"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            aria-invalid={total !== '' && totalInvalido}
            aria-describedby={total !== '' && totalInvalido ? 'cgTotalErr' : undefined}
          />
          {total !== '' && totalInvalido ? (
            <span className="ferr" id="cgTotalErr">
              Escribí el monto con números, por ejemplo 12500,50.
            </span>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="cgMedio">Medio de pago</label>
          <select
            id="cgMedio"
            className="fselect"
            value={medio}
            onChange={(e) => setMedio(e.target.value)}
          >
            {MEDIOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cgFecha">Fecha del gasto</label>
          <input
            id="cgFecha"
            className="finput mono"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
      </div>

      {/* ── La factura: plegada, pero con su consecuencia siempre a la vista ── */}
      <div className={`cgfac${verFactura ? ' open' : ''}`}>
        <button
          type="button"
          className="cgfac-head"
          aria-expanded={verFactura}
          aria-controls="cgFacBody"
          onClick={() => setVerFactura((v) => !v)}
        >
          <span className={`cgfac-dot ${resumenFactura.clase}`} aria-hidden="true" />
          <span className="cgfac-tx">
            <span className="cgfac-t">Factura o comprobante</span>
            <span className="cgfac-s">{resumenFactura.texto}</span>
          </span>
          <span className="cgfac-cta">{verFactura ? 'Ocultar' : 'Cargar datos'}</span>
        </button>
        {verFactura ? (
          <div className="cgfac-body" id="cgFacBody">
            <div className="fgrid2">
              <div className="field">
                <label htmlFor="cgCompTipo">Tipo</label>
                <select
                  id="cgCompTipo"
                  className="fselect"
                  value={compTipo}
                  onChange={(e) => setCompTipo(e.target.value)}
                >
                  <option>Factura</option>
                  <option>Ticket</option>
                  <option>Recibo</option>
                  <option>Nota de débito</option>
                  <option>Otro</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="cgCompNro">Número</label>
                <input
                  id="cgCompNro"
                  className="finput mono"
                  value={compNumero}
                  onChange={(e) => setCompNumero(e.target.value)}
                  placeholder="0001-00001234"
                />
              </div>
            </div>

            <label className="pm-check cg-check" htmlFor="cgArca">
              <input
                id="cgArca"
                type="checkbox"
                checked={enIvaCompras}
                onChange={(e) => setEnIvaCompras(e.target.checked)}
              />
              <span>
                <span className="t">Entra al IVA compras</span>
                <span className="s">
                  Marcalo si es una factura a nombre del comercio. El estudio ya la baja de ARCA y
                  no hace falta mandársela. Sin marcar, sale en el export para el estudio.
                </span>
              </span>
            </label>
            {faltaComprobante ? (
              <p className="pm-warn red">
                Un gasto que entra al IVA compras necesita el <b>número de comprobante</b>: es lo
                que permite cruzarlo con lo que el estudio ve en ARCA.
              </p>
            ) : null}

            <label className="pm-check" htmlFor="cgDisc">
              <input
                id="cgDisc"
                type="checkbox"
                checked={discrimina}
                onChange={(e) => {
                  setDiscrimina(e.target.checked);
                  if (!e.target.checked) {
                    setNeto('');
                    setIva('');
                  }
                }}
              />
              <span>
                <span className="t">La factura discrimina el IVA</span>
                <span className="s">
                  Sólo si lo muestra aparte. Neto + IVA tiene que dar exactamente el monto.
                </span>
              </span>
            </label>
            {discrimina ? (
              <>
                <div className="fgrid2">
                  <div className="field">
                    <label htmlFor="cgNeto">Neto</label>
                    <input
                      id="cgNeto"
                      className="finput mono"
                      value={neto}
                      onChange={(e) => setNeto(e.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="cgIva">IVA</label>
                    <input
                      id="cgIva"
                      className="finput mono"
                      value={iva}
                      onChange={(e) => setIva(e.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                    />
                  </div>
                </div>
                <p className="cg-nota">
                  <button
                    type="button"
                    className="cg-link"
                    onClick={calcular21}
                    disabled={totalInvalido}
                  >
                    Calcular al 21%
                  </button>{' '}
                  desde el monto. Verificá contra el papel: hay gastos al 10,5% y otros exentos.
                </p>
              </>
            ) : null}
            {noCierra && dNeto !== null && dIva !== null && dTotal !== null ? (
              <p className="pm-warn red">
                Neto + IVA da <b>{plata(dNeto.plus(dIva).toFixed(2))}</b> y el monto es{' '}
                <b>{plata(dTotal.toFixed(2))}</b>. Tienen que coincidir.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── El detalle: sólo mercadería. Una línea es un LOTE: entra al stock
          y deja registrado a qué costo. ── */}
      {esMercaderia ? (
        <DetalleMercaderia
          lineas={lineas}
          setLineas={setLineas}
          discrimina={discrimina}
          sumaDetalle={sumaDetalle}
          baseDetalle={baseDetalle}
          detalleNoCierra={detalleNoCierra}
          lineasIncompletas={lineasIncompletas}
          subtotalDe={subtotalDe}
        />
      ) : null}

      {/* ── El comprobante adjunto: se sube apenas se registra el gasto ── */}
      <div
        className={`gdrop${archivo !== null ? ' has' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          elegirArchivo(e.dataTransfer.files[0] ?? null);
        }}
      >
        <div className="gdrop-ic">{ICONO_CLIP}</div>
        <div className="gdrop-tx">
          <div className="gdrop-t">
            {archivo !== null ? archivo.name : 'Adjuntar comprobante (opcional)'}
          </div>
          <div className="gdrop-s">
            {archivo !== null
              ? `${(archivo.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB · se sube al registrar el gasto`
              : 'Foto o PDF de la factura o el ticket, como respaldo. Podés arrastrarlo acá.'}
          </div>
        </div>
        {archivo !== null ? (
          <button type="button" className="scan-btn" onClick={() => elegirArchivo(null)}>
            Quitar
          </button>
        ) : (
          <button type="button" className="scan-btn" onClick={() => archivoRef.current?.click()}>
            Adjuntar
          </button>
        )}
        <input
          ref={archivoRef}
          type="file"
          accept={TIPOS_ADJUNTO}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
        />
      </div>
      {archivoError !== null ? (
        <p className="ferr" role="alert">
          {archivoError}
        </p>
      ) : null}

      <ImpactoGasto
        medio={medio}
        cajaEsperado={cajaEsperado}
        monto={monto}
        proveedorNombre={proveedorElegido?.name ?? null}
        debeHoy={debeHoy}
      />

      <div aria-live="polite">
        {hecho !== null ? (
          <div className="cg-ok">
            <span className="cg-ok-ic">{ICONO_OK}</span>
            <div className="cg-ok-tx">
              <b>
                Listo: gasto de {plata(hecho.total)} en {hecho.categoria}.
              </b>{' '}
              {hecho.medio === 'efectivo'
                ? 'Se descontó de la caja.'
                : hecho.medio === 'cuenta_corriente'
                  ? 'Quedó como deuda con el proveedor.'
                  : ''}
              {hecho.adjunto === 'ok' ? ' El comprobante quedó adjunto.' : null}
              {hecho.adjunto !== null && hecho.adjunto !== 'ok' ? (
                <span className="cg-ok-warn">
                  {' '}
                  El gasto quedó guardado, pero el comprobante no subió ({hecho.adjunto}). Adjuntalo
                  desde el clip de su fila en el libro.
                </span>
              ) : null}
            </div>
            <button type="button" className="cg-link" onClick={onVerLibro}>
              Ver en el libro
            </button>
          </div>
        ) : null}
      </div>
      {error !== null ? (
        <p className="pm-warn red cg-err" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="reg-btn"
        disabled={!puedeGuardar}
        aria-describedby={motivoApagado !== null ? 'cgMotivo' : undefined}
        onClick={enviar}
      >
        {FLECHA}
        {pending ? 'Registrando…' : esCtaCte ? 'Registrar la deuda' : 'Registrar gasto'}
      </button>
      {motivoApagado !== null && !pending ? (
        <p className="cg-motivo" id="cgMotivo">
          {motivoApagado}
        </p>
      ) : null}
    </section>
  );
}
