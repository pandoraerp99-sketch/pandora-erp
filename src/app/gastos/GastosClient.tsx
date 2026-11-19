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
import {
  comportamientoEfectivo,
  seClasifica,
  type Comportamiento,
} from '@/lib/domain/comportamiento-costo';
import { ClasificarModal, FijosVariablesCard, PastillaFV } from './FijosVariables';
import { CargarGasto } from './CargarGasto';
import { ResumenCarga, type GastoRecienteDTO, type MesCargaDTO } from './ResumenCarga';
import type {
  MemoriaProveedor,
  MesFijosVariables,
} from '@/lib/services/expenses/cost-behaviour.service';
import { AppShell } from '@/components/shell/AppShell';
import {
  catClase,
  catLabel,
  fechaCorta,
  medioLabel,
  plata,
} from './gastosFormato';
import { GASTOS_CSS } from './gastosCss';
import { ComprobantesModal } from './ComprobantesModal';
import { ContratosModal } from './ContratosModal';
import {
  anularGastoAction,
  exportarAcreedoresCsvAction,
  exportarGastosCsvAction,
  exportarProveedoresCsvAction,
  getDetalleAction,
  pagarProveedorAction,
  clasificarGastoAction,
  type LineaDTO,
} from './actions';

/** Las dos vistas de /gastos: cargar un gasto (la que abre) y el libro. */
export type Vista = 'cargar' | 'libro';

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
  /** Fijo / variable / mixto elegido a mano (0045). `null` = vale el de la categoría. */
  comportamiento: string | null;
  /**
   * Comprobantes cargados. Cuenta FICHAS, no archivos verificados en el
   * bucket: si el archivo no está, lo dice el modal al abrirlo.
   */
  adjuntos: number;
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
  /**
   * Ficha del proveedor, o `''` si no tiene. Sin ficha no hay dónde colgar el
   * contrato, así que el clip no se ofrece — un botón que al apretarlo no
   * puede hacer nada es peor que no tenerlo.
   */
  tercero_id: string;
  cuit: string;
  /** CUIT distintos agrupados. > 1 = hay algo para revisar antes de mandarlo. */
  cuits: string;
  /**
   * `'true'` si el mismo nombre aparece en otra fila con otro CUIT. Es el
   * mismo "revisar" de `cuits > 1`, para el caso en que los dos CUIT quedaron
   * en fichas distintas y por eso ya no caen en un solo grupo.
   */
  nombre_repetido: string;
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
  /** Últimos 6 meses: fijo / variable / mixto / sin clasificar (0045). */
  fijosVariables: MesFijosVariables[];
  porCategoria: TotalCategoriaDTO[];
  porProveedor: ProveedorPeriodoDTO[];
  /** Cuántos contratos tiene cada proveedor con ficha (ítem 12, slice 3). */
  contratosPorProveedor: Record<string, number>;
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
  /** Con qué vista abre (viene de `?vista=`). */
  vista: Vista;
  /** Efectivo esperado en la caja abierta, para el impacto del alta. */
  cajaEsperado: string | null;
  /** El mes en curso por categoría, para "Gastos del mes". */
  mes: MesCargaDTO;
  recientes: GastoRecienteDTO[];
  /** Lo que se le debe HOY a cada proveedor (no al cierre del período). */
  deudaHoy: Record<string, string>;
  /** Categoría y tipo de la última vez con cada proveedor. */
  memoria: Record<string, MemoriaProveedor>;
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

type Filtro = 'todos' | 'manda' | 'arca' | 'anulados';

