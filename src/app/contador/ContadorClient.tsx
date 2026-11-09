'use client';

/**
 * Panel de la contadora. Maqueta: `pos-preview/contador-v2.html`.
 *
 * ── COMO SE TRATA LO QUE NO SE PUEDE CALCULAR ─────────────────────────────
 * La maqueta tiene 14 secciones; varias necesitan datos que todavía no
 * existen (compras, plan de cuentas, extractos bancarios, sueldos). La regla
 * acá es: **la sección se dibuja con su forma, y la línea que falta dice que
 * falta** — no se pone un cero.
 *
 * Un cero se lee como "no hubo movimiento". A un contador eso le dice algo
 * muy distinto de "todavía no lo calculamos": el primero lo archiva, el
 * segundo lo hace preguntar. Por eso "IVA crédito" aparece como *sin datos*
 * adentro de la Posición de IVA, y no como $0.
 *
 * Lo que no tiene ni la forma armada (asientos, conciliación, sueldos) va
 * listado al final, con el motivo de cada uno.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { AppShell } from '@/components/shell/AppShell';
import { CONTADOR_CSS } from './contadorCss';
import {
  cambiarEmpresaAction,
  exportarCajaCsvAction,
  exportarDeudoresCsvAction,
  exportarAcreedoresCsvAction,
  exportarInventarioCsvAction,
  exportarVentasCsvAction,
  listarComprobantesDelPeriodoAction,
  bajarComprobanteAction,
} from './actions';

export type Grano = 'mes' | 'trimestre' | 'anio' | 'ejercicio';

export interface ResumenDTO {
  periodo: { etiqueta: string; desde: string };
  ventas: {
    cantidad: number;
    total: string;
    neto: string;
    iva: string;
    exento: string;
  };
  medios: Array<{ medio: string; total: string; cantidad: number }>;
  cuentasCorrientes: { porCobrar: string; deudores: number };
  caja: { cierres: number; conDescuadre: number; descuadreTotal: string };
  gastos: { total: string; cantidad: number; credito: string; comprobantes: number };
}

interface Props {
  empresas: Array<{ id: string; name: string }>;
  empresaActivaId: string;
  empresaActivaNombre: string;
  esContador: boolean;
  grano: Grano;
  resumen: ResumenDTO;
  /**
   * La fecha de la FOTO: la misma para caja, deudores e inventario, porque son
   * tres columnas del mismo balance. Viaja como prop propia y no se lee de
   * `caja.fecha`: que hoy coincidan es una decisión de `page.tsx` que desde
   * acá no se ve, y el día que alguna tarjeta sea condicional se rompería en
   * silencio.
   */
  fechaCierre: string;
  caja: CajaDTO;
  /** Ítem 5: razón social, documento e importe — al cierre, no a hoy. */
  deudores: Array<{
    nombre: string;
    doc_tipo: string;
    doc_numero: string;
    saldo: string;
  }>;
  /**
   * Ítem 9: lo que se le DEBE a cada proveedor al cierre (ADR-0028).
   *
   * Incluye proveedores dados de baja a propósito: a uno desactivado se le
   * sigue debiendo, y el balance lo tiene que listar igual.
   */
  acreedores: Array<{
    tercero_id: string;
    nombre: string;
    doc: string;
    saldo: string;
  }>;
  inventario: InventarioDTO;
  usuario: string;
}

/**
 * Ítem 1 del pedido: saldo de caja a la fecha de cierre.
 *
 * Se declara acá en vez de importar el tipo del dominio para no arrastrar ese
 * módulo (y `decimal.js`) al bundle del cliente. Es la misma forma, a mano.
 *
 * `total` es `null` cuando no hay ningún arqueo hasta esa fecha — y ahí NO se
 * muestra $0: un cero se lee como "la caja estaba vacía".
 */
export interface CajaDTO {
  fecha: string;
  estado: 'contado' | 'anterior' | 'sin_datos';
  total: string | null;
  puntos: Array<{
    punto: number;
    fecha: string;
    contado: string;
    descuadre: string;
  }>;
  abiertas: Array<{ punto: number; desde: string; cerroDespues: string | null }>;
}

/**
 * Ítem 8 del pedido de la contadora.
 *
 * Es una FOTO a una fecha, no un flujo como el resto de la pantalla: por eso
 * trae su propia `fecha` y el encabezado la muestra. Y trae el `metodo`, porque
 * un inventario valorizado sin decir con qué criterio se valorizó no se puede
 * auditar — y ese criterio lo elige el estudio, no nosotros.
 */
export interface InventarioDTO {
  fecha: string;
  metodo: string;
  total: string;
  con_compra_total: string;
  sin_compra_total: string;
  sin_valorizar_qty: string;
  sin_valorizar_productos: number;
  sin_tracking: number;
  con_unidades_sin_compra: number;
  productos: number;
  filas: Array<{
    name: string;
    cantidad: string;
    con_compra_qty: string;
    sin_compra_qty: string;
    total: string;
    sin_costo: boolean;
    anomalia: boolean;
    ultima_compra: string | null;
  }>;
}

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const plata = (v: string) => PESOS.format(Number(v));

/**
 * 'AAAA-MM-DD' → '31 de julio de 2026'.
 *
 * Sin `new Date(iso)`: parsear una fecha suelta la interpreta como UTC y la
 * corre un día para atrás en cualquier huso al oeste, que es el nuestro. Un
 * inventario "al 30 de julio" cuando dice 31 es un error que nadie nota.
 */
