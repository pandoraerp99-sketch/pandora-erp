'use client';

/**
 * Gastos — carga y listado del período.
 *
 * ── LA SEPARACIÓN QUE ES EL PUNTO DE TODO ─────────────────────────────────
 * Cada gasto está de un lado o del otro de una línea:
 *   - CON comprobante fiscal → entra al IVA compras → el estudio ya lo baja de
 *     ARCA. El comercio no tiene que hacer nada.
 *   - SIN comprobante fiscal → el estudio NO lo ve → hay que mandárselo.
 *
 * Es literalmente lo que la contadora pidió ("clasifico gastos y envío gastos
 * no incluidos en ARCA mensualmente"). Por eso esa distinción no es un detalle
 * del formulario: es una columna de la lista, un KPI propio y lo que define qué
 * filas salen en el export. Si se ven todos mezclados, el trabajo de separarlos
 * vuelve al comercio, que es justo lo que esto viene a sacar.
 *
 * ── NO HAY MAQUETA ────────────────────────────────────────────────────────
 * Esta pantalla no nace de `pos-preview/` sino del pedido real. Se compone con
 * el vocabulario de Clientes (.bar / .kpis / .clrow / .pmod), igual que se hizo
 * con el modal de cobro, en vez de inventar un lenguaje visual nuevo.
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { AppShell } from '@/components/shell/AppShell';
import { GASTOS_CSS } from './gastosCss';
import {
  exportarGastosCsvAction,
  registrarGastoAction,
  type GastoFormInput,
} from './actions';

export interface GastoDTO {
  id: string;
  /** 'AAAA-MM-DD'. La del gasto, no la de la carga. */
  fecha: string;
  categoria: string;
  payee_name: string | null;
  payee_doc: string | null;
  neto: string;
  iva: string;
  total: string;
  descripcion: string | null;
  comprobante_tipo: string | null;
  comprobante_numero: string | null;
  en_iva_compras: boolean;
  medio_pago: string;
  /** Si generó movimiento de caja. El id no se manda: es un BigInt. */
  salio_de_caja: boolean;
  created_at: string;
}

export interface ResumenGastosDTO {
  total: string;
  cantidad: string;
  arca_total: string;
  arca_cantidad: string;
  arca_credito: string;
  fuera_total: string;
  fuera_cantidad: string;
}

export interface TotalCategoriaDTO {
  categoria: string;
  total: string;
  neto: string;
  iva: string;
  cantidad: string;
}

interface ProveedorDTO {
  id: string;
  name: string;
  doc: string | null;
}

type Grano = 'mes' | 'trimestre' | 'anio';

interface Props {
  gastos: GastoDTO[];
  resumen: ResumenGastosDTO;
  porCategoria: TotalCategoriaDTO[];
  proveedores: ProveedorDTO[];
  grano: Grano;
  periodoEtiqueta: string;
  /** Si hay caja abierta. Decide si se puede pagar en EFECTIVO. */
  hayCajaAbierta: boolean;
  cashierName: string;
  salePointLabel: string;
}

/**
 * Los tres períodos.
 *
 * "Año" dice **calendario** a propósito: `periodoDe('anio')` es enero-diciembre,
 * y el ejercicio comercial de una sociedad NO tiene por qué cerrar el 31/12 (el
 * de ROMERO & RUIZ SAS no cierra ahí). Llamarlo "el año" a secas invitaría a
 * leer estos totales como los del ejercicio y mandarle al estudio un período
 * equivocado. Cuando `companies` tenga fecha de cierre de ejercicio, se agrega
 * la opción de verdad.
 */
const GRANOS: Array<{ valor: Grano; label: string }> = [
  { valor: 'mes', label: 'Mes' },
  { valor: 'trimestre', label: 'Trimestre' },
  { valor: 'anio', label: 'Año calendario' },
];

/** Categorías tomadas del pedido de la contadora (schema `expenses`). */
const CATEGORIAS: Array<{ valor: string; label: string }> = [
  { valor: 'alquiler', label: 'Alquiler' },
  { valor: 'seguros', label: 'Seguros' },
  { valor: 'servicios', label: 'Servicios' },
  { valor: 'impuestos_y_tasas', label: 'Impuestos y tasas' },
  { valor: 'honorarios', label: 'Honorarios' },
  { valor: 'mercaderia', label: 'Mercadería' },
  { valor: 'otros', label: 'Otros' },
];
const catLabel = (v: string) =>
  CATEGORIAS.find((c) => c.valor === v)?.label ?? v;