export function GastosClient({
  gastos,
  anulados,
  resumen,
  fijosVariables,
  porCategoria,
  porProveedor,
  contratosPorProveedor,
  acreedores,
  fechaAlCierre,
  proveedores,
  grano,
  periodoEtiqueta,
  hayCajaAbierta,
  vista,
  cajaEsperado,
  mes,
  recientes,
  deudaHoy,
  memoria,
  cashierName,
  salePointLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // La vista se cambia en el cliente (las dos tienen sus datos ya cargados) y
  // se anota en la URL sin navegar, para que recargar o compartir el link
  // abra la misma.
  const [vistaActual, setVistaActual] = useState<Vista>(vista);
  const cambiarVista = (v: Vista) => {
    setVistaActual(v);
    setError(null);
    window.history.replaceState(null, '', `/gastos?periodo=${grano}&vista=${v}`);
  };
  const [filtro, setFiltro] = useState<Filtro>('todos');
  /** Gasto cuyo detalle se está mirando. */
  const [viendo, setViendo] = useState<GastoDTO | null>(null);
  /** Gasto que se está por anular. */
  const [anulando, setAnulando] = useState<GastoDTO | null>(null);
  // Gasto al que se le está cambiando fijo / variable / mixto (0045).
  const [clasificando, setClasificando] = useState<GastoDTO | null>(null);
  const clasificar = (c: Comportamiento) => {
    if (clasificando === null) return;
    const id = clasificando.id;
    setError(null);
    startTransition(async () => {
      const res = await clasificarGastoAction(id, c);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setClasificando(null);
      router.refresh();
    });
  };
  /** Proveedor al que se le está por pagar. */
  const [pagando, setPagando] = useState<AcreedorDTO | null>(null);
  /** Gasto cuyos comprobantes se están mirando. */
  const [comprobantesDe, setComprobantesDe] = useState<GastoDTO | null>(null);
  /**
   * Cuántos comprobantes tiene cada gasto. Arranca con lo que trajo el server
   * y se corrige sola cuando el modal sube o quita uno, para que el clip de la
   * fila no quede diciendo un número viejo hasta el próximo refresh.
   */
  const [adjuntos, setAdjuntos] = useState<Record<string, number>>(() =>
    Object.fromEntries(gastos.map((g) => [g.id, g.adjuntos]))
  );
  /** Proveedor cuyos contratos se están mirando. */
  const [contratosDe, setContratosDe] = useState<{ id: string; nombre: string } | null>(
    null
  );
  /** Contratos por proveedor. Misma mecánica que `adjuntos`. */
  const [contratos, setContratos] = useState<Record<string, number>>(
    () => contratosPorProveedor
  );

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
    router.push(`/gastos?periodo=${g}&vista=libro`);
  };

  const visibles = useMemo(() => {
    if (filtro === 'manda') return gastos.filter((g) => !g.en_iva_compras);
    if (filtro === 'arca') return gastos.filter((g) => g.en_iva_compras);
    return gastos;
  }, [gastos, filtro]);

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
              {salePointLabel} ·{' '}
              {vistaActual === 'cargar' ? 'cargar un gasto' : periodoEtiqueta}
            </div>
          </div>
        </div>
        <div className="bar-actions">
          {vistaActual === 'libro' ? (
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
          ) : null}
          <div className="seg glass ptabs" role="tablist" aria-label="Vista de gastos">
            <button
              type="button"
              role="tab"
              aria-selected={vistaActual === 'cargar'}
              className={vistaActual === 'cargar' ? 'on' : undefined}
              onClick={() => cambiarVista('cargar')}
            >
              Cargar gasto
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={vistaActual === 'libro'}
              className={vistaActual === 'libro' ? 'on' : undefined}
              onClick={() => cambiarVista('libro')}
            >
              Libro de gastos
            </button>
          </div>
        </div>
      </div>

      {error !== null ? (
        <div className="card glass" style={{ padding: '13px 18px', marginBottom: 16 }}>
          <div className="g-error">{error}</div>
        </div>
      ) : null}

      {vistaActual === 'cargar' ? (
        <div className="cg-grid">
          <CargarGasto
            proveedores={proveedores}
            cajaEsperado={cajaEsperado}
            deudaHoy={deudaHoy}
            memoria={memoria}
            onVerLibro={() => cambiarVista('libro')}
          />
          <ResumenCarga mes={mes} recientes={recientes} />
        </div>
      ) : (
      <>
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
                        {seClasifica(g.categoria) ? (
                          <>
                            {' · '}
                            <PastillaFV
                              valor={comportamientoEfectivo(g.categoria, g.comportamiento)}
                              onClick={() => {
                                setError(null);
                                setClasificando(g);
                              }}
                            />
                          </>
                        ) : null}
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
                      {/* El clip va en TODAS las filas, no sólo en las que
                          tienen renglones: el ítem 12 pide justamente los
                          gastos sin renglones (alquiler, seguros, tasas). */}
                      <button
                        type="button"
                        className={
                          (adjuntos[g.id] ?? 0) > 0 ? 'gclip con' : 'gclip'
                        }
                        onClick={() => {
                          setViendo(null);
                          setComprobantesDe(g);
                        }}
                        title={
                          (adjuntos[g.id] ?? 0) > 0
                            ? `${adjuntos[g.id]} comprobante(s) adjunto(s)`
                            : 'Adjuntar el comprobante'
                        }
                        aria-label={
                          (adjuntos[g.id] ?? 0) > 0
                            ? `Comprobantes del gasto (${adjuntos[g.id]})`
                            : 'Adjuntar comprobante a este gasto'
                        }
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                        {(adjuntos[g.id] ?? 0) > 0 ? <b>{adjuntos[g.id]}</b> : null}
                      </button>
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
          <FijosVariablesCard meses={fijosVariables} />

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
                      ) : p.nombre_repetido === 'true' ? (
                        /* El mismo nombre aparece en otra fila con otro CUIT:
                           casi siempre un tipeo. Antes esto caía en el caso de
                           arriba porque los dos gastos formaban UN grupo; desde
                           que cada CUIT arma su propia ficha son dos filas, y
                           sin este aviso el "revisar" se perdía. */
                        <span className="gprov-ojo">
                          {p.cuit} · mismo nombre con otro CUIT, revisar
                        </span>
                      ) : (
                        p.cuit
                      )}
                    </div>
                  </div>
                  {/* El contrato cuelga del PROVEEDOR: uno solo respalda los
                      doce pagos del año (ítem 12). Sólo aparece si ese
                      proveedor tiene ficha — un gasto cargado sin CUIT no la
                      tiene, y sin ficha no hay de dónde colgarlo. */}
                  {p.tercero_id !== '' ? (
                    <button
                      type="button"
                      className={
                        (contratos[p.tercero_id] ?? 0) > 0 ? 'gclip con' : 'gclip'
                      }
                      onClick={() =>
                        setContratosDe({ id: p.tercero_id, nombre: p.nombre })
                      }
                      title={
                        (contratos[p.tercero_id] ?? 0) > 0
                          ? `${contratos[p.tercero_id]} contrato(s)`
                          : 'Adjuntar el contrato'
                      }
                      aria-label={`Contratos de ${p.nombre}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                      {(contratos[p.tercero_id] ?? 0) > 0 ? (
                        <b>{contratos[p.tercero_id]}</b>
                      ) : null}
                    </button>
                  ) : null}
                  <span className="gcatn">{p.comprobantes}</span>
                  <span className="gcatv">{plata(p.total)}</span>
                </div>
              ))}
              {/* 🔴 Decía "es lo que se le PAGÓ a cada uno" y que lo adeudado
                  estaba "abajo, en Acreedores". Las dos mitades eran falsas y
                  `getProveedoresDelPeriodo` no cambió: suma `total` sin mirar
                  el pago, o sea DEVENGADO.

                  Es la misma frase que se corrigió en el CSV de proveedores el
                  2026-09-19 — y quedó viva en la pantalla. Acá es peor: las dos
                  tarjetas están una al lado de la otra, así que el que lee
                  "pagado acá / debido abajo" suma los dos números y cuenta dos
                  veces lo que sigue impago, que aparece en LAS DOS. Lo que las
                  separa no es qué proveedor entra sino qué se pregunta: acá,
                  cuánto se le compró en el período; abajo, cuánto se le debe a
                  una fecha. */}
              <p className="label-sm" style={{ marginTop: 10, lineHeight: 1.5 }}>
                Es lo que se le <b>compró</b> a cada uno en el período, pagado o
                no. Lo que siga impago aparece <b>también</b> abajo en
                Acreedores: son dos preguntas distintas y <b>no se suman</b>.
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
      )}
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
      topbarLeft={vistaActual === 'libro' ? topbarIzq : undefined}
    >
      {contenido}

      {viendo !== null ? (
        <DetalleModal gasto={viendo} onCerrar={() => setViendo(null)} />
      ) : null}

      {contratosDe !== null ? (
        <ContratosModal
          terceroId={contratosDe.id}
          titulo={contratosDe.nombre}
          onCerrar={() => setContratosDe(null)}
          onCambio={(cantidad) =>
            setContratos((prev) => ({ ...prev, [contratosDe.id]: cantidad }))
          }
        />
      ) : null}

      {comprobantesDe !== null ? (
        <ComprobantesModal
          expenseId={comprobantesDe.id}
          titulo={`${comprobantesDe.payee_name ?? 'Sin proveedor'} · ${fechaCorta(
            comprobantesDe.fecha
          )} · ${plata(comprobantesDe.total)}`}
          onCerrar={() => setComprobantesDe(null)}
          onCambio={(cantidad) =>
            setAdjuntos((prev) => ({ ...prev, [comprobantesDe.id]: cantidad }))
          }
        />
      ) : null}

      {clasificando !== null ? (
        <ClasificarModal
          gasto={clasificando}
          pending={pending}
          error={error}
          onCancelar={() => {
            setClasificando(null);
            setError(null);
          }}
          onElegir={clasificar}
        />
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