const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${Number(d)} de ${MESES_LARGOS[Number(m) - 1] ?? ''} de ${a}`;
}

/** 'AAAA-MM-DD' → '16/09/2026'. La contadora lee fechas argentinas. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Cantidades: sin decimales cuando son enteras, que es el caso normal. */
function enteroCorto(v: string): string {
  const n = new Decimal(v);
  return n.decimalPlaces() === 0 ? n.toFixed(0) : n.toFixed(2).replace('.', ',');
}

/** Las cifras de la banda superior, con los valores de la maqueta. */
const CIFRA: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginTop: 4,
};

const MEDIO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  tarjeta: 'Tarjeta',
  mp_qr: 'MercadoPago QR',
  cuenta_corriente: 'Cuenta corriente',
  mixto: 'Mixto',
};

/**
 * "Ejercicio" (el último CERRADO) se agregó el 2026-09-09: es el recorte con el
 * que la contadora efectivamente arma el balance, y no tiene por qué coincidir
 * con el año calendario — el de ROMERO & RUIZ SAS va del 01/08 al 31/07. Sale
 * de `companies.fiscal_year_end_month` (migration 0027).
 */
const GRANOS: Array<{ valor: Grano; label: string }> = [
  { valor: 'mes', label: 'Mes' },
  { valor: 'trimestre', label: 'Trimestre' },
  { valor: 'anio', label: 'Año' },
  { valor: 'ejercicio', label: 'Ejercicio' },
];

/**
 * Un comprobante adjunto del período — ítem 12, slice 4.
 *
 * Se declara ACÁ y no se importa de `attachment.service`, por el mismo motivo
 * que `CajaDTO` arriba: ese módulo trae el cliente de Drizzle y `node:crypto`,
 * y no tiene por qué entrar en el grafo del cliente aunque el import sea de
 * tipo. Es la forma, repetida a mano, igual que las otras DTO de este archivo.
 */
interface ComprobanteDelPeriodo {
  attachment_id: string;
  nombre_original: string;
  expense_id: string;
  fecha: string;
  categoria: string;
  payee_name: string | null;
  total: string;
  comprobante_tipo: string | null;
  comprobante_numero: string | null;
}

/** Iniciales para el avatar de la fila de deudor, como la maqueta. */
function iniciales(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return '?';
  if (p.length === 1) return p[0]!.slice(0, 2).toUpperCase();
  return (p[0]![0]! + p[1]![0]!).toUpperCase();
}

/** Secciones enteras de la maqueta que todavía no tienen forma ni dato. */
const PENDIENTES: Array<{ que: string; porque: string }> = [
  { que: 'Asientos contables', porque: 'no hay plan de cuentas definido' },
  {
    que: 'Conciliación de banco y MercadoPago',
    porque: 'no se importan extractos',
  },
  { que: 'Sueldos y cargas sociales', porque: 'no hay módulo de personal' },
  {
    que: 'Retenciones y percepciones · SICORE',
    porque: 'no se registran todavía',
  },
  // "Detalle de proveedores/acreedores al cierre" estaba acá, con el motivo
  // "el gasto se registra pagado; no hay cuenta corriente de proveedores".
  // Se entregó el 2026-09-18 (migration 0039, ADR-0028) y la tarjeta está más
  // arriba en esta misma pantalla: dejarlo listado declaraba como faltante algo
  // que se ve dos secciones antes. Esta lista tiene que encogerse cuando algo
  // se construye, o se vuelve el lugar donde las cosas viejas sobreviven.
  {
    que: 'IIBB · Tierra del Fuego (AREF)',
    porque: 'falta la parametrización provincial',
  },
  {
    que: 'Recategorización Monotributo',
    porque: 'necesita 12 meses completos de ventas',
  },
  {
    que: 'Número de comprobante en el export',
    porque: 'todavía no se emite ante AFIP: falta el certificado',
  },
];

const H2_ICONO = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--purple)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

/** Una línea de la que no tenemos el dato. Dice que falta; no dice cero. */
function LineaSinDato({ k, porque }: { k: string; porque: string }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span
        className="label-sm"
        style={{ fontStyle: 'italic', textAlign: 'right', maxWidth: 230 }}
      >
        sin datos · {porque}
      </span>
    </div>
  );
}

export function ContadorClient({
  empresas,
  empresaActivaId,
  empresaActivaNombre,
  esContador,
  grano,
  resumen,
  fechaCierre,
  caja,
  deudores,
  acreedores,
  inventario,
  usuario,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // El total al cierre se suma acá y no en el servidor porque son las mismas
  // filas que se listan: un total traído aparte podría no coincidir con lo que
  // se ve, y ese es el error que nadie nota. Decimal, no `+`: es plata.
  const totalDeudores = deudores
    .reduce((acc, d) => acc.plus(new Decimal(d.saldo)), new Decimal(0))
    .toFixed(4);
  const sinDocumento = deudores.filter((d) => d.doc_numero === '').length;

  const totalAcreedores = acreedores
    .reduce((acc, a) => acc.plus(new Decimal(a.saldo)), new Decimal(0))
    .toFixed(4);
  const acreedoresSinCuit = acreedores.filter((a) => a.doc === '').length;

  // Cambiar de período es NAVEGAR: vive en la URL. Antes esto asignaba
  // `window.location.href`, que recarga la app entera (y el linter lo marcaba,
  // con razón: muta algo de afuera del componente). Con el router de Next se
  // vuelve a renderizar sólo esta página, en el servidor.
  const cambiarGrano = (g: Grano) => {
    router.push(`/contador?periodo=${g}`);
  };

  const cambiarEmpresa = (id: string) => {
    if (id === empresaActivaId) return;
    setError(null);
    startTransition(async () => {
      const res = await cambiarEmpresaAction(id);
      if (!res.ok) {
        setError(res.error ?? 'No se pudo cambiar de empresa');
        return;
      }
      // Recarga entera: cambia el tenant de TODA la pantalla, no un pedazo.
      window.location.reload();
    });
  };

  /** Baja lo que devuelva la acción. La descarga la arma el navegador. */
  const bajar = (
    pedir: () => Promise<
      { ok: true; csv: string; nombre: string } | { ok: false; error: string }
    >
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

  const exportar = () =>
    bajar(() => exportarVentasCsvAction(resumen.periodo.desde, grano));

  // ── Los comprobantes adjuntos del período (ítem 12, slice 4) ─────────────
  // `null` es "todavía no los pedí", que NO es lo mismo que "no hay": con un
  // array vacío de arranque la tarjeta diría "no hay comprobantes cargados"
  // antes de haber mirado. Es el tercer estado de siempre.
  const [comprobantes, setComprobantes] = useState<ComprobanteDelPeriodo[] | null>(
    null
  );
  /** Link visible si el navegador bloqueó la pestaña. Ver `abrirComprobante`. */
  const [linkSuelto, setLinkSuelto] = useState<{ url: string; nombre: string } | null>(
    null
  );

  const verComprobantes = () => {
    setError(null);
    setLinkSuelto(null);
    startTransition(async () => {
      const res = await listarComprobantesDelPeriodoAction(grano);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setComprobantes(res.comprobantes);
    });
  };

  async function abrirComprobante(id: string) {
    setError(null);
    setLinkSuelto(null);

    // 🔴 Sincrónica DENTRO del click, igual que en /gastos: abrirla después
    // del `await` la bloquea el navegador sin tirar ningún error, y la
    // contadora concluye que el sistema no anda. Por lo mismo esto NO va
    // adentro de `startTransition`.
    const pestania = window.open('', '_blank');

    const res = await bajarComprobanteAction(id);
    if (!res.ok) {
      pestania?.close();
      setError(res.error);
      return;
    }
    if ('falta' in res) {
      pestania?.close();
      setError(
        'Ese archivo no está guardado. La ficha quedó, el archivo no: pedíselo al comercio.'
      );
      return;
    }

    if (pestania) {
      // Se corta la referencia de vuelta antes de navegar.
      pestania.opener = null;
      pestania.location.replace(res.url);
      return;
    }
    setLinkSuelto({ url: res.url, nombre: res.nombre });
  }

  // Selector de período, en la topbar como la maqueta.
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
      <style>{CONTADOR_CSS}</style>

      <div className="bar">
        <div className="bar-id">
          <span className="bar-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              <path d="M2 13h20" />
            </svg>
          </span>
          <div>
            <div className="bar-title">Panel Contador</div>
            <div className="bar-sub">
              {empresaActivaNombre} · {resumen.periodo.etiqueta}
              <span className="per-status">● Borrador — a revisar</span>
            </div>
          </div>
        </div>
        <div className="bar-actions">
          {/* "Aprobar período" es el circuito de la Ley 20.488 (borrador → la
              matriculada aprueba). El estado de aprobación no existe como
              dominio todavía, así que va apagado con el motivo: un botón que
              no deja rastro de nada es peor que uno que falta. */}
          <button
            type="button"
            className="b approve"
            disabled
            title="Falta el circuito de aprobación: el estado del período no se guarda todavía."
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Aprobar período
          </button>
          <button
            type="button"
            className="b ghost"
            onClick={exportar}
            disabled={pending || resumen.ventas.cantidad === 0}
            title={
              resumen.ventas.cantidad === 0
                ? 'No hay ventas en el período'
                : undefined
            }
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            {pending ? 'Preparando…' : 'Exportar ventas'}
          </button>
        </div>
      </div>

      <div className="rep-body">
        {/* Selector de empresas: el diferenciador. Un login, N comercios. */}
        <div className="emp-bar">
          <span className="emp-lbl">Empresas:</span>
          {empresas.map((e) => (
            <button
              key={e.id}
              type="button"
              className={e.id === empresaActivaId ? 'emp-chip on' : 'emp-chip'}
              onClick={() => cambiarEmpresa(e.id)}
              disabled={pending}
            >
              {e.name}
            </button>
          ))}
          {/* La invitación la dispara el DUEÑO desde su comercio, no la
              contadora desde acá: es él quien decide quién ve sus números.
              Queda visible para que se entienda el modelo. */}
          <button
            type="button"
            className="emp-chip invitar"
            disabled
            title="La invitación la hace el dueño del comercio desde su cuenta. Esa pantalla todavía no está."
          >
            + Invitar empresa
          </button>
        </div>

        {error !== null ? (
          <p className="label-sm err">
            {error}
          </p>
        ) : null}

        <div
          className="card glass-strong"
          style={{
            display: 'flex',
            // EXPLICITO: shellCss pone `.card{ flex-direction:column }` (el
            // .card del POS) y poner sólo `display:flex` no lo resetea — la
            // banda quedaba apilada y centrada.
            flexDirection: 'row',
            alignItems: 'center',
            gap: 22,
            padding: '15px 22px',
            flexWrap: 'wrap',
          }}
        >
          <span className="periodo-ic">
            {H2_ICONO}
          </span>
          <div style={{ flex: '0 0 auto' }}>
            <div
              style={{
                fontSize: 14.5,
                fontWeight: 700,
                color: 'var(--ink)',
                letterSpacing: '-0.01em',
              }}
            >
              Tu período, sin cargar un dato a mano
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              Pandora lo organiza; vos revisás, aprobás y presentás.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 34, marginLeft: 'auto' }}>
            <div>
              <div className="upper-mini">Comprobantes</div>
              <div className="tnum" style={CIFRA}>
                {resumen.ventas.cantidad}
              </div>
            </div>
            <div>
              <div className="upper-mini">Cargados a mano</div>
              <div className="tnum c-green2" style={CIFRA}>
                0
              </div>
            </div>
            <div>
              <div className="upper-mini">Cierres de caja</div>
              <div className="tnum" style={CIFRA}>
                {resumen.caja.cierres}
              </div>
            </div>
            <div>
              <div className="upper-mini">Empresas</div>
              <div className="tnum" style={CIFRA}>
                {empresas.length}
              </div>
            </div>
          </div>
        </div>

        <div className="sec-h2">{H2_ICONO}Posición fiscal del período</div>
        <div className="g2">
          <section className="card glass-strong">
            <div className="card-title">
              <h3>Posición de IVA</h3>
              <span className="upper-mini">{resumen.periodo.etiqueta}</span>
            </div>
            <div className="kv">
              <span className="k">IVA Débito Fiscal (ventas)</span>
              <span className="v">{plata(resumen.ventas.iva)}</span>
            </div>
            {/* Con gastos cargados el crédito es REAL. Sin ellos NO va un $0:
                sería afirmar que no hubo compras, y lo cierto es que no se
                cargaron. */}
            {resumen.gastos.comprobantes > 0 ? (
              <div className="kv">
                <span className="k">
                  IVA Crédito Fiscal (compras)
                  <span className="label-sm">
                    {' '}
                    ·{' '}
                    {resumen.gastos.comprobantes === 1
                      ? '1 comprobante'
                      : `${resumen.gastos.comprobantes} comprobantes`}
                  </span>
                </span>
                <span className="v">−{plata(resumen.gastos.credito)}</span>
              </div>
            ) : (
              <LineaSinDato
                k="IVA Crédito Fiscal (compras)"
                porque="todavía no se cargaron gastos con factura"
              />
            )}
            <LineaSinDato
              k="Retenciones/percepciones sufridas"
              porque="no se registran todavía"
            />
            <div className="divider" />
            {resumen.gastos.comprobantes > 0 ? (
              (() => {
                // ── DOS COSAS QUE ESTABAN MAL ACA (corregido 2026-09-09) ──
                //
                // 1. La resta se hacia con `Number(a) - Number(b)`. Es plata, y
                //    CLAUDE.md §9.8 lo prohibe: el float arrastra centavos y no
                //    se nota, porque con importes redondos da bien. Va Decimal.
                //
                // 2. Decia "Saldo a pagar" SIEMPRE, incluso cuando el crédito
                //    supera al débito — y ahi no hay nada que pagar, hay saldo
                //    A FAVOR. Se veia en pantalla como "Saldo a pagar −$70.463".
                //    A un contador un signo menos ahi no lo confunde, pero a la
                //    persona del comercio le dice lo contrario de lo que pasa.
                const posicion = new Decimal(resumen.ventas.iva).minus(
                  resumen.gastos.credito
                );
                const aFavor = posicion.isNegative();
                return (
                  <div className="iva-pos">
                    <span>{aFavor ? 'Saldo a favor' : 'Saldo a pagar'}</span>
                    <span className="iva-amt tnum">
                      {plata(posicion.abs().toFixed(2))}
                    </span>
                  </div>
                );
              })()
            ) : (
              <div className="iva-pos">
                <span>Saldo a pagar</span>
                <span
                  className="label-sm aviso"
                  style={{ textAlign: 'right', maxWidth: 200 }}
                >
                  no se puede calcular sin el crédito fiscal
                </span>
              </div>
            )}
            <p className="label-sm" style={{ marginTop: 10 }}>
              Es un <b>borrador</b>: no incluye retenciones ni percepciones
              sufridas. La posición definitiva la arma la contadora.
            </p>
          </section>

          <section className="card glass">
            <div className="card-title">
              <h3>Ventas del período</h3>
              <span className="upper-mini">{resumen.periodo.etiqueta}</span>
            </div>
            <div className="kv">
              <span className="k">Neto gravado</span>
              <span className="v">{plata(resumen.ventas.neto)}</span>
            </div>
            <div className="kv">
              <span className="k">IVA débito</span>
              <span className="v">{plata(resumen.ventas.iva)}</span>
            </div>
            <div className="kv">
              <span className="k">Exento · Ley 19.640</span>
              <span className="v">{plata(resumen.ventas.exento)}</span>
            </div>
            <div className="divider" />
            <div className="iva-pos ok">
              <span>Total facturado</span>
              <span className="iva-amt tnum c-green2">
                {plata(resumen.ventas.total)}
              </span>
            </div>
            {/* La maqueta pone "Estado de Resultados" acá. Los gastos se
                registran desde 2026-09-09 y el costo de cada venta desde la
                migration 0031 — pero las ventas anteriores tienen ese costo en
                NULL y no se puede reconstruir. Un resultado de un período que
                las incluya saldría incompleto sin decirlo, así que no se arma.
                (El texto anterior decía "no se registran": quedó viejo.) */}
            <p className="label-sm" style={{ marginTop: 12 }}>
              El Estado de Resultados todavía no se arma acá. Los gastos y el
              costo de cada venta ya se guardan, pero las ventas anteriores a
              que se empezara a guardar el costo no lo tienen.
            </p>
          </section>
        </div>

        <div className="sec-h2">{H2_ICONO}Cobros y caja</div>
        <div className="g2">
          <section className="card glass">
            <div className="card-title">
              <h3>Cobros por medio de pago</h3>
              <span className="upper-mini">{resumen.periodo.etiqueta}</span>
            </div>
            {resumen.medios.length === 0 ? (
              <p className="label-sm">No hubo cobros en el período.</p>
            ) : (
              resumen.medios.map((m) => (
                <div className="kv" key={m.medio}>
                  <span className="k">
                    {MEDIO_LABEL[m.medio] ?? m.medio}
                    <span className="label-sm">
                      {' '}
                      · {m.cantidad === 1 ? '1 cobro' : `${m.cantidad} cobros`}
                    </span>
                  </span>
                  <span className="v">{plata(m.total)}</span>
                </div>
              ))
            )}
          </section>

          <section className="card glass">
            <div className="card-title">
              <h3>Cierres de caja</h3>
              <span className="upper-mini">{resumen.periodo.etiqueta}</span>
            </div>
            <div className="conc-stats">
              <div>
                <div className="cs-k">Cierres</div>
                <div className="cs-v tnum">{resumen.caja.cierres}</div>
              </div>
              <div>
                <div className="cs-k">Con descuadre</div>
                <div className="cs-v tnum">{resumen.caja.conDescuadre}</div>
              </div>
              <div>
                <div className="cs-k">Diferencia total</div>
                <div className="cs-v tnum">
                  {plata(resumen.caja.descuadreTotal)}
                </div>
              </div>
            </div>
            {resumen.caja.conDescuadre > 0 ? (
              <div className="conc-diff warn">
                {resumen.caja.conDescuadre === 1
                  ? '1 cierre con diferencia'
                  : `${resumen.caja.conDescuadre} cierres con diferencia`}{' '}
                · la suma va en valor absoluto: un faltante y un sobrante no se
                cancelan entre sí.
              </div>
            ) : (
              <p className="label-sm">
                {resumen.caja.cierres === 0
                  ? 'No hubo cierres de caja en el período.'
                  : 'Todos los cierres cerraron sin diferencia.'}
              </p>
            )}
          </section>
        </div>

        {/* Ítem 1 del pedido de la contadora. En el papel que le mandan hoy está
            escrito A MANO ("$349.000"): la caja se cuenta todos los días y el
            número nunca salía de acá. */}
        {/* El `id` es el ancla para linkear la tarjeta y para traerla a la
            vista en las capturas de verificación. */}
        <section className="card glass" id="caja-al-cierre">
          <div className="card-title">
            <h3>Saldo de caja al cierre</h3>
            {/* La FECHA, no el período: es un saldo a un día, como el
                inventario. */}
            <span className="upper-mini">al {fechaLarga(caja.fecha)}</span>
          </div>

          {caja.total === null ? (
            <p className="label-sm">
              No hay ningún cierre de caja hasta esa fecha, así que no hay un
              saldo contado. <b>No se muestra $0</b>: un cero diría que la caja
              estaba vacía, que es otra cosa.
            </p>
          ) : (
            <>
              <div className="conc-stats">
                <div>
                  <div className="cs-k">Efectivo contado</div>
                  <div className="cs-v tnum">{plata(caja.total)}</div>
                </div>
                <div>
                  <div className="cs-k">Cajas</div>
                  <div className="cs-v tnum">{caja.puntos.length}</div>
                </div>
                <div>
                  <div className="cs-k">Último arqueo</div>
                  {/* El más RECIENTE, no el de la última caja de la lista: la
                      lista va ordenada por número de punto de venta. */}
                  <div className="cs-v tnum">
                    {fechaCorta(
                      caja.puntos.reduce(
                        (max, p) => (p.fecha > max ? p.fecha : max),
                        caja.puntos[0]?.fecha ?? caja.fecha
                      )
                    )}
                  </div>
                </div>
              </div>

              {caja.estado === 'anterior' ? (
                <div className="conc-diff warn">
                  El arqueo más fresco de alguna caja es <b>anterior</b> a esa
                  fecha. Sigue siendo plata contada, pero de otro día: la fecha
                  de cada una está en la lista.
                </div>
              ) : null}

              {/* La CUENTA, no sólo el resultado: si mañana abren una segunda
                  caja, el total pasa a significar otra cosa y acá se ve. */}
              <div className="cc-list">
                {caja.puntos.map((p) => (
                  <div className="cc-row" key={p.punto}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      Caja {p.punto}
                      <span className="label-sm"> · arqueo del {fechaCorta(p.fecha)}</span>
                    </div>
                    <span className="cc-m">{plata(p.contado)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {caja.abiertas.length > 0 ? (
            <p className="label-sm alerta" style={{ marginTop: 10 }}>
              ⚠️{' '}
              {caja.abiertas.map((a, i) => (
                <span key={a.punto}>
                  {i > 0 ? ' · ' : ''}
                  La <b>caja {a.punto}</b> quedó abierta (desde el {fechaCorta(a.desde)})
                  {a.cerroDespues === null
                    ? ' y nunca se contó'
                    : `, se contó recién el ${fechaCorta(a.cerroDespues)}`}
                </span>
              ))}
              . Esa plata <b>no está</b> en el total: a esa fecha nadie la
              contó, y estimarla sería una cuenta nuestra, no un arqueo.
            </p>
          ) : null}

          <p className="label-sm" style={{ marginTop: 10 }}>
            Es el <b>efectivo</b> del cajón. Lo cobrado con tarjeta, QR o
            transferencia no está acá: es un crédito contra el banco o la
            billetera, y eso Pandora todavía no lo tiene. Cada arqueo cuenta en
            el día en que <b>se contó</b>, no en el del turno: una caja contada
            a las 02:00 del día siguiente figura como abierta a esta fecha.
          </p>

          {caja.total !== null || caja.abiertas.length > 0 ? (
            <button
              type="button"
              className="exp-btn"
              onClick={() => bajar(() => exportarCajaCsvAction(caja.fecha))}
              disabled={pending}
            >
              {pending ? 'Generando…' : 'Exportar caja (CSV)'}
            </button>
          ) : null}
        </section>

        <div className="sec-h2">{H2_ICONO}Gastos del período</div>
        <section className="card glass">
          <div className="card-title">
            <h3>Gastos</h3>
            <span className="upper-mini">{resumen.periodo.etiqueta}</span>
          </div>
          {resumen.gastos.cantidad === 0 ? (
            <p className="label-sm">
              No se cargaron gastos en el período. Es lo que hoy el comercio le
              manda a la contadora clasificado a mano.
            </p>
          ) : (
            <>
              <div className="conc-stats">
                <div>
                  {/* "Pagado", no "Total": este importe es plata que SALIÓ en
                      el período, mientras que los dos contadores de al lado son
                      devengados. Son dos criterios en la misma tarjeta, y la
                      etiqueta es lo único que lo dice. */}
                  <div className="cs-k">Total pagado</div>
                  <div className="cs-v tnum">{plata(resumen.gastos.total)}</div>
                </div>
                <div>
                  <div className="cs-k">Comprobantes</div>
                  <div className="cs-v tnum">{resumen.gastos.cantidad}</div>
                </div>
                <div>
                  <div className="cs-k">Con factura (IVA compras)</div>
                  <div className="cs-v tnum">{resumen.gastos.comprobantes}</div>
                </div>
              </div>
              {/* Esta resta se muestra HECHA, así que los dos contadores tienen
                  que estar en la misma base. Estuvo mal una vez: `cantidad`
                  contaba sólo los gastos pagados y `comprobantes` todos los del
                  período, así que con dos compras a cuenta corriente la frase
                  decía 3 donde eran 5 — y es la frase con la que la contadora
                  reclama los comprobantes que le faltan. */}
              <p className="label-sm">
                Los que tienen factura el estudio ya los baja de ARCA; los otros{' '}
                <b>
                  {resumen.gastos.cantidad - resumen.gastos.comprobantes}
                </b>{' '}
                son los que hay que mandarle.
              </p>

              {/* ── Ítem 12: los archivos, no sólo el detalle ──────────────
                  Hasta acá esta tarjeta decía CUÁNTOS comprobantes hay y la
                  contadora seguía pidiendo los archivos por WhatsApp. Esto es
                  lo único que hace que el ítem 12 deje de estar a medias.

                  No se cargan solos al entrar: son los gastos de un período
                  entero y la mayoría de las visitas a esta pantalla no vienen
                  a buscarlos. */}
              <div className="adj-bloque">
                <button
                  type="button"
                  className="exp-btn"
                  onClick={verComprobantes}
                  disabled={pending}
                >
                  {comprobantes === null
                    ? 'Ver los comprobantes adjuntos'
                    : 'Actualizar la lista'}
                </button>

                {linkSuelto !== null ? (
                  <p className="label-sm">
                    El navegador bloqueó la pestaña.{' '}
                    <a href={linkSuelto.url} target="_blank" rel="noopener noreferrer">
                      Abrir {linkSuelto.nombre}
                    </a>
                  </p>
                ) : null}

                {comprobantes === null ? null : comprobantes.length === 0 ? (
                  <p className="label-sm">
                    Ningún gasto del período tiene el comprobante adjunto. Los
                    números de arriba cuentan gastos <b>cargados</b>; esto cuenta
                    <b> archivos subidos</b>, que son dos cosas distintas.
                  </p>
                ) : (
                  <>
                    <ul className="adj-lista">
                      {comprobantes.map((c) => (
                        <li key={c.attachment_id}>
                          <span className="adj-fecha tnum">{fechaCorta(c.fecha)}</span>
                          <span className="adj-quien">
                            {c.payee_name?.trim() || c.categoria}
                            {c.comprobante_numero !== null ? (
                              <span className="adj-nro tnum">
                                {' '}
                                {c.comprobante_tipo ?? ''} {c.comprobante_numero}
                              </span>
                            ) : null}
                          </span>
                          <span className="adj-importe tnum">{plata(c.total)}</span>
                          <button
                            type="button"
                            className="exp-btn adj-bajar"
                            onClick={() => void abrirComprobante(c.attachment_id)}
                          >
                            Abrir
                          </button>
                        </li>
                      ))}
                    </ul>
                    {/* El número se dice acá y no se deja contar a ojo: es el
                        que la contadora compara contra lo que esperaba. */}
                    <p className="label-sm">
                      {comprobantes.length === 1
                        ? '1 comprobante adjunto'
                        : `${comprobantes.length} comprobantes adjuntos`}{' '}
                      en el período. Los contratos de alquiler no salen acá —
                      llevan datos del locador y esa consulta sigue abierta.
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </section>

        <div className="sec-h2">{H2_ICONO}Inventario de bienes de cambio</div>
        <section className="card glass">
          <div className="card-title">
            <h3>Valorizado al cierre</h3>
            {/* La FECHA, no el período: esto es un saldo a un día. El resto de
                la pantalla son flujos, y mezclarlos sin decirlo es cómo se
                termina mandando al estudio un inventario que no es el del
                cierre. */}
            <span className="upper-mini">al {fechaLarga(inventario.fecha)}</span>
          </div>

          {inventario.productos === 0 ? (
            <p className="label-sm">
              No había mercadería en stock a esa fecha, o todavía no hay
              movimientos cargados.
            </p>
          ) : (
            <>
              <div className="conc-stats">
                <div>
                  <div className="cs-k">Total valorizado</div>
                  <div className="cs-v tnum">{plata(inventario.total)}</div>
                </div>
                <div>
                  <div className="cs-k">Con compra registrada</div>
                  <div className="cs-v tnum">{plata(inventario.con_compra_total)}</div>
                </div>
                <div>
                  <div className="cs-k">Al costo declarado</div>
                  <div className="cs-v tnum">{plata(inventario.sin_compra_total)}</div>
                </div>
              </div>

              {/* Los tres estados a la vista. Mezclar el segundo dentro del
                  primero daría un número prolijo que la contadora no puede
                  cotejar contra ningún papel. */}
              <p className="label-sm">
                <b>{plata(inventario.con_compra_total)}</b> salen de comprobantes
                de compra, con su fecha de adquisición e importe.{' '}
                {inventario.con_unidades_sin_compra > 0 ? (
                  <>
                    Los otros <b>{plata(inventario.sin_compra_total)}</b> son
                    unidades <b>sin compra asociada</b> en{' '}
                    {inventario.con_unidades_sin_compra} producto
                    {inventario.con_unidades_sin_compra === 1 ? '' : 's'}:
                    valorizadas al <b>costo declarado</b>, que no está respaldado
                    por un comprobante. Es lo normal en lo que ya estaba en el
                    local antes de empezar a registrar compras.
                  </>
                ) : (
                  <>Todo el inventario tiene comprobante detrás.</>
                )}
              </p>

              {Number(inventario.sin_valorizar_qty) > 0 ? (
                <p className="label-sm alerta">
                  ⚠️ <b>{enteroCorto(inventario.sin_valorizar_qty)}</b> unidades en{' '}
                  {inventario.sin_valorizar_productos} producto
                  {inventario.sin_valorizar_productos === 1 ? '' : 's'}{' '}
                  <b>no están incluidas</b> en el total: no tienen compra
                  registrada ni costo cargado. El total de arriba queda corto en
                  lo que valgan.
                </p>
              ) : null}

              {inventario.sin_tracking > 0 ? (
                <p className="label-sm">
                  {inventario.sin_tracking} producto
                  {inventario.sin_tracking === 1 ? '' : 's'} con stock quedan
                  afuera por no llevar control de stock: sin movimientos no se
                  puede reconstruir cuánto había a esa fecha.
                </p>
              ) : null}

              <div className="inv-tab">
                <div className="inv-th">
                  <span style={{ flex: 1 }}>Producto</span>
                  <span style={{ width: 78, textAlign: 'right' }}>Cantidad</span>
                  <span style={{ width: 96, textAlign: 'right' }}>Con compra</span>
                  <span style={{ width: 104, textAlign: 'right' }}>Declarado</span>
                  <span style={{ width: 112, textAlign: 'right' }}>Valorizado</span>
                </div>
                {inventario.filas.map((f) => (
                  <div key={f.name} className="inv-tr">
                    <span style={{ flex: 1 }}>
                      {f.name}
                      {f.ultima_compra !== null ? (
                        <i className="inv-fecha">últ. compra {f.ultima_compra}</i>
                      ) : null}
                    </span>
                    <span style={{ width: 78, textAlign: 'right' }} className="tnum">
                      {enteroCorto(f.cantidad)}
                    </span>
                    <span style={{ width: 96, textAlign: 'right' }} className="tnum">
                      {enteroCorto(f.con_compra_qty)}
                    </span>
                    <span style={{ width: 104, textAlign: 'right' }} className="tnum">
                      {f.sin_costo ? '—' : enteroCorto(f.sin_compra_qty)}
                    </span>
                    <span style={{ width: 112, textAlign: 'right' }} className="tnum">
                      {f.sin_costo ? (
                        <b className="inv-falta">sin costo</b>
                      ) : (
                        plata(f.total)
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <p className="label-sm">
                Valorizado por <b>{inventario.metodo}</b> (lo que queda en stock
                son las compras más recientes). <b>El método lo define el
                estudio</b>: Pandora aplica uno y lo declara.
              </p>

              <button
                type="button"
                className="exp-btn"
                onClick={() =>
                  bajar(() => exportarInventarioCsvAction(inventario.fecha))
                }
                disabled={pending}
              >
                {pending ? 'Generando…' : 'Exportar inventario (CSV)'}
              </button>
            </>
          )}
        </section>

        <div className="sec-h2">{H2_ICONO}Cuentas corrientes</div>
        <section className="card glass" id="deudores-al-cierre">
          <div className="card-title">
            <h3>Deudores</h3>
            {/* Ítem 5, textual: "razón social, CUIT e importe". Al CIERRE: el
                saldo de hoy no es el que va al balance. */}
            <span className="upper-mini">al {fechaLarga(fechaCierre)}</span>
          </div>
          <div className="cc-2">
            <div className="cc-box">
              <div className="cc-bk">Total por cobrar</div>
              <div
                className={deudores.length > 0 ? 'cc-bv tnum debe' : 'cc-bv tnum'}
              >
                {plata(totalDeudores)}
              </div>
            </div>
            <div className="cc-box">
              <div className="cc-bk">Clientes con deuda</div>
              <div className="cc-bv tnum">{deudores.length}</div>
            </div>
          </div>
          {deudores.length === 0 ? (
            <p className="label-sm">
              Nadie debía a esa fecha: todas las cuentas al día.
            </p>
          ) : (
            <div className="cc-list">
              {deudores.map((d) => (
                <div className="cc-row" key={d.nombre + d.doc_numero}>
                  <span className="cc-av">{iniciales(d.nombre)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {d.nombre}
                    <span className="label-sm">
                      {' · '}
                      {/* `doc_type` ya viene legible por el CHECK de la
                          migration 0023: 'DNI' | 'CUIT' | 'CUIL' | 'none'. */}
                      {d.doc_numero === ''
                        ? 'sin CUIT cargado'
                        : `${d.doc_tipo} ${d.doc_numero}`}
                    </span>
                  </div>
                  <span className="cc-m">{plata(d.saldo)}</span>
                </div>
              ))}
            </div>
          )}

          {sinDocumento > 0 ? (
            <p className="label-sm alerta" style={{ marginTop: 10 }}>
              ⚠️ {sinDocumento}{' '}
              {sinDocumento === 1 ? 'deudor no tiene' : 'deudores no tienen'}{' '}
              documento cargado. El estudio lo pide con CUIT: se completa en la
              ficha del cliente.
            </p>
          ) : null}

          <p className="label-sm" style={{ marginTop: 10 }}>
            Hoy la deuda total es{' '}
            <b>{plata(resumen.cuentasCorrientes.porCobrar)}</b> entre{' '}
            {resumen.cuentasCorrientes.deudores} cliente
            {resumen.cuentasCorrientes.deudores === 1 ? '' : 's'} — ese es el
            número para operar; el de arriba es el del balance.
          </p>
          <p className="label-sm">
            El corte usa la fecha en que se <b>registró</b> cada movimiento: el
            libro de cuenta corriente no guarda la fecha de la operación. Un
            fiado del 30/07 cargado el 02/08 cuenta en el ejercicio siguiente.
          </p>

          {deudores.length > 0 ? (
            <button
              type="button"
              className="exp-btn"
              onClick={() => bajar(() => exportarDeudoresCsvAction(fechaCierre))}
              disabled={pending}
            >
              {pending ? 'Generando…' : 'Exportar deudores (CSV)'}
            </button>
          ) : null}
        </section>

        {/* La otra cara del mismo mostrador: allá nos deben, acá debemos.
            Ítem 9 de la carta (ADR-0028). Va al lado de Deudores a propósito —
            son las dos columnas de cuentas corrientes del balance.

            NO tiene botón de pagar, y no es un olvido: el rol `accountant` mira
            y exporta (Ley 20.488 — Pandora prepara, la matriculada firma). El
            pago se registra desde /gastos, que es la pantalla del comercio. */}
        <section className="card glass" id="acreedores-al-cierre">
          <div className="card-title">
            <h3>Acreedores</h3>
            <span className="upper-mini">al {fechaLarga(fechaCierre)}</span>
          </div>
          <div className="cc-2">
            <div className="cc-box">
              <div className="cc-bk">Total a pagar</div>
              <div
                className={acreedores.length > 0 ? 'cc-bv tnum debe' : 'cc-bv tnum'}
              >
                {plata(totalAcreedores)}
              </div>
            </div>
            <div className="cc-box">
              <div className="cc-bk">Proveedores con saldo</div>
              <div className="cc-bv tnum">{acreedores.length}</div>
            </div>
          </div>
          {acreedores.length === 0 ? (
            <p className="label-sm">
              No había deudas con proveedores registradas a esa fecha.
            </p>
          ) : (
            <div className="cc-list">
              {acreedores.map((a) => (
                <div className="cc-row" key={a.tercero_id}>
                  <span className="cc-av">{iniciales(a.nombre)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {a.nombre}
                    <span className="label-sm">
                      {' · '}
                      {a.doc === '' ? 'sin CUIT cargado' : a.doc}
                    </span>
                  </div>
                  <span className="cc-m">{plata(a.saldo)}</span>
                </div>
              ))}
            </div>
          )}

          {acreedoresSinCuit > 0 ? (
            <p className="label-sm alerta" style={{ marginTop: 10 }}>
              ⚠️ {acreedoresSinCuit}{' '}
              {acreedoresSinCuit === 1
                ? 'proveedor no tiene'
                : 'proveedores no tienen'}{' '}
              CUIT cargado. El estudio lo pide: se completa en la ficha del
              proveedor.
            </p>
          ) : null}

          {/* Los dos caveats, distintos a los de Deudores y por eso escritos
              acá y no compartidos: este libro SÍ guarda la fecha del hecho. */}
          <p className="label-sm" style={{ marginTop: 10 }}>
            El corte usa la fecha <b>del comprobante</b>, no la de la carga: una
            factura del 30/07 cargada en septiembre cuenta en el ejercicio
            correcto.
          </p>
          <p className="label-sm">
            Es lo <b>registrado</b>, no todo lo que se debe: una factura que
            nunca se cargó en el sistema no aparece acá.
          </p>

          {acreedores.length > 0 ? (
            <button
              type="button"
              className="exp-btn"
              onClick={() => bajar(() => exportarAcreedoresCsvAction(fechaCierre))}
              disabled={pending}
            >
              {pending ? 'Generando…' : 'Exportar acreedores (CSV)'}
            </button>
          ) : null}
        </section>

        <div className="sec-h2">{H2_ICONO}Todavía no disponible</div>
        <section className="card glass">
          <p className="label-sm" style={{ marginBottom: 10 }}>
            Se declara en vez de mostrarse en cero: un panel vacío se lee como
            &quot;no hubo movimiento&quot;.
          </p>
          <div className="cc-list">
            {PENDIENTES.map((p) => (
              <div className="cc-row" key={p.que}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.que}</div>
                  <div className="label-sm">{p.porque}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* La posición del producto, y no es decoración: si la contadora cree
            que Pandora le firma los papeles, la perdemos. */}
        <div className="legal-note">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <div>
            Pandora prepara <b>borradores</b> con lo que se registró en el
            comercio. La revisión, la aprobación y la presentación son del
            profesional matriculado (<b>Ley 20.488</b>). El sistema no firma ni
            presenta nada.
          </div>
        </div>
      </div>
    </>
  );

  return (
    <AppShell
      userName={usuario}
      userRole={esContador ? 'Contadora' : 'Dueño'}
      storeName={empresaActivaNombre}
      topbarLeft={topbarIzq}
      scroll="pagina"
    >
      {contenido}
    </AppShell>
  );
}