/**
 * El color va por CLASE, no inline.
 *
 * La primera versión pasaba el hex por `style`, y un color inline no puede
 * tener variante de tema: en oscuro quedaban las siete pills con texto oscuro
 * sobre fondo oscuro, ilegibles (medido, no supuesto). Las variables viven en
 * `gastosCss.ts`, con su bloque para cada tema.
 */
const catClase = (v: string) =>
  CATEGORIAS.some((c) => c.valor === v) ? `cat-${v}` : 'cat-otros';

const MEDIOS: Array<{ valor: string; label: string }> = [
  { valor: 'efectivo', label: 'Efectivo' },
  { valor: 'transferencia', label: 'Transferencia' },
  { valor: 'debito', label: 'Débito' },
  { valor: 'credito', label: 'Crédito' },
  { valor: 'otro', label: 'Otro' },
];
const medioLabel = (v: string) => MEDIOS.find((m) => m.valor === v)?.label ?? v;

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});
/** Sólo presentación: el cálculo ya vino hecho del servidor, en Decimal. */
const plata = (v: string) => PESOS.format(Number(v));

/** 'AAAA-MM-DD' → '12 sep'. Sin `new Date()`: parsear la fecha suelta la corre
 *  un día para atrás en cualquier huso al oeste de UTC (el nuestro lo es). */
function fechaCorta(iso: string): string {
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const [, m, d] = iso.split('-');
  const mes = MESES[Number(m) - 1] ?? '';
  return `${Number(d)} ${mes}`;
}

/** Hoy en 'AAAA-MM-DD' local, para el valor por defecto del formulario. */
function hoyLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Filtro = 'todos' | 'manda' | 'arca';

