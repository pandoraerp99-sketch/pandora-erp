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
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { AppShell } from '@/components/shell/AppShell';
import { diaDelComercio } from '@/lib/domain/fecha-comercio';
import { GASTOS_CSS } from './gastosCss';
import {
  anularGastoAction,
  buscarProductosAction,
  exportarAcreedoresCsvAction,
  exportarGastosCsvAction,
  exportarProveedoresCsvAction,
  getDetalleAction,
  pagarProveedorAction,
  registrarGastoAction,
  type GastoFormInput,
  type LineaDTO,
  type ProductoBuscadoDTO,
} from './actions';

/** Los medios con los que se le puede pagar a un proveedor (ADR-0028 §7). */
type MedioPagoProveedor = 'efectivo' | 'transferencia' | 'debito' | 'credito';

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
  /** Renglones del detalle. 0 = no hay nada que mostrar. */
  renglones: number;
  created_at: string;
}

/**
 * Un gasto anulado, con su anulación al lado.
 *
 * No entra en ningún total — el original dejó de estar vigente y la fila de
 * anulación vale 0 — pero se muestra igual, porque anular no es borrar y el
 * comerciante tiene que poder ver qué anuló y por qué.
 */
export interface GastoAnuladoDTO {
  id: string;
  fecha: string;
  categoria: string;
  payee_name: string | null;
  comprobante_numero: string | null;
  total: string;
  motivo: string | null;
  anulado_el: string;
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

/** Ítem 9 de la carta: razón social, CUIT e importe. */
export interface ProveedorPeriodoDTO {
  nombre: string;
  cuit: string;
  /** CUIT distintos agrupados. > 1 = hay algo para revisar antes de mandarlo. */
  cuits: string;
  comprobantes: string;
  total: string;
}

interface ProveedorDTO {
  id: string;
  name: string;
  doc: string | null;
}

/**
 * Un acreedor al cierre. Viene de `getAcreedoresAlCierre`, que NO filtra
 * proveedores dados de baja: a un proveedor desactivado se le sigue debiendo, y
 * el balance lo tiene que listar. Por eso el alta de deuda sólo ofrece los
 * activos, pero esta lista los muestra a todos.
 */
export interface AcreedorDTO {
  tercero_id: string;
  nombre: string;
  /** CUIT. Vacío si nunca se cargó. */
  doc: string;
  saldo: string;
}

type Grano = 'mes' | 'trimestre' | 'anio' | 'ejercicio';

interface Props {
  gastos: GastoDTO[];
  anulados: GastoAnuladoDTO[];
  resumen: ResumenGastosDTO;
  porCategoria: TotalCategoriaDTO[];
  porProveedor: ProveedorPeriodoDTO[];
  /** Lo que se les DEBE al cierre del período (ítem 9, ADR-0028). */
  acreedores: AcreedorDTO[];
  /**
   * El último día del período, no el `hasta` exclusivo: es la fecha con la que
   * se cortó `acreedores`, y la que la tarjeta muestra. Viene del servidor para
   * que la pantalla no vuelva a calcularla y las dos no puedan discrepar.
   */
  fechaAlCierre: string;
  proveedores: ProveedorDTO[];
  grano: Grano;
  periodoEtiqueta: string;
  /** Si hay caja abierta. Decide si se puede pagar en EFECTIVO. */
  hayCajaAbierta: boolean;
  cashierName: string;
  salePointLabel: string;
}

/**
 * Los períodos.
 *
 * "Año" dice **calendario** a propósito, y "Ejercicio" existe por eso mismo: el
 * ejercicio comercial de una sociedad no tiene por qué cerrar el 31/12 (el de
 * ROMERO & RUIZ SAS cierra el 31/07). Con sólo "Año", quien mandara ese recorte
 * al estudio le estaría mandando doce meses que no son los del balance.
 *
 * **"Ejercicio" es el último CERRADO**, no el que está en curso — es el único
 * que tiene destinatario. Rompe la simetría con los otros tres, que son el
 * período corriente, así que el rango exacto se muestra al lado del título.
 */
const GRANOS: Array<{ valor: Grano; label: string }> = [
  { valor: 'mes', label: 'Mes' },
  { valor: 'trimestre', label: 'Trimestre' },
  { valor: 'anio', label: 'Año calendario' },
  { valor: 'ejercicio', label: 'Ejercicio' },
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

/**
 * Esta lista NO deriva de `EXPENSE_PAYMENT_METHODS` a propósito: el const del
 * servidor es el contrato de la base, y la pantalla necesita además la etiqueta
 * en castellano y el orden en que se ofrece. Lo que sí hay que sostener a mano
 * es que ningún medio del servidor quede sin ofrecerse — que es exactamente lo
 * que pasó con `cuenta_corriente` entre el 17 y el 18 de septiembre: el libro
 * de proveedores estaba entero y la deuda no podía nacer desde ninguna pantalla.
 */
const MEDIOS: Array<{ valor: string; label: string }> = [
  { valor: 'efectivo', label: 'Efectivo' },
  { valor: 'transferencia', label: 'Transferencia' },
  { valor: 'debito', label: 'Débito' },
  { valor: 'credito', label: 'Crédito' },
  { valor: 'cuenta_corriente', label: 'A cuenta corriente (queda debiendo)' },
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

/**
 * Hoy en 'AAAA-MM-DD' del COMERCIO, para el valor por defecto del formulario.
 * No el del reloj que renderiza: en el server es UTC, y a las 22:00 proponía
 * mañana — una fecha que el service rechaza por futura en una compra.
 */
function hoyLocal(): string {
  return diaDelComercio();
}

type Filtro = 'todos' | 'manda' | 'arca' | 'anulados';

export function GastosClient({
  gastos,
  anulados,
  resumen,
  porCategoria,
  porProveedor,
  acreedores,
  fechaAlCierre,
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
  /** Gasto cuyo detalle se está mirando. */
  const [viendo, setViendo] = useState<GastoDTO | null>(null);
  /** Gasto que se está por anular. */
  const [anulando, setAnulando] = useState<GastoDTO | null>(null);
  /** Proveedor al que se le está por pagar. */
  const [pagando, setPagando] = useState<AcreedorDTO | null>(null);

  // Suma con Decimal, no con `+=` sobre strings: es plata (CLAUDE.md §9.8).
  const totalAdeudado = useMemo(
    () =>
      acreedores
        .reduce((acc, a) => acc.plus(new Decimal(a.saldo)), new Decimal(0))
        .toFixed(2),
    [acreedores]
  );

  const pagar = (monto: string, medio: MedioPagoProveedor) => {
    const a = pagando;
    if (a === null) return;
    setError(null);
    startTransition(async () => {
      const res = await pagarProveedorAction(a.tercero_id, monto, medio);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPagando(null);
      router.refresh();
    });
  };

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

  /**
   * Anular.
   *
   * El error del service se muestra TAL CUAL: el de mercadería ya vendida
   * nombra el producto y sus números, y eso es lo que le dice al comerciante
   * qué hacer. Reemplazarlo por un "no se pudo" tiraría justo la parte útil.
   */
  const anular = (motivo: string) => {
    const gasto = anulando;
    if (gasto === null) return;
    setError(null);
    startTransition(async () => {
      const res = await anularGastoAction(gasto.id, motivo);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAnulando(null);
      // Queda en la pestaña de anulados, que es a dónde se fue el gasto: si la
      // lista volviera a "Todos", el comerciante vería que desapareció y no
      // sabría si se anuló o si pasó otra cosa.
      setFiltro('anulados');
      router.refresh();
    });
  };

  /** Baja lo que devuelva la acción. La descarga la arma el navegador. */
  const bajar = (
    pedir: () =>
      Promise<{ ok: true; csv: string; nombre: string } | { ok: false; error: string }>
  ) => {
    setError(null);
    startTransition(async () => {
      const res = await pedir();
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

  const exportar = (soloFueraDeArca: boolean) =>
    bajar(() => exportarGastosCsvAction(grano, soloFueraDeArca));

  const exportarProveedores = () =>
    bajar(() => exportarProveedoresCsvAction(grano));

  const exportarAcreedores = () => bajar(() => exportarAcreedoresCsvAction(grano));

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
          <MenuExportar
            pending={pending}
            cantidadFuera={Number(resumen.fuera_cantidad)}
            cantidadTotal={Number(resumen.cantidad)}
            cantidadProveedores={porProveedor.length}
            cantidadAcreedores={acreedores.length}
            onExportar={exportar}
            onExportarProveedores={exportarProveedores}
            onExportarAcreedores={exportarAcreedores}
          />
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
          <div className="g-error">{error}</div>
        </div>
      ) : null}

      <div className="kpis">
        <div className="k lead">
          <div className="k-k">
            <i className="d" style={{ background: '#6b5fff' }} />
            Gastado en el período
          </div>
          <div className="k-v">{plata(resumen.total)}</div>
          {/* El pie cuenta los CARGADOS y el importe es lo que SALIÓ: con una
              compra a cuenta corriente adentro, no son la misma pregunta, y
              callarlo deja al lector restando mal. Va en una línea a propósito
              (ver el comentario del KPI de al lado). */}
          <div className="k-f">
            {resumen.cantidad} {Number(resumen.cantidad) === 1 ? 'gasto' : 'gastos'} cargados · el total es lo que salió
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
              {/* Anular saca al gasto de todos los demás filtros y de todos los
                  totales. Sin esta pestaña se vería como si se hubiera
                  borrado, y la tabla es append-only justamente para que nada
                  se borre. */}
              <button
                type="button"
                className={filtro === 'anulados' ? 'gf on' : 'gf'}
                onClick={() => setFiltro('anulados')}
              >
                Anulados ({anulados.length})
              </button>
            </div>
          </div>

          {filtro === 'anulados' ? (
            <ListaAnulados filas={anulados} />
          ) : visibles.length === 0 ? (
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
                <span style={{ width: 148, flex: '0 0 auto' }} />
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
                    <span className="gacts">
                      {g.renglones > 0 ? (
                        <button
                          type="button"
                          className="gact"
                          onClick={() => setViendo(g)}
                          title="Ver los renglones de esta compra"
                        >
                          Detalle ({g.renglones})
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="gact danger"
                        // Cierra el detalle si estaba abierto: los dos modales
                        // comparten z-index, así que apilados el de atrás queda
                        // inalcanzable (CLAUDE.md §14.13).
                        onClick={() => {
                          setViendo(null);
                          setAnulando(g);
                        }}
                        title="Anular este gasto"
                      >
                        Anular
                      </button>
                    </span>
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
            {/* Decisión del owner (2026-09-18): este listado queda DEVENGADO y
                se declara. No puede seguir el criterio de caja porque agrupa
                por rubro y un pago se le hace al proveedor, no a una factura
                (ADR-0028 §5). Sin este texto, el que compare los dos números
                cree que uno está roto. */}
            {porCategoria.length > 0 ? (
              <p className="label-sm" style={{ marginTop: 10, lineHeight: 1.5 }}>
                Es lo que se <b>gastó</b> en cada rubro, pagado o no. Puede{' '}
                <b>no coincidir</b> con el total de arriba, que es la plata que
                salió: una compra a cuenta corriente entra acá cuando se compra y
                allá cuando se paga.
              </p>
            ) : null}
          </div>

          {/* Ítem 9 de la carta. Va en pantalla y no sólo en el export para
              poder REVISARLO antes de mandarlo: acá se ve si a un proveedor le
              quedaron dos CUIT distintos, que es lo que nadie chequea en un
              CSV ya enviado. */}
          {porProveedor.length > 0 ? (
            <div className="card glass">
              <div className="card-title">
                <h3>Por proveedor</h3>
              </div>
              {porProveedor.map((p) => (
                <div key={p.nombre} className="gprov">
                  <div className="gprov-id">
                    {/* La columna es angosta y una razón social larga se corta.
                        El CSV la lleva entera; acá el title deja verla sin
                        tener que exportar. */}
                    <div className="gprov-n" title={p.nombre}>
                      {p.nombre}
                    </div>
                    <div className="gprov-c">
                      {p.cuit === '' ? (
                        <span className="gprov-sin">sin CUIT</span>
                      ) : Number(p.cuits) > 1 ? (
                        <span className="gprov-ojo">
                          {p.cuits} CUIT distintos · revisar
                        </span>
                      ) : (
                        p.cuit
                      )}
                    </div>
                  </div>
                  <span className="gcatn">{p.comprobantes}</span>
                  <span className="gcatv">{plata(p.total)}</span>
                </div>
              ))}
              <p className="label-sm" style={{ marginTop: 10, lineHeight: 1.5 }}>
                Es lo que se le <b>pagó</b> a cada uno en el período. Lo que se
                les <b>debe</b> está abajo, en Acreedores.
              </p>
            </div>
          ) : null}

          {/* La otra mitad del ítem 9. Antes acá había un párrafo diciendo que
              "todo gasto se registra ya pagado, así que Pandora no sabe qué
              quedó debiendo" — dejó de ser cierto con la 0039 (ADR-0028). */}
          <div className="card glass" id="acreedores">
            <div className="card-title">
              <h3>Acreedores al {fechaCorta(fechaAlCierre)}</h3>
              {acreedores.length > 0 ? (
                <span className="gcatv">{plata(totalAdeudado)}</span>
              ) : null}
            </div>
            {acreedores.length === 0 ? (
              <p className="label-sm" style={{ lineHeight: 1.55 }}>
                No hay deudas con proveedores registradas a esa fecha. Un gasto
                queda como deuda cuando se carga con el medio{' '}
                <b>«A cuenta corriente»</b>.
              </p>
            ) : (
              <>
                {acreedores.map((a) => (
                  <div key={a.tercero_id} className="gprov">
                    <div className="gprov-id">
                      <div className="gprov-n" title={a.nombre}>
                        {a.nombre}
                      </div>
                      <div className="gprov-c">
                        {a.doc === '' ? (
                          <span className="gprov-sin">sin CUIT</span>
                        ) : (
                          a.doc
                        )}
                      </div>
                    </div>
                    <span className="gcatv">{plata(a.saldo)}</span>
                    <button
                      type="button"
                      className="gprov-pagar"
                      onClick={() => setPagando(a)}
                    >
                      Pagar
                    </button>
                  </div>
                ))}
                <p className="label-sm" style={{ marginTop: 10, lineHeight: 1.5 }}>
                  Es lo <b>registrado</b>, no todo lo que se debe: una factura que
                  nunca se cargó no aparece acá. El corte usa la fecha{' '}
                  <b>del comprobante</b>.
                </p>
              </>
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

      {viendo !== null ? (
        <DetalleModal gasto={viendo} onCerrar={() => setViendo(null)} />
      ) : null}

      {anulando !== null ? (
        <AnularModal
          gasto={anulando}
          pending={pending}
          error={error}
          onCancelar={() => {
            setAnulando(null);
            setError(null);
          }}
          onConfirmar={anular}
        />
      ) : null}

      {pagando !== null ? (
        <PagoProveedorModal
          acreedor={pagando}
          hayCajaAbierta={hayCajaAbierta}
          pending={pending}
          onCancelar={() => {
            setPagando(null);
            setError(null);
          }}
          onPagar={pagar}
        />
      ) : null}
    </AppShell>
  );
}

// ════════════════════════ Menú de exportar ════════════════════════

/**
 * Las DOS cosas que la contadora pide de los gastos.
 *
 * En su pedido hay dos líneas distintas, y es fácil leerlas como una sola:
 *
 *   1. "Otros gastos NO INCLUIDOS en el IVA COMPRAS" — los que ella no ve,
 *      porque no los baja de ARCA. Es la rutina mensual.
 *   2. "Comprobantes de PAGO de: alquileres, seguros, servicios, impuestos y
 *      tasas, honorarios" — esos los pide IGUAL, tengan factura o no. El libro
 *      IVA compras le dice qué se facturó; esto le dice qué se pagó.
 *
 * Si sólo existiera la primera, para el balance habría que armar la segunda a
 * mano — que es exactamente el trabajo que este módulo vino a sacar.
 *
 * Es un menú de ACCIONES (role=menu), no un filtro: teclado y cierre van a
 * mano, porque un <button> suelto no los regala. Mismo criterio y mismas
 * clases que `TipoDropdown`.
 */
function MenuExportar({
  pending,
  cantidadFuera,
  cantidadTotal,
  cantidadProveedores,
  cantidadAcreedores,
  onExportar,
  onExportarProveedores,
  onExportarAcreedores,
}: {
  pending: boolean;
  cantidadFuera: number;
  cantidadTotal: number;
  cantidadProveedores: number;
  cantidadAcreedores: number;
  onExportar: (soloFueraDeArca: boolean) => void;
  onExportarProveedores: () => void;
  onExportarAcreedores: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      // Esc cierra y devuelve el foco al botón; Tab cierra para no dejar un
      // menú flotando sobre la pantalla.
      if (e.key === 'Escape') {
        setAbierto(false);
        boton.current?.focus();
      } else if (e.key === 'Tab') {
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', afuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', afuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  const elegir = (soloFueraDeArca: boolean) => {
    setAbierto(false);
    onExportar(soloFueraDeArca);
  };

  // `cantidadTotal` cuenta los gastos CARGADOS en el período, que es lo mismo
  // que exporta "Todos los gastos": si contara sólo los pagados, la etiqueta
  // diría 9 y el archivo traería 11. Un comercio que compra todo a cuenta
  // corriente tampoco queda afuera — antes daba 0 y deshabilitaba el item de
  // un CSV que sí tenía filas.
  const nada = cantidadTotal === 0 && cantidadAcreedores === 0;
  // Sólo los tres items de GASTOS dependen de que haya gastos; acreedores no.
  const sinGastos = cantidadTotal === 0;

  return (
    <div className={abierto ? 'tipo-dd open' : 'tipo-dd'} ref={caja}>
      <button
        ref={boton}
        type="button"
        className="b ghost"
        aria-haspopup="menu"
        aria-expanded={abierto}
        disabled={pending || nada}
        title={
          nada
            ? 'En este período no hay gastos cargados ni deudas con proveedores: no hay nada que exportar'
            : 'Bajar un CSV para mandarle al estudio'
        }
        onClick={() => setAbierto((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
        {pending ? 'Generando…' : 'Exportar para el estudio'}
      </button>

      <div className="tipo-menu der" role="menu" aria-label="Qué exportar">
        <button
          type="button"
          role="menuitem"
          className="tm-item"
          disabled={cantidadFuera === 0}
          onClick={() => elegir(true)}
          title={
            cantidadFuera === 0
              ? 'En este período todos los gastos tienen factura: el estudio ya los baja de ARCA'
              : undefined
          }
        >
          <span className="tt">
            Lo que hay que mandar ({cantidadFuera})
          </span>
          <span className="ss">
            {cantidadFuera === 0
              ? 'Todos los del período tienen factura: el estudio ya los ve.'
              : 'Sólo los que no entran al IVA compras. Es la rutina de todos los meses.'}
          </span>
        </button>

        <div className="tm-div" />

        <button
          type="button"
          role="menuitem"
          className="tm-item"
          onClick={() => elegir(false)}
          disabled={sinGastos}
        >
          <span className="tt">Todos los gastos ({cantidadTotal})</span>
          <span className="ss">
            Para el balance: son los comprobantes de alquiler, seguros,
            servicios, tasas y honorarios, que se piden con factura o sin ella.
            Van todos los del período, pagados o no.
          </span>
        </button>

        <div className="tm-div" />

        <button
          type="button"
          role="menuitem"
          className="tm-item"
          onClick={() => {
            setAbierto(false);
            onExportarProveedores();
          }}
          disabled={sinGastos}
        >
          <span className="tt">Proveedores ({cantidadProveedores})</span>
          {/* Decía "lo que se les pagó" y la consulta no filtra por pago. Lo
              impago sale acá Y en acreedores, así que el subtexto tiene que
              decir dónde se pisan: si no, el estudio los suma. */}
          <span className="ss">
            Razón social, CUIT e importe de lo que se les <b>compró</b> en el
            período, pagado o no.
          </span>
        </button>

        <div className="tm-div" />

        <button
          type="button"
          role="menuitem"
          className="tm-item"
          onClick={() => {
            setAbierto(false);
            onExportarAcreedores();
          }}
          disabled={cantidadAcreedores === 0}
          title={
            cantidadAcreedores === 0
              ? 'No hay deudas con proveedores registradas a la fecha de cierre'
              : undefined
          }
        >
          <span className="tt">Acreedores al cierre ({cantidadAcreedores})</span>
          <span className="ss">
            Lo que se les <b>debe</b>. Es lo que pide el balance, y el archivo
            lleva adentro con qué fecha se cortó.
          </span>
        </button>
      </div>
    </div>
  );
}

// ════════════════════════ Anulados ════════════════════════

/**
 * Los gastos anulados del período.
 *
 * Deliberadamente NO tiene totales. Un anulado no suma en ningún lado — ése es
 * el punto de anularlo — y poner un "total anulado" abajo invitaría a leerlo
 * como si fuera plata que salió.
 */
function ListaAnulados({ filas }: { filas: GastoAnuladoDTO[] }) {
  if (filas.length === 0) {
    return (
      <div className="gempty">
        <div className="t">No anulaste ningún gasto en este período</div>
        <div className="s">
          Cuando anulás uno, queda acá con su motivo. Nada se borra: el
          comprobante original y su anulación quedan los dos registrados.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="cl-colhead">
        <span style={{ width: 78, flex: '0 0 auto' }}>Fecha</span>
        <span style={{ flex: 1 }}>Proveedor / motivo de la anulación</span>
        <span style={{ width: 118, flex: '0 0 auto', textAlign: 'center' }}>
          Categoría
        </span>
        <span style={{ width: 104, flex: '0 0 auto', textAlign: 'right' }}>
          Importe
        </span>
      </div>
      <div className="cl-list">
        {filas.map((a) => (
          <div key={a.id} className="clrow anulada" style={{ cursor: 'default' }}>
            <span className="gfecha">{fechaCorta(a.fecha)}</span>
            <div className="clmain">
              <div className="clname">
                {a.payee_name ?? catLabel(a.categoria)}
                {a.comprobante_numero !== null ? ` · ${a.comprobante_numero}` : ''}
              </div>
              <div className="clid">
                {a.motivo ?? 'sin motivo'} · anulado el{' '}
                {fechaCorta(a.anulado_el.slice(0, 10))}
              </div>
            </div>
            <span className={`gcat ${catClase(a.categoria)}`}>
              {catLabel(a.categoria)}
            </span>
            {/* Tachado: el importe existió y se anuló. Mostrarlo en 0 escondería
                de cuánto era el comprobante que se dio de baja. */}
            <span className="gtotal tachado">{plata(a.total)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ════════════════════════ Ver el detalle ════════════════════════

/** Los renglones de una compra ya cargada, en modo lectura. */
function DetalleModal({
  gasto,
  onCerrar,
}: {
  gasto: GastoDTO;
  onCerrar: () => void;
}) {
  const [lineas, setLineas] = useState<LineaDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    getDetalleAction(gasto.id).then((res) => {
      if (!vivo) return;
      if (res.ok) setLineas(res.data);
      else setError(res.error);
    });
    return () => {
      vivo = false;
    };
  }, [gasto.id]);

  const suma =
    lineas === null
      ? null
      : lineas.reduce(
          (acc, l) => acc.plus(new Decimal(l.qty).times(l.unit_cost)),
          new Decimal(0)
        );

  return (
    <div className="pmov open" onClick={onCerrar}>
      <div
        className="pmod"
        role="dialog"
        aria-modal="true"
        aria-label="Detalle de la compra"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-head">
          <div>
            <div className="pm-title">Detalle de la compra</div>
            <div className="pm-sub">
            {gasto.payee_name ?? 'Sin proveedor'}
            {gasto.comprobante_numero !== null
              ? ` · ${gasto.comprobante_tipo ?? 'Comp.'} ${gasto.comprobante_numero}`
              : ''}{' '}
            · {fechaCorta(gasto.fecha)}
            </div>
          </div>
          <button type="button" className="pm-x" onClick={onCerrar} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error !== null ? <div className="gerr">{error}</div> : null}

        {lineas === null && error === null ? (
          <div className="pm-note">Buscando los renglones…</div>
        ) : null}

        {lineas !== null ? (
          <>
            <div className="dtab">
              <div className="dth">
                <span style={{ width: 26 }}>#</span>
                <span style={{ flex: 1 }}>Producto</span>
                <span style={{ width: 70, textAlign: 'right' }}>Cant.</span>
                <span style={{ width: 96, textAlign: 'right' }}>Costo u.</span>
                <span style={{ width: 104, textAlign: 'right' }}>Subtotal</span>
              </div>
              {lineas.map((l) => (
                <div key={l.linea} className="dtr">
                  <span style={{ width: 26 }} className="dnum">
                    {l.linea}
                  </span>
                  {/* Nombre al momento de la compra: si después lo renombraron,
                      el comprobante viejo sigue diciendo lo que decía. */}
                  <span style={{ flex: 1 }}>{l.product_name}</span>
                  <span style={{ width: 70, textAlign: 'right' }} className="dnum">
                    {new Decimal(l.qty).toFixed(2)}
                  </span>
                  <span style={{ width: 96, textAlign: 'right' }} className="dnum">
                    {plata(l.unit_cost)}
                  </span>
                  <span style={{ width: 104, textAlign: 'right' }} className="dnum">
                    {plata(new Decimal(l.qty).times(l.unit_cost).toFixed(4))}
                  </span>
                </div>
              ))}
            </div>

            <div className="dsum">
              <span>Suma del detalle</span>
              <b className="dnum">{plata(suma!.toFixed(4))}</b>
            </div>
            {/* El costo es NETO de IVA recuperable: por eso la suma del detalle
                cierra contra el neto cuando el comprobante lo discrimina, y
                contra el total cuando no. Sin esta línea, ver "suma 10.000" al
                lado de un total de 12.100 parece un error. */}
            <div className="pm-note">
              Los costos son <b>netos de IVA</b> cuando el comprobante lo
              discrimina, porque ese IVA se recupera y no es costo de la
              mercadería. Comprobante: {plata(gasto.total)}
              {new Decimal(gasto.neto).gt(0)
                ? ` (neto ${plata(gasto.neto)} + IVA ${plata(gasto.iva)})`
                : ''}
              .
            </div>
          </>
        ) : null}

        <div className="pm-acts">
          <button type="button" className="pm-btn ghost" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════ Anular ════════════════════════

/**
 * Confirmación de anulación.
 *
 * Dice QUÉ va a pasar antes de que pase — la plata vuelve, la mercadería
 * vuelve — porque anular un gasto de mercadería mueve stock, y eso no se
 * adivina desde un botón que dice "Anular".
 */
function AnularModal({
  gasto,
  pending,
  error,
  onCancelar,
  onConfirmar,
}: {
  gasto: GastoDTO;
  pending: boolean;
  error: string | null;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const puede = motivo.trim().length >= 3 && !pending;

  return (
    <div className="pmov open" onClick={onCancelar}>
      <div
        className="pmod"
        role="dialog"
        aria-modal="true"
        aria-label="Anular gasto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-head">
          <div>
            <div className="pm-title">Anular este gasto</div>
            <div className="pm-sub">
              {gasto.payee_name ?? catLabel(gasto.categoria)} ·{' '}
              {fechaCorta(gasto.fecha)} · {plata(gasto.total)}
            </div>
          </div>
          <button type="button" className="pm-x" onClick={onCancelar} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <ul className="pm-lista">
          <li>
            El gasto <b>no se borra</b>: queda registrado junto con su anulación,
            y lo vas a ver en la pestaña “Anulados”.
          </li>
          {gasto.salio_de_caja ? (
            <li>
              Se pagó en efectivo, así que <b>la plata vuelve a la caja de hoy</b>{' '}
              (no a la del día del gasto, que puede estar cerrada y arqueada).
            </li>
          ) : null}
          {gasto.renglones > 0 ? (
            <li>
              Tiene {gasto.renglones} renglón{gasto.renglones === 1 ? '' : 'es'} de
              mercadería: <b>el stock vuelve atrás</b>. Si ya vendiste parte, no se
              va a poder anular y te vamos a decir de qué producto se trata.
            </li>
          ) : null}
        </ul>

        <div className="pm-fld">
          <label htmlFor="motivoAnul">Motivo (queda registrado)</label>
          <input
            id="motivoAnul"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Lo cargué dos veces / el importe estaba mal / era de otro comercio"
            autoFocus
          />
        </div>

        {error !== null ? <div className="gerr">{error}</div> : null}

        <div className="pm-acts">
          <button type="button" className="pm-btn ghost" onClick={onCancelar}>
            Volver
          </button>
          <button
            type="button"
            className="pm-btn danger"
            disabled={!puede}
            onClick={() => onConfirmar(motivo.trim())}
          >
            {pending ? 'Anulando…' : 'Anular el gasto'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════ Detalle: el renglón en borrador ════════════════════

/**
 * Un renglón mientras se está cargando.
 *
 * Guarda `productId` porque una línea **es un lote**: sin producto no puede
 * mover stock ni valorizar nada. La maqueta de facturas recibidas tiene ahí un
 * texto libre — sirve para transcribir un papel, no para esto.
 */
interface BorradorLinea {
  key: string;
  productId: string;
  nombre: string;
  qty: string;
  costo: string;
}

/**
 * Buscador de productos del catálogo. Mismo gesto que el POS: se tipea, se
 * elige, se agrega el renglón.
 *
 * No permite crear productos desde acá, y es a propósito: un alta de catálogo
 * (precio de venta, alícuota, rubro, exención Ley 19.640) metida adentro de la
 * carga de una factura son dos decisiones distintas en el mismo formulario.
 */
/** Con qué se le puede pagar a un proveedor. Sólo el efectivo toca la caja. */
const MEDIOS_PAGO_PROV: Array<{ valor: MedioPagoProveedor; label: string }> = [
  { valor: 'efectivo', label: 'Efectivo' },
  { valor: 'transferencia', label: 'Transferencia' },
  { valor: 'debito', label: 'Débito' },
  { valor: 'credito', label: 'Crédito' },
];

/**
 * Pagarle a un proveedor. Espejo del "Cobrar cuenta" de /clientes.
 *
 * No pide fecha: el pago es HOY, y la pone el servidor con el calendario del
 * comercio. Tampoco pide a qué factura imputarlo, porque el libro no las imputa
 * — se le paga al proveedor (ADR-0028).
 */
function PagoProveedorModal({
  acreedor,
  hayCajaAbierta,
  pending,
  onCancelar,
  onPagar,
}: {
  acreedor: AcreedorDTO;
  hayCajaAbierta: boolean;
  pending: boolean;
  onCancelar: () => void;
  onPagar: (monto: string, medio: MedioPagoProveedor) => void;
}) {
  // Arranca con la deuda ENTERA, que es el caso común y además el que no puede
  // pasarse de largo: tipear el importe a mano es la vía natural a un saldo
  // negativo, y un saldo negativo bloquea anular cualquier cargo de ese
  // proveedor (ADR-0028 §6).
  const [monto, setMonto] = useState(new Decimal(acreedor.saldo).toFixed(2));
  const [medio, setMedio] = useState<MedioPagoProveedor>(
    hayCajaAbierta ? 'efectivo' : 'transferencia'
  );

  const deuda = new Decimal(acreedor.saldo);
  const ingresado = (() => {
    try {
      return new Decimal(monto.replace(',', '.') === '' ? '0' : monto.replace(',', '.'));
    } catch {
      return null;
    }
  })();

  const montoInvalido =
    ingresado === null || !ingresado.isFinite() || ingresado.lte(0);
  const pagaDeMas = ingresado !== null && !montoInvalido && ingresado.gt(deuda);
  const restante =
    ingresado !== null && !montoInvalido ? deuda.minus(ingresado) : deuda;

  const efectivoBloqueado = medio === 'efectivo' && !hayCajaAbierta;
  const puedePagar = !montoInvalido && !efectivoBloqueado && !pending;

  return (
    <div className="pmov open" onClick={onCancelar}>
      <div
        className="pmod"
        role="dialog"
        aria-modal="true"
        aria-label={`Pagarle a ${acreedor.nombre}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-head">
          <div>
            <div className="pm-title">Pagarle al proveedor</div>
            <div className="pm-sub">
              {acreedor.nombre} · se le debe <b>{plata(acreedor.saldo)}</b>
            </div>
          </div>
          <button type="button" className="pm-x" onClick={onCancelar} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="pm-fld">
          <label htmlFor="ppMonto">Cuánto se le paga</label>
          <input
            id="ppMonto"
            className="big"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            inputMode="decimal"
            autoFocus
            aria-describedby="ppResto"
          />
          <div
            id="ppResto"
            className={`pm-note${pagaDeMas ? ' err' : ''}`}
            style={{ margin: '6px 0 0' }}
          >
            {montoInvalido ? (
              'Poné un importe mayor a cero.'
            ) : pagaDeMas ? (
              <>
                Son <b>{plata(ingresado!.minus(deuda).toFixed(2))}</b> de más de
                lo que se le debe. Queda como saldo a favor tuyo —{' '}
                <b>y mientras esté así no vas a poder anular sus facturas</b>.
              </>
            ) : restante.lte(0) ? (
              'Con esto queda saldado.'
            ) : (
              <>
                Le va a quedar debiendo <b>{plata(restante.toFixed(2))}</b>.
              </>
            )}
          </div>
        </div>

        <div className="pm-fld">
          <label htmlFor="ppMedio">Con qué se le paga</label>
          <select
            id="ppMedio"
            value={medio}
            onChange={(e) => setMedio(e.target.value as MedioPagoProveedor)}
          >
            {MEDIOS_PAGO_PROV.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {medio === 'efectivo' ? (
          hayCajaAbierta ? (
            <p className="pm-note">
              Sale de la <b>caja del día</b> y se descuenta del arqueo.
            </p>
          ) : (
            <p className="pm-note err">
              <b>No hay una caja abierta.</b> Pagar en efectivo saca plata del
              cajón del día. Abrila desde Caja, o pagá por otro medio.
            </p>
          )
        ) : (
          <p className="pm-note">No toca la caja: no es plata del cajón.</p>
        )}

        <div className="pm-acts">
          <button type="button" className="pm-btn ghost" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className="pm-btn primary"
            disabled={!puedePagar}
            onClick={() => onPagar(ingresado!.toFixed(2), medio)}
          >
            {pending ? 'Registrando…' : 'Registrar pago'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BuscadorProducto({
  onElegir,
}: {
  onElegir: (p: ProductoBuscadoDTO) => void;
}) {
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState<ProductoBuscadoDTO[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const q = texto.trim();
    let vivo = true;
    // Todo el estado se toca DENTRO del timer, nunca sincrónicamente en el
    // efecto: hacerlo sincrónico encadena renders (`react-hooks`, y el lint lo
    // marca como error). Y el timer es lo que evita una consulta por tecla.
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
        placeholder="Buscar un producto por nombre, código o SKU…"
        aria-label="Buscar un producto para agregar al detalle"
      />
      {texto.trim() !== '' ? (
        <div className="det-op">
          {buscando && opciones.length === 0 ? (
            <div className="det-vacio">Buscando…</div>
          ) : opciones.length === 0 ? (
            <div className="det-vacio">
              No hay productos que coincidan. Si es nuevo, cargalo primero en
              Productos.
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
                  {p.cost !== null
                    ? `última compra ${plata(p.cost)}`
                    : 'sin costo cargado'}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
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
  const [lineas, setLineas] = useState<BorradorLinea[]>([]);

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
  // Un gasto a cuenta corriente NO es plata que salió: es una deuda. Cambia las
  // etiquetas del formulario y exige proveedor de la lista (ADR-0028 §3).
  const esCtaCte = medio === 'cuenta_corriente';
  const faltaProveedor = esCtaCte && proveedorId === '';

  // ── El detalle ──
  const esMercaderia = categoria === 'mercaderia';

  const cambiarLinea = (i: number, cambio: Partial<BorradorLinea>) =>
    setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, ...cambio } : l)));

  const subtotalDe = (l: BorradorLinea): Decimal | null => {
    const q = dec(l.qty);
    const c = dec(l.costo);
    if (q === null || c === null || q.lte(0) || c.lt(0)) return null;
    return q.times(c);
  };

  const lineasIncompletas =
    esMercaderia && lineas.some((l) => subtotalDe(l) === null);

  const sumaDetalle = lineas.reduce(
    (acc, l) => acc.plus(subtotalDe(l) ?? 0),
    new Decimal(0)
  );

  // Contra el NETO si el comprobante discrimina IVA, contra el TOTAL si no: el
  // IVA discriminado se recupera y no es costo de la mercadería. Es la misma
  // regla que aplica el service — acá se muestra ANTES de mandar, para que un
  // error de tipeo se vea en el momento y no vuelva como error del servidor.
  const baseDetalle = discrimina ? dNeto : dTotal;

  // El margen de $0,50 es `TOLERANCE_RECONCILIATION` de `lib/money/decimal.ts`.
  // Se repite acá en vez de importarlo porque ese módulo arrastra `env` al
  // bundle del navegador y tira la página (ya pasó con `formatARS`). Si cambia
  // allá, cambia acá: son dos lugares y esta nota es el hilo entre los dos.
  const TOLERANCIA = new Decimal('0.50');
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
      // Sólo viajan si hay: `items: []` y sin `items` son lo mismo para el
      // service, pero mandar un array vacío en una categoría que no es
      // mercadería lo haría rechazar el gasto entero.
      ...(esMercaderia && lineas.length > 0
        ? {
            items: lineas.map((l) => ({
              product_id: l.productId,
              qty: new Decimal(l.qty.replace(',', '.')).toFixed(4),
              unit_cost: new Decimal(l.costo.replace(',', '.')).toFixed(4),
            })),
          }
        : {}),
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

        {/* Con `cuenta_corriente` esto deja de ser "a quién se le pagó": no se
            pagó nada todavía. Y el proveedor pasa a ser OBLIGATORIO y de la
            lista — una deuda sin acreedor identificado no se puede ni pagar ni
            informar, y dos tipeos del mismo nombre serían dos acreedores
            distintos en el listado que va al estudio. El servidor lo rechaza
            igual (`cta_cte_needs_tercero`); acá se evita que el comerciante
            llegue a ese error apretando Guardar. */}
        <div className="pm-fld">
          <label htmlFor="gProv">{esCtaCte ? 'A quién se le debe' : 'A quién se le pagó'}</label>
          <select
            id="gProv"
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
          >
            <option value="">
              {esCtaCte ? 'Elegí el proveedor…' : 'Escribir el nombre…'}
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
              style={{ marginTop: 8 }}
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
              placeholder="Nombre del proveedor (opcional)"
              aria-label="Nombre del proveedor"
            />
          ) : null}
          {proveedorId === '' && esCtaCte ? (
            <p className="pm-note err" style={{ marginTop: 8 }}>
              Una deuda necesita saber a quién. Si el proveedor no está en la
              lista, cargalo primero desde Clientes y proveedores.
            </p>
          ) : null}
        </div>

        <div className="pm-fld">
          <label htmlFor="gTotal">{esCtaCte ? 'Cuánto es' : 'Cuánto se pagó'}</label>
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

        {/* ── El detalle: sólo mercadería ──────────────────────────────────
            Una línea es un LOTE: entra al stock y deja registrado a qué costo.
            En las otras categorías no hay nada que contar, y el service las
            rechaza — mostrar la sección igual sería ofrecer algo que no se
            puede hacer. */}
        {esMercaderia ? (
          <div className="det">
            <div className="det-h">
              <span className="det-t">Detalle de la mercadería</span>
              <span className="det-s">
                Opcional. Si lo cargás, entra al stock y queda el costo de cada
                producto — que es lo que el inventario al cierre necesita.
              </span>
            </div>

            {lineas.length > 0 ? (
              <div className="det-tab">
                <div className="det-th">
                  <span style={{ flex: 1 }}>Producto</span>
                  <span style={{ width: 74, textAlign: 'right' }}>Cant.</span>
                  <span style={{ width: 104, textAlign: 'right' }}>Costo u. neto</span>
                  <span style={{ width: 100, textAlign: 'right' }}>Subtotal</span>
                  <span style={{ width: 28 }} />
                </div>
                {lineas.map((l, i) => (
                  <div key={l.key} className="det-tr">
                    <span style={{ flex: 1 }} className="det-nom">
                      {l.nombre}
                    </span>
                    <input
                      className="det-in"
                      style={{ width: 74 }}
                      inputMode="decimal"
                      value={l.qty}
                      aria-label={`Cantidad de ${l.nombre}`}
                      onChange={(e) => cambiarLinea(i, { qty: e.target.value })}
                    />
                    <input
                      className="det-in"
                      style={{ width: 104 }}
                      inputMode="decimal"
                      value={l.costo}
                      aria-label={`Costo unitario de ${l.nombre}`}
                      onChange={(e) => cambiarLinea(i, { costo: e.target.value })}
                    />
                    <span style={{ width: 100, textAlign: 'right' }} className="det-sub">
                      {subtotalDe(l) === null ? '—' : plata(subtotalDe(l)!.toFixed(4))}
                    </span>
                    <button
                      type="button"
                      className="det-x"
                      aria-label={`Sacar ${l.nombre}`}
                      onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <BuscadorProducto
              onElegir={(p) => {
                setLineas((prev) => [
                  ...prev,
                  {
                    key: `${p.id}-${prev.length}-${Date.now()}`,
                    productId: p.id,
                    nombre: p.name,
                    qty: '',
                    // El costo de la última compra viene cargado: el proveedor
                    // casi siempre repite precio, y si aumentó se ve contra qué.
                    costo: p.cost !== null ? new Decimal(p.cost).toFixed(2) : '',
                  },
                ]);
              }}
            />

            {lineas.length > 0 ? (
              <div className="det-sum">
                <span>
                  Suma del detalle{' '}
                  <i>{discrimina ? '(contra el neto)' : '(contra el total)'}</i>
                </span>
                <b className="det-nom">{plata(sumaDetalle.toFixed(4))}</b>
              </div>
            ) : null}

            {/* El costo es NETO de IVA recuperable: el IVA discriminado se
                recupera, así que no es costo de la mercadería. De acá sale
                `products.cost` y de ahí el margen de cada venta. */}
            {detalleNoCierra ? (
              <p className="pm-warn red">
                El detalle suma <b>{plata(sumaDetalle.toFixed(2))}</b> y el
                comprobante dice{' '}
                <b>{plata((baseDetalle ?? new Decimal(0)).toFixed(2))}</b>
                {discrimina ? ' (neto, sin IVA)' : ''}. Tienen que coincidir.
              </p>
            ) : lineas.length > 0 && discrimina ? (
              <p className="pm-note">
                Los costos van <b>netos</b>: el IVA discriminado se recupera, así
                que no es costo de la mercadería.
              </p>
            ) : null}

            {lineasIncompletas ? (
              <p className="pm-warn red">
                Hay renglones sin cantidad o sin costo. Completalos o sacalos.
              </p>
            ) : null}
          </div>
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
        ) : esCtaCte ? (
          <p className="pm-warn amber">
            <b>No sale plata ahora.</b> Queda como <b>deuda con el proveedor</b> y
            aparece en Acreedores. Va a contar como gasto del mes{' '}
            <b>en que se lo pagues</b>, no de este.
          </p>
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