export function GastosClient({
  gastos,
  resumen,
  porCategoria,
  proveedores,
  grano,
  periodoEtiqueta,
  hayCajaAbierta,
  cashierName,
  salePointLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todos');

  // El período vive en la URL, así que cambiarlo es NAVEGAR. Con
  // `window.location.href = ...` el navegador recarga la app entera (y el
  // linter lo marca, con razón: es mutar algo de afuera del componente); con
  // el router de Next se vuelve a renderizar sólo esta página en el servidor.
  const cambiarGrano = (g: Grano) => {
    router.push(`/gastos?periodo=${g}`);
  };

  const visibles = useMemo(() => {
    if (filtro === 'manda') return gastos.filter((g) => !g.en_iva_compras);
    if (filtro === 'arca') return gastos.filter((g) => g.en_iva_compras);
    return gastos;
  }, [gastos, filtro]);

  const guardar = (form: GastoFormInput) => {
    setError(null);
    startTransition(async () => {
      const res = await registrarGastoAction(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setModalAbierto(false);
    });
  };

  const exportar = () => {
    setError(null);
    startTransition(async () => {
      const res = await exportarGastosCsvAction(grano, true);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.nombre;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const hayParaMandar = Number(resumen.fuera_cantidad) > 0;

  // Selector de período, en la topbar — igual que /contador.
  const topbarIzq = (
    <div className="seg glass">
      {GRANOS.map((g) => (
        <button
          key={g.valor}
          type="button"
          className={g.valor === grano ? 'on' : undefined}
          onClick={() => cambiarGrano(g.valor)}
        >
          {g.label}
        </button>
      ))}
    </div>
  );

  const contenido = (
    <>
      <style>{GASTOS_CSS}</style>

      <div className="bar">
        <div className="bar-id">
          <span className="bar-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M16 4v5h5" />
              <path d="M8 14h8" />
              <path d="M8 18h5" />
            </svg>
          </span>
          <div>
            <div className="bar-title">Gastos</div>
            <div className="bar-sub">
              {salePointLabel} · {periodoEtiqueta}
            </div>
          </div>
        </div>
        <div className="bar-actions">
          <button
            type="button"
            className="b ghost"
            onClick={exportar}
            disabled={pending || !hayParaMandar}
            title={
              hayParaMandar
                ? 'Baja un CSV con los gastos que el estudio no ve en ARCA'
                : 'En este período no hay gastos fuera del IVA compras: no hay nada que mandar'
            }
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
            Exportar para el estudio
          </button>
          <button
            type="button"
            className="b primary"
            onClick={() => {
              setError(null);
              setModalAbierto(true);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nuevo gasto
          </button>
        </div>
      </div>

      {error !== null ? (
        <div className="card glass" style={{ padding: '13px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, color: '#c0384a', fontWeight: 600 }}>{error}</div>
        </div>
      ) : null}

      <div className="kpis">
        <div className="k lead">
          <div className="k-k">
            <i className="d" style={{ background: '#6b5fff' }} />
            Gastado en el período
          </div>
          <div className="k-v">{plata(resumen.total)}</div>
          <div className="k-f">
            {resumen.cantidad} {Number(resumen.cantidad) === 1 ? 'gasto' : 'gastos'} cargados
          </div>
        </div>

        <div className="k warn">
          <div className="k-k">
            <i className="d" style={{ background: '#f7984a' }} />
            Hay que mandar
          </div>
          <div className="k-v">{plata(resumen.fuera_total)}</div>
          {/* Corto a una línea a propósito: medido, el pie largo envolvía y
              estiraba TODA la fila de KPIs 8px (las tarjetas de un grid crecen
              con la más alta). El detalle largo ya está en el panel de la
              derecha. */}
          <div className="k-f">
            {resumen.fuera_cantidad} sin factura · van en el export
          </div>
        </div>

        <div className="k">
          <div className="k-k">
            <i className="d" style={{ background: '#34c77d' }} />
            Ya está en ARCA
          </div>
          <div className="k-v">{plata(resumen.arca_total)}</div>
          <div className="k-f">
            {resumen.arca_cantidad} con factura · el estudio los baja solo
          </div>
        </div>

        <div className="k">
          <div className="k-k">
            <i className="d" style={{ background: '#5b8cff' }} />
            IVA crédito fiscal
          </div>
          <div className="k-v">{plata(resumen.arca_credito)}</div>
          <div className="k-f">sólo de los que tienen factura</div>
        </div>
      </div>

      <div className="cli-grid">
        <div className="card glass" style={{ padding: '18px 0 6px' }}>
          <div
            className="card-title"
            style={{ padding: '0 18px', marginBottom: 14 }}
          >
            <h3>Gastos del período</h3>
            <div className="gfilters">
              <button
                type="button"
                className={filtro === 'todos' ? 'gf on' : 'gf'}
                onClick={() => setFiltro('todos')}
              >
                Todos ({resumen.cantidad})
              </button>
              <button
                type="button"
                className={filtro === 'manda' ? 'gf on' : 'gf'}
                onClick={() => setFiltro('manda')}
              >
                Hay que mandar ({resumen.fuera_cantidad})
              </button>
              <button
                type="button"
                className={filtro === 'arca' ? 'gf on' : 'gf'}
                onClick={() => setFiltro('arca')}
              >
                En ARCA ({resumen.arca_cantidad})
              </button>
            </div>
          </div>

          {visibles.length === 0 ? (
            <div className="gempty">
              <div className="t">
                {gastos.length === 0
                  ? 'Todavía no hay gastos cargados en este período'
                  : 'Ningún gasto de este período entra en ese filtro'}
              </div>
              <div className="s">
                {gastos.length === 0 ? (
                  <>
                    Cargá acá el alquiler, los servicios, los seguros, los
                    impuestos y las compras. Los que tienen factura los toma el
                    estudio de ARCA; el resto sale en el export para mandarle.
                  </>
                ) : (
                  <>Probá con “Todos”.</>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="cl-colhead">
                <span style={{ width: 78, flex: '0 0 auto' }}>Fecha</span>
                <span style={{ flex: 1 }}>Proveedor / detalle</span>
                <span style={{ width: 118, flex: '0 0 auto', textAlign: 'center' }}>
                  Categoría
                </span>
                <span style={{ width: 126, flex: '0 0 auto', textAlign: 'center' }}>
                  IVA compras
                </span>
                <span style={{ width: 96, flex: '0 0 auto' }}>Pagó con</span>
                <span style={{ width: 104, flex: '0 0 auto', textAlign: 'right' }}>
                  Importe
                </span>
              </div>

              <div className="cl-list">
                {visibles.map((g) => (
                  <div key={g.id} className="clrow" style={{ cursor: 'default' }}>
                    <span className="gfecha">{fechaCorta(g.fecha)}</span>
                    <div className="clmain">
                      <div className="clname">
                        {g.payee_name ?? g.descripcion ?? catLabel(g.categoria)}
                      </div>
                      <div className="clid">
                        {[
                          g.comprobante_numero !== null
                            ? `${g.comprobante_tipo ?? 'Comp.'} ${g.comprobante_numero}`
                            : 'sin comprobante',
                          g.payee_name !== null && g.descripcion !== null
                            ? g.descripcion
                            : null,
                          g.salio_de_caja ? 'salió de la caja' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <span className={`gcat ${catClase(g.categoria)}`}>
                      {catLabel(g.categoria)}
                    </span>
                    <span className={g.en_iva_compras ? 'gflag arca' : 'gflag manda'}>
                      {g.en_iva_compras ? 'Ya en ARCA' : 'Hay que mandar'}
                    </span>
                    <span className="gmedio">{medioLabel(g.medio_pago)}</span>
                    <span className="gtotal">{plata(g.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          <div className="card glass">
            <div className="card-title">
              <h3>Por categoría</h3>
            </div>
            {porCategoria.length === 0 ? (
              <div className="label-sm">Sin gastos en el período.</div>
            ) : (
              porCategoria.map((c) => (
                <div key={c.categoria} className="gcatrow">
                  <span className={`gcatdot ${catClase(c.categoria)}`} />
                  <span className="gcatname">{catLabel(c.categoria)}</span>
                  <span className="gcatn">{c.cantidad}</span>
                  <span className="gcatv">{plata(c.total)}</span>
                </div>
              ))
            )}
          </div>

          <div className="card glass">
            <div className="card-title">
              <h3>Qué se manda al estudio</h3>
            </div>
            <p className="label-sm" style={{ lineHeight: 1.55 }}>
              Los gastos <b>con factura</b> entran al IVA compras y el estudio
              los baja de ARCA. Los que <b>no tienen comprobante fiscal</b> no
              los ve nadie: ésos son los que hay que mandarle, y son los que
              bajan en el export.
            </p>
            <div className="divider" />
            <div className="kv">
              <span className="k">A mandar este período</span>
              <span className="v">{plata(resumen.fuera_total)}</span>
            </div>
            <div className="kv">
              <span className="k">Comprobantes</span>
              <span className="v">{resumen.fuera_cantidad}</span>
            </div>
          </div>

          {/* Un gasto no se edita: se corrige registrando otro. No es una
              limitación pendiente de resolver, es la decisión — por eso se dice
              acá y no se esconde detrás de un botón apagado. */}
          <div className="card glass">
            <div className="card-title">
              <h3>Un gasto cargado no se edita</h3>
            </div>
            <p className="label-sm" style={{ lineHeight: 1.55 }}>
              Si algo salió mal, se registra un gasto de ajuste. La contadora
              puede haber usado el número para una declaración: que cambie
              debajo sería peor que el error.
            </p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <AppShell
      storeName={salePointLabel}
      userName={cashierName}
      userRole="Cajero"
      afipConnected={false}
      afipDetail="WSFEv1 · sin certificado"
      scroll="pagina"
      topbarLeft={topbarIzq}
    >
      {contenido}
      {modalAbierto ? (
        <GastoModal
          proveedores={proveedores}
          hayCajaAbierta={hayCajaAbierta}
          pending={pending}
          onCancelar={() => setModalAbierto(false)}
          onGuardar={guardar}
        />
      ) : null}
    </AppShell>
  );
}

// ════════════════════════ Modal de carga ════════════════════════

function GastoModal({
  proveedores,
  hayCajaAbierta,
  pending,
  onCancelar,
  onGuardar,
}: {
  proveedores: ProveedorDTO[];
  hayCajaAbierta: boolean;
  pending: boolean;
  onCancelar: () => void;
  onGuardar: (form: GastoFormInput) => void;
}) {
  const [fecha, setFecha] = useState(hoyLocal);
  const [categoria, setCategoria] = useState('servicios');
  const [proveedorId, setProveedorId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [total, setTotal] = useState('');
  const [discrimina, setDiscrimina] = useState(false);
  const [neto, setNeto] = useState('');
  const [iva, setIva] = useState('');
  // Arranca en el medio que NO depende de que haya caja: si no hay ninguna
  // abierta, elegir efectivo dejaría el formulario trabado desde el vamos.
  const [medio, setMedio] = useState(hayCajaAbierta ? 'efectivo' : 'transferencia');
  const [compTipo, setCompTipo] = useState('Factura');
  const [compNumero, setCompNumero] = useState('');
  const [enIvaCompras, setEnIvaCompras] = useState(false);
  const [descripcion, setDescripcion] = useState('');

  const dec = (v: string): Decimal | null => {
    if (v.trim() === '') return null;
    try {
      const d = new Decimal(v.replace(',', '.'));
      return d.isFinite() ? d : null;
    } catch {
      return null;
    }
  };

  const dTotal = dec(total);
  const dNeto = dec(neto);
  const dIva = dec(iva);

  const totalInvalido = dTotal === null || dTotal.lte(0);
  // Si se discriminó, neto + IVA tiene que cerrar contra el total. Un tipeo acá
  // deja en la declaración un crédito fiscal que no coincide con el papel.
  const noCierra =
    discrimina &&
    dTotal !== null &&
    dNeto !== null &&
    dIva !== null &&
    !dNeto.plus(dIva).eq(dTotal);
  const faltaDiscriminar = discrimina && (dNeto === null || dIva === null);
  const faltaComprobante = enIvaCompras && compNumero.trim() === '';
  const efectivoBloqueado = medio === 'efectivo' && !hayCajaAbierta;

  const puedeGuardar =
    !totalInvalido &&
    !noCierra &&
    !faltaDiscriminar &&
    !faltaComprobante &&
    !efectivoBloqueado &&
    !pending;

  /** Completa el IVA al 21% desde el total, que es el caso común. */
  const calcular21 = () => {
    if (dTotal === null || dTotal.lte(0)) return;
    const base = dTotal.div('1.21');
    setNeto(base.toFixed(2));
    // El IVA sale por RESTA, no por `base * 0.21`: así los dos redondeos siempre
    // suman exactamente el total, que es lo que el servidor va a exigir.
    setIva(dTotal.minus(base.toFixed(2)).toFixed(2));
  };

  const enviar = () => {
    if (!puedeGuardar || dTotal === null) return;
    onGuardar({
      fecha,
      categoria: categoria as GastoFormInput['categoria'],
      total: dTotal.toFixed(2),
      ...(discrimina && dNeto !== null && dIva !== null
        ? { neto: dNeto.toFixed(2), iva: dIva.toFixed(2) }
        : {}),
      medio_pago: medio as GastoFormInput['medio_pago'],
      ...(proveedorId !== '' ? { tercero_id: proveedorId } : {}),
      ...(proveedorId === '' && payeeName.trim() !== ''
        ? { payee_name: payeeName.trim() }
        : {}),
      ...(compNumero.trim() !== ''
        ? { comprobante_tipo: compTipo, comprobante_numero: compNumero.trim() }
        : {}),
      en_iva_compras: enIvaCompras,
      ...(descripcion.trim() !== '' ? { descripcion: descripcion.trim() } : {}),
    });
  };

  return (
    <div className="pmov open" onClick={onCancelar}>
      <div
        className="pmod"
        role="dialog"
        aria-modal="true"
        aria-label="Cargar un gasto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-head">
          <div>
            <div className="pm-title">Nuevo gasto</div>
            <div className="pm-sub">
              La fecha es la <b>del gasto</b>, no la de hoy: se cargan atrasados
              todo el tiempo.
            </div>
          </div>
          <button type="button" className="pm-x" onClick={onCancelar} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="pm-row">
          <div className="pm-fld">
            <label htmlFor="gFecha">Fecha del gasto</label>
            <input
              id="gFecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <div className="pm-fld">
            <label htmlFor="gCat">Categoría</label>
            <select
              id="gCat"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
            >
              {CATEGORIAS.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pm-fld">
          <label htmlFor="gProv">A quién se le pagó</label>
          <select
            id="gProv"
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
          >
            <option value="">Escribir el nombre…</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.doc !== null ? ` · ${p.doc}` : ''}
              </option>
            ))}
          </select>
          {proveedorId === '' ? (
            <input
              style={{ marginTop: 8 }}
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
              placeholder="Nombre del proveedor (opcional)"
              aria-label="Nombre del proveedor"
            />
          ) : null}
        </div>

        <div className="pm-fld">
          <label htmlFor="gTotal">Cuánto se pagó</label>
          <input
            id="gTotal"
            className="big"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            autoFocus
          />
        </div>

        <label className="pm-check" htmlFor="gDisc">
          <input
            id="gDisc"
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
            <span className="t">El comprobante discrimina el IVA</span>
            <span className="s">
              Sólo si la factura lo muestra aparte. Neto + IVA tiene que dar
              exactamente el total.
            </span>
          </span>
        </label>

        {discrimina ? (
          <>
            <div className="pm-row">
              <div className="pm-fld">
                <label htmlFor="gNeto">Neto</label>
                <input
                  id="gNeto"
                  value={neto}
                  onChange={(e) => setNeto(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </div>
              <div className="pm-fld">
                <label htmlFor="gIva">IVA</label>
                <input
                  id="gIva"
                  value={iva}
                  onChange={(e) => setIva(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </div>
            </div>
            <p className="pm-note" style={{ marginTop: -6 }}>
              <button
                type="button"
                onClick={calcular21}
                disabled={dTotal === null || dTotal.lte(0)}
                style={{
                  font: 'inherit',
                  color: 'var(--purple)',
                  fontWeight: 700,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                Calcular al 21%
              </button>{' '}
              desde el total. Verificá contra el papel: hay gastos al 10,5% y
              otros exentos.
            </p>
          </>
        ) : null}

        {noCierra ? (
          <p className="pm-warn red">
            Neto + IVA da <b>{plata(dNeto!.plus(dIva!).toFixed(2))}</b> y el
            total es <b>{plata(dTotal!.toFixed(2))}</b>. Tienen que coincidir.
          </p>
        ) : null}

        <div className="pm-row">
          <div className="pm-fld">
            <label htmlFor="gCompTipo">Comprobante</label>
            <select
              id="gCompTipo"
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
          <div className="pm-fld">
            <label htmlFor="gCompNro">Número</label>
            <input
              id="gCompNro"
              value={compNumero}
              onChange={(e) => setCompNumero(e.target.value)}
              placeholder="0001-00001234"
            />
          </div>
        </div>

        <label className="pm-check" htmlFor="gArca">
          <input
            id="gArca"
            type="checkbox"
            checked={enIvaCompras}
            onChange={(e) => setEnIvaCompras(e.target.checked)}
          />
          <span>
            <span className="t">Entra al IVA compras</span>
            <span className="s">
              Marcalo si es una factura a nombre del comercio. El estudio ya la
              baja de ARCA y no hace falta mandársela. Sin marcar, sale en el
              export para el estudio.
            </span>
          </span>
        </label>

        {faltaComprobante ? (
          <p className="pm-warn red">
            Un gasto que entra al IVA compras necesita el <b>número de
            comprobante</b>: es lo que después permite cruzarlo con lo que el
            estudio ve en ARCA.
          </p>
        ) : null}

        <div className="pm-fld">
          <label htmlFor="gMedio">Con qué se pagó</label>
          <select id="gMedio" value={medio} onChange={(e) => setMedio(e.target.value)}>
            {MEDIOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Sólo el efectivo toca la caja. Los otros medios no: si todo egreso
            saliera del cajón, el arqueo descontaría plata que nunca estuvo ahí. */}
        {medio === 'efectivo' ? (
          hayCajaAbierta ? (
            <p className="pm-warn amber">
              Sale de la <b>caja del día</b> y se descuenta del arqueo.{' '}
              <b>No lo cargues además como egreso en Caja</b>: se descontaría dos
              veces.
            </p>
          ) : (
            <p className="pm-warn red">
              <b>No hay una caja abierta.</b> Un gasto en efectivo tiene que
              salir de la caja del día. Abrila desde Caja, o cargalo con el medio
              con el que realmente se pagó.
            </p>
          )
        ) : (
          <p className="pm-note">No toca la caja: no es plata del cajón.</p>
        )}

        <div className="pm-fld">
          <label htmlFor="gDesc">Detalle (opcional)</label>
          <input
            id="gDesc"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Luz de agosto, alquiler de septiembre…"
          />
        </div>

        <div className="pm-acts">
          <button type="button" className="pm-btn ghost" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className="pm-btn primary"
            disabled={!puedeGuardar}
            onClick={enviar}
          >
            {pending ? 'Guardando…' : 'Guardar gasto'}
          </button>
        </div>
      </div>
    </div>
  );
}
