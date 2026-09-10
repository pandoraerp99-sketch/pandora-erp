'use client';

/**
 * Panel — la pantalla de inicio.
 *
 * Maqueta: `public/panel.html`. Se porta con SU vocabulario (.hero / .grid3 /
 * .card.glass / .tx-row / .donut / .bars), no con uno nuevo.
 *
 * ── LA REGLA ──────────────────────────────────────────────────────────────
 * Cada número de esta pantalla sale de una consulta real. Donde la maqueta
 * inventaba, acá se dice qué falta. Un panel es lo que más se mira y menos se
 * audita: un número inventado se cree para siempre.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { openSessionAction } from '@/app/caja/actions';
import { normalizarMontoTipeado } from '@/lib/money/monto-tipeado';
import { AppShell } from '@/components/shell/AppShell';
import { Sparkline } from '@/components/charts/Sparkline';
import { EvolucionVentas } from '@/components/charts/EvolucionVentas';
import { CalendarioMes } from '@/components/calendar/CalendarioMes';
import { PANEL_CSS } from './panelCss';

export interface PanelProps {
  hoy: {
    total: string;
    tickets: number;
    ticketPromedio: string;
    totalSemanaPasada: string;
    variacion: number | null;
    mejorHora: number | null;
    mejorHoraTotal: string;
  };
  mes: {
    total: string;
    tickets: number;
    totalMesPasado: string;
    variacion: number | null;
    totalMesPasadoCompleto: string;
    diaDelMes: number;
    mesActual: string;
    mesAnterior: string;
  };
  serie: Array<{ dia: string; total: string; tickets: string }>;
  serieHoraria: Array<{ hora: string; total: string; tickets: string }>;
  ingresosGastos: Array<{ mes: string; ingresos: string; gastos: string }>;
  medios: Array<{ medio: string; total: string; operaciones: string }>;
  masVendidos: Array<{ nombre: string; unidades: string; total: string }>;
  ultimas: Array<{
    id: string;
    hora: string;
    total: string;
    medio: string;
    cliente: string;
    items: string;
  }>;
  stockBajo: Array<{ nombre: string; stock: string; minimo: string }>;
  cuentaCorriente: { porCobrar: string; deudores: number };
  caja: {
    abierta_at: string;
    initial: string;
    cashSales: string;
    deposits: string;
    customerPayments: string;
    withdraws: string;
    providerPayments: string;
    expected: string;
  } | null;
  rubros: Array<{ rubro: string; total: string; unidades: string; porcentaje: string }>;
  clientes: {
    activos: number;
    nuevos: number;
    vuelven: number;
    facturadoIdentificado: string;
    porcentajeIdentificado: string | null;
  };
  /** 'miércoles 10 de septiembre de 2026', ya formateada en la zona del comercio. */
  fechaLarga: string;
  /** Hora del COMERCIO (0-23). Ver `saludo()`. */
  horaComercio: number;
  /** 'AAAA-MM-DD' del comercio. El calendario marca ESTE día como hoy. */
  hoyComercio: string;
  diasCalendario: Array<{ dia: string; total: string; tickets: string }>;
  feriados: Array<{
    fecha: string;
    nombre: string;
    tipo: string;
    jurisdiction: string;
    nota: string | null;
  }>;
  coberturaFeriados: Array<{
    anio: number;
    jurisdiction: string;
    completo: boolean;
    nota: string | null;
    verified_at: string;
  }>;
  comercio: string;
  usuario: string;
}

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const PESOS_CENT = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});
/** Sólo presentación: el cálculo ya vino hecho del servidor. */
const plata = (v: string) => PESOS.format(Number(v));
const plataC = (v: string) => PESOS_CENT.format(Number(v));

const MEDIOS: Record<string, { label: string; color: string }> = {
  efectivo: { label: 'Efectivo', color: '#34c77d' },
  debito: { label: 'Débito', color: '#5b8cff' },
  credito: { label: 'Crédito', color: '#6b5fff' },
  tarjeta: { label: 'Tarjeta', color: '#6b5fff' },
  mp_qr: { label: 'Mercado Pago', color: '#0e8f9e' },
  cuenta_corriente: { label: 'Cuenta corriente', color: '#f7984a' },
  mixto: { label: 'Mixto', color: '#ee6a8e' },
};
/**
 * Colores de los rubros.
 *
 * Por POSICION y no por nombre: los rubros los escribe el comerciante y no hay
 * catálogo cerrado, así que un mapa por nombre dejaría sin color a cualquier
 * rubro nuevo. El orden es por facturación, así que el color además es estable
 * mientras el ranking no cambie.
 */
const RUBRO_COLOR = ['#6b5fff', '#5b8cff', '#0e8f9e', '#34c77d', '#f7984a', '#ee6a8e'];

const medioLabel = (m: string) => MEDIOS[m]?.label ?? m;
const medioColor = (m: string) => MEDIOS[m]?.color ?? '#a8b0c5';

/**
 * El saludo depende de la hora DEL COMERCIO, que calcula el servidor.
 *
 * Antes salía de `new Date().getHours()`, o sea la hora del NAVEGADOR. Es el
 * mismo error de huso que ya se corrigió en las consultas: el servidor corre en
 * UTC —tres horas adelante de Ushuaia— así que a las 18:00 de un martes en el
 * local, el render del servidor decía "Buenas noches". Y con el servidor y el
 * cliente cayendo en franjas distintas, React además marca hydration mismatch.
 */
function saludo(h: number): string {
  if (h < 6) return 'Buenas noches';
  if (h < 13) return 'Buen día';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

/** '2026-09-09' → 'mar 9'. Sin `new Date(iso)`: correría el día en huso oeste. */
function diaCorto(iso: string): string {
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${DIAS[dow]} ${d}`;
}

/** '2026-09-01' → 'sep'. */
function mesCorto(iso: string): string {
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return MESES[Number(iso.split('-')[1]) - 1] ?? '';
}

/** '2026-08-01' → 'agosto'. */
function mesLargo(iso: string): string {
  const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return MESES[Number(iso.split('-')[1]) - 1] ?? '';
}

/**
 * Ancho de una barra contra la otra, en porcentaje.
 *
 * Se escala al MAYOR de las dos, no a cada una por su cuenta: si cada barra
 * usara todo el ancho, dos meses muy distintos se verían iguales y la
 * comparación —que es todo el punto del bloque— no diría nada. El mínimo de 4%
 * es para que un mes casi en cero siga siendo una barra visible y no un vacío
 * que se lee como "no hay dato".
 */
function anchoRelativo(valor: string, otro: string): number {
  const max = Math.max(Number(valor), Number(otro));
  if (max === 0) return 0;
  return Math.max(4, (Number(valor) / max) * 100);
}

/**
 * Ticket promedio de cada día.
 *
 * Un día sin ventas NO es "ticket promedio cero": no hubo tickets, que es otra
 * cosa. Poner cero haría que la curva se desplome cada domingo y el gráfico
 * contaría una historia de sierra que no pasó. Se arrastra el último valor
 * conocido, que es lo que el ojo espera de una línea de promedio.
 *
 * Función aparte y no un acumulador adentro del render: mutar una variable de
 * afuera durante el render es lo que marca `react-hooks/immutability`, y tiene
 * razón — ese `let` sobrevive al render.
 */
function ticketPromedioPorDia(serie: Array<{ total: string; tickets: string }>): number[] {
  const out: number[] = [];
  let ultimo = 0;
  for (const d of serie) {
    const t = Number(d.tickets);
    if (t > 0) ultimo = Number(d.total) / t;
    out.push(ultimo);
  }
  return out;
}

/** Flechita + porcentaje. `null` = no hay con qué comparar, y se dice. */
function Delta({ v }: { v: number | null }) {
  if (v === null) {
    return <span className="label-sm">sin comparación</span>;
  }
  const sube = v >= 0;
  return (
    <span className={sube ? 'delta up' : 'delta down'}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <path d={sube ? 'M6 14l6-6 6 6' : 'M6 10l6 6 6-6'} />
      </svg>
      {Math.abs(v).toFixed(1)}%
    </span>
  );
}

/**
 * Abrir la caja del turno, sin salir del panel.
 *
 * ── POR QUE SE ABRE ACA Y NO SE CIERRA ────────────────────────────────────
 * Abrir es declarar un fondo inicial y nada más, así que hacerlo desde la
 * pantalla de inicio le ahorra al cajero un viaje. **Cerrar es otra cosa**:
 * exige el arqueo por denominación —contar la plata— y produce un descuadre
 * que hay que justificar. Todo eso ya vive en `/caja`. Un botón de "cerrar" en
 * el panel sería, en la práctica, una forma de cerrar la caja sin contarla.
 *
 * Reusa `openSessionAction` de `/caja`: la misma action, con su validación de
 * sesión única y su audit. No se duplica.
 */
function AbrirCaja() {
  const router = useRouter();
  const [monto, setMonto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();

  // Acá se escribe "12.500,50": punto de miles, coma decimal. Un
  // `replace(',', '.')` a secas daba "12.500.50" y el dominio lo rechazaba
  // citando un string que nadie tipeó. Viaja como string de punta a punta:
  // nunca pasa por `Number` (CLAUDE.md §9.8).
  const normalizado = normalizarMontoTipeado(monto);

  const abrir = () => {
    if (normalizado === null) {
      setError('No se entiende ese monto. Por ejemplo: 12.500,50');
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await openSessionAction({ initialAmount: normalizado });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  };

  return (
    <>
      <div className="qa-caja">
        <input
          inputMode="decimal"
          placeholder="Fondo inicial"
          aria-label="Fondo inicial de la caja"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && monto.trim() !== '') abrir();
          }}
        />
        <button
          type="button"
          onClick={abrir}
          disabled={enviando || normalizado === null}
        >
          {enviando ? 'Abriendo…' : 'Abrir caja'}
        </button>
      </div>
      {/* ── SE MUESTRA LO QUE SE ENTENDIO, ANTES DE CONFIRMAR ───────────────
          "12.500" es genuinamente ambiguo: doce mil quinientos, o doce con
          medio. La regla lo resuelve por la forma, pero adivinar en silencio el
          fondo inicial de una caja es abrir el turno con la plata mal, y el
          descuadre aparecería recién al cierre. Así lo verifica quien lo tipea. */}
      {monto.trim() !== '' && normalizado !== null ? (
        <div className="qa-eco">
          Vas a abrir con <b>{plataC(normalizado)}</b>
        </div>
      ) : null}
      {error === null ? null : (
        <div className="qa-err" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

export function PanelClient({
  hoy,
  mes,
  serie,
  serieHoraria,
  ingresosGastos,
  medios,
  masVendidos,
  ultimas,
  stockBajo,
  cuentaCorriente,
  caja,
  rubros,
  clientes,
  fechaLarga,
  horaComercio,
  hoyComercio,
  diasCalendario,
  feriados,
  coberturaFeriados,
  comercio,
  usuario,
}: PanelProps) {
  // "Facturación del mes" ya no lleva sparkline: las dos barras comparativas
  // dicen lo mismo y además muestran contra qué se compara. Las otras dos
  // tarjetas del trío sí la conservan.
  const serieTickets = serie.map((d) => Number(d.tickets));
  const seriePromedio = ticketPromedioPorDia(serie);

  const totalMedios = medios.reduce((a, m) => a + Number(m.total), 0);
  const totalOperaciones = medios.reduce((a, m) => a + Number(m.operaciones), 0);
  const hayVentasHoy = hoy.tickets > 0;
  // Para las barras de "más vendidos": relativas al primero, que es el que más
  // facturó. Escalar cada una a su propio ancho no compararía nada.
  const topVendido = Math.max(...masVendidos.map((p) => Number(p.total)), 1);

  // Anillo: el día contra el mismo día de la semana pasada. Reemplaza a la
  // "meta del día" de la maqueta, que no existe como concepto en ningún lado.
  const base = Number(hoy.totalSemanaPasada);
  const ratio = base === 0 ? null : Number(hoy.total) / base;
  const pct = ratio === null ? null : Math.round(ratio * 100);
  const CIRC = 2 * Math.PI * 34;
  const dash = ratio === null ? 0 : Math.min(ratio, 1) * CIRC;

  const maxIG = Math.max(
    ...ingresosGastos.map((m) => Math.max(Number(m.ingresos), Number(m.gastos))),
    1
  );
  // El rango del día sale de los DATOS, no de un horario configurado: no
  // existe el concepto de "horario de atención" en Pandora. Dice a qué hora
  // abrió de verdad, que además es más interesante que una constante.
  const rangoDelDia =
    serieHoraria.length === 0
      ? null
      : `primera venta ${serieHoraria[0]!.hora}h · última ${serieHoraria[serieHoraria.length - 1]!.hora}h`;

  const ultimoIG = ingresosGastos[ingresosGastos.length - 1];
  const resultadoMes =
    ultimoIG === undefined ? 0 : Number(ultimoIG.ingresos) - Number(ultimoIG.gastos);

  const contenido = (
    <>
      <style>{PANEL_CSS}</style>

      <div className="content">
        <div className="col-main">
          {/* ═══ HERO ═══ */}
          <div className="hero glass">
            <div className="hero-art">
              <div className="halo" />
              {/* Las tarjetas flotantes de la maqueta traían datos inventados.
                  Estas tres traen los de verdad, y si no hay, no se dibujan. */}
              {ultimas[0] ? (
                <div
                  className="float-card f1"
                  style={{ top: 4, right: 8, padding: '12px 14px', width: 210 }}
                >
                  <div className="upper-mini">Última venta · {ultimas[0].hora}</div>
                  <div
                    className="tnum"
                    style={{ fontSize: 17, fontWeight: 700, marginTop: 3 }}
                  >
                    {plata(ultimas[0].total)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>
                    {ultimas[0].items} ítem{ultimas[0].items === '1' ? '' : 's'} ·{' '}
                    {medioLabel(ultimas[0].medio)}
                  </div>
                </div>
              ) : null}

              {hoy.mejorHora !== null ? (
                <div
                  className="float-card f2"
                  style={{ top: 108, right: 64, padding: '12px 14px', width: 186 }}
                >
                  <div className="upper-mini">
                    Mejor hora · {hoy.mejorHora}-{hoy.mejorHora + 1}h
                  </div>
                  <div
                    className="tnum"
                    style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}
                  >
                    {plata(hoy.mejorHoraTotal)}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                    últimos 30 días
                  </div>
                </div>
              ) : null}

              {cuentaCorriente.deudores > 0 ? (
                <div
                  className="float-card f3"
                  style={{ top: 200, right: 4, padding: '10px 13px', width: 190 }}
                >
                  <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
                    <b className="tnum">{plata(cuentaCorriente.porCobrar)}</b> en la
                    calle
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1 }}>
                    {cuentaCorriente.deudores} cliente
                    {cuentaCorriente.deudores === 1 ? '' : 's'} con saldo
                  </div>
                </div>
              ) : null}
            </div>

            <div className="hero-hi">
              {saludo(horaComercio)}, {usuario} <span className="wave">👋</span>
            </div>
            <div className="hero-fecha">{fechaLarga}</div>
            <h1 className="hero-h1">
              Tu negocio,
              <br />
              al día.
            </h1>

            <div className="hero-live">
              <span className="live-dot" />
              <div style={{ flex: 1 }}>
                <div className="upper-mini">Ventas de hoy</div>
                <div
                  className="tnum"
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    marginTop: 2,
                  }}
                >
                  {plata(hoy.total)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {/* La maqueta dice "vs ayer". Comparar un lunes con un domingo
                    no dice nada: va contra el mismo día de la semana pasada. */}
                <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                  vs el {diaCorto(serie[serie.length - 8]?.dia ?? '')} pasado
                </div>
                <div style={{ marginTop: 3 }}>
                  <Delta v={hoy.variacion} />
                </div>
              </div>
            </div>
          </div>

          {/* ═══ ACCIONES RÁPIDAS ═══
              Lo que el comerciante viene a HACER, no a mirar. Van arriba de
              todo lo demás porque abrir la caja y cargar una venta son las dos
              cosas con las que empieza el turno. */}
          <div className="qa">
            <Link className="qa-b" href="/pos">
              <span className="qa-ic" style={{ background: 'rgba(107,95,255,0.14)', color: 'var(--purple)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="20" r="1.4" />
                  <circle cx="18" cy="20" r="1.4" />
                  <path d="M2 3h3l2.4 12h11L21 7H6" />
                </svg>
              </span>
              Nueva venta
            </Link>
            <Link className="qa-b" href="/gastos">
              <span className="qa-ic" style={{ background: 'rgba(247,152,74,0.16)', color: '#8a520c' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5h16v14H4z" />
                  <path d="M8 10h8M8 14h5" />
                </svg>
              </span>
              Cargar gasto
            </Link>
            <Link className="qa-b" href="/productos">
              <span className="qa-ic" style={{ background: 'rgba(52,199,125,0.15)', color: '#1a8e5a' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 8l-9-5-9 5 9 5 9-5z" />
                  <path d="M3 8v8l9 5 9-5V8" />
                </svg>
              </span>
              Nuevo producto
            </Link>
            <Link className="qa-b" href="/clientes">
              <span className="qa-ic" style={{ background: 'rgba(91,140,255,0.15)', color: '#2f5fd0' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="3.4" />
                  <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
                </svg>
              </span>
              Clientes
            </Link>
          </div>

          {/* ═══ LA FRASE DEL DÍA — descriptiva, no un pronóstico ═══ */}
          <div
            className="card glass"
            style={{
              display: 'flex',
              // flexDirection explícito: shellCss le pone `column` a .card (es
              // el layout del POS) y sin esto el ícono queda arriba del texto,
              // centrado. Medido en la primera captura.
              flexDirection: 'row',
              alignItems: 'center',
              gap: 13,
              padding: '14px 18px',
              marginBottom: 16,
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(150deg,rgba(247,152,74,0.22),rgba(238,106,142,0.18))',
              }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#b9701c"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
              </svg>
            </span>
            <div style={{ fontSize: 13.5, color: 'var(--ink-1)', lineHeight: 1.45 }}>
              {!hayVentasHoy ? (
                <>
                  <b>Todavía no hay ventas hoy.</b>{' '}
                  <span style={{ color: 'var(--ink-2)' }}>
                    En cuanto cobres la primera, el panel se actualiza solo.
                  </span>
                </>
              ) : (
                <>
                  <b>
                    {hoy.tickets} venta{hoy.tickets === 1 ? '' : 's'} por{' '}
                    {plata(hoy.total)} en lo que va del día.
                  </b>{' '}
                  <span style={{ color: 'var(--ink-2)' }}>
                    {masVendidos[0]
                      ? `${masVendidos[0].nombre} es lo que más empuja.`
                      : ''}{' '}
                    {hoy.variacion !== null
                      ? `Vas ${hoy.variacion >= 0 ? 'arriba' : 'abajo'} del mismo día de la semana pasada.`
                      : 'Es la primera vez que vendés este día de la semana.'}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* ═══ 3 MÉTRICAS ═══ */}
          <div className="grid3">
            <div className="card glass">
              <div className="card-title">
                <h3>Facturación del mes</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                <span className="bignum tnum">{plata(mes.total)}</span>
                <Delta v={mes.variacion} />
              </div>
              <div className="label-sm" style={{ marginTop: 2 }}>
                vs los mismos días de {mesLargo(mes.mesAnterior)}
              </div>

              {/* Las dos barras hacen VISIBLE de dónde sale el porcentaje de
                  arriba. Antes estaba el "+22,3%" pelado y había que creerle. */}
              <div className="cmp">
                <div className="cmp-fila">
                  <span className="cmp-rot">
                    1–{mes.diaDelMes} {mesCorto(mes.mesAnterior)}
                  </span>
                  <span className="cmp-val tnum">{plata(mes.totalMesPasado)}</span>
                </div>
                <div className="cmp-pista">
                  <div
                    className="cmp-barra ant"
                    style={{ width: `${anchoRelativo(mes.totalMesPasado, mes.total)}%` }}
                  />
                </div>
                <div className="cmp-fila" style={{ marginTop: 9 }}>
                  <span className="cmp-rot">
                    1–{mes.diaDelMes} {mesCorto(mes.mesActual)}
                  </span>
                  <span className="cmp-val tnum">{plata(mes.total)}</span>
                </div>
                <div className="cmp-pista">
                  <div
                    className="cmp-barra act"
                    style={{ width: `${anchoRelativo(mes.total, mes.totalMesPasado)}%` }}
                  />
                </div>
              </div>

              <div className="label-sm" style={{ marginTop: 12 }}>
                {Number(mes.totalMesPasadoCompleto) > 0 ? (
                  <>
                    {mesLargo(mes.mesAnterior)} cerró en{' '}
                    <b className="tnum" style={{ color: 'var(--ink-2)' }}>
                      {plata(mes.totalMesPasadoCompleto)}
                    </b>
                  </>
                ) : (
                  <>Todavía no hay un mes anterior con el que comparar.</>
                )}
              </div>
            </div>

            <div className="card glass">
              <div className="card-title">
                <h3>Tickets de hoy</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                <span className="bignum tnum">{hoy.tickets}</span>
              </div>
              <div className="label-sm" style={{ marginTop: 2 }}>
                ventas cobradas
              </div>
              <Sparkline
                serie={serieTickets}
                w={280}
                h={64}
                className="spark"
                color="var(--green)"
                fill="52,199,125"
              />
            </div>

            <div className="card glass">
              <div className="card-title">
                <h3>Ticket promedio</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                <span className="bignum tnum">{plata(hoy.ticketPromedio)}</span>
              </div>
              <div className="label-sm" style={{ marginTop: 2 }}>
                por venta
              </div>
              <Sparkline
                serie={seriePromedio}
                w={280}
                h={64}
                className="spark"
                color="var(--blue)"
                fill="91,140,255"
              />
            </div>
          </div>

          {/* ═══ EVOLUCIÓN DE VENTAS ═══
              El bloque más útil para quien atiende: contesta "cuándo vendo".
              Las tres series van cargadas y el toggle es estado local. */}
          <div className="card glass" style={{ marginTop: 16 }}>
            <EvolucionVentas
              dia={serieHoraria.map((p) => ({
                etiqueta: `${p.hora}h`,
                valor: Number(p.total),
              }))}
              semana={serie.slice(-7).map((d) => ({
                etiqueta: diaCorto(d.dia),
                valor: Number(d.total),
              }))}
              mes={serie.map((d) => ({
                etiqueta: diaCorto(d.dia),
                valor: Number(d.total),
              }))}
              formato={(v) => plata(String(v))}
              {...(rangoDelDia !== null ? { notaDia: rangoDelDia } : {})}
            />
          </div>

          {/* ═══ CALENDARIO ═══
              Va pegado a la Evolución de ventas: los dos hablan del tiempo. La
              curva contesta "cuándo vendo dentro del día"; el calendario, "qué
              días del mes laburo". */}
          <div className="card glass" style={{ marginTop: 16 }}>
            <CalendarioMes
              dias={diasCalendario}
              feriados={feriados}
              cobertura={coberturaFeriados}
              hoy={hoyComercio}
              formato={plata}
            />
          </div>

          {/* ═══ INGRESOS VS GASTOS + MEDIOS DE PAGO ═══ */}
          <div className="grid2" style={{ marginTop: 16 }}>
            <div className="card glass">
              <div className="card-title">
                <h3>Ingresos vs Gastos</h3>
                <Link className="label-sm" href="/gastos">
                  Ver gastos →
                </Link>
              </div>
              {/* El único bloque que la maqueta SÓLO podía inventar: los gastos
                  no existían hasta que se construyó el módulo. */}
              <div style={{ display: 'flex', gap: 18, marginBottom: 6 }}>
                <span className="label-sm">
                  <span
                    className="dot"
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: 3,
                      background: 'var(--purple)',
                      marginRight: 6,
                    }}
                  />
                  Ingresos{' '}
                  <b className="tnum" style={{ color: 'var(--ink)' }}>
                    {plata(ingresosGastos[ingresosGastos.length - 1]?.ingresos ?? '0')}
                  </b>
                </span>
                <span className="label-sm">
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: 3,
                      background: 'var(--orange)',
                      marginRight: 6,
                    }}
                  />
                  Gastos{' '}
                  <b className="tnum" style={{ color: 'var(--ink)' }}>
                    {plata(ingresosGastos[ingresosGastos.length - 1]?.gastos ?? '0')}
                  </b>
                </span>
              </div>
              <div className="ig-grid">
                {ingresosGastos.map((m) => (
                  <div key={m.mes} className="ig-mes">
                    <div className="ig-barras">
                      <div
                        className="ig-b ing"
                        style={{ height: `${(Number(m.ingresos) / maxIG) * 100}%` }}
                        title={`Ingresos ${plata(m.ingresos)}`}
                      />
                      {/* En CERO no se dibuja nada. El `min-height:2px` que
                          hace visible un valor chico convertía un mes sin
                          gastos en una astilla naranja que se lee como un error
                          de render — y hay cinco meses así, porque el módulo de
                          gastos es de la semana pasada. Un hueco dice mejor
                          "acá todavía no había nada". */}
                      {Number(m.gastos) > 0 ? (
                        <div
                          className="ig-b gas"
                          style={{ height: `${(Number(m.gastos) / maxIG) * 100}%` }}
                          title={`Gastos ${plata(m.gastos)}`}
                        />
                      ) : (
                        <div className="ig-b vacia" title="Sin gastos cargados" />
                      )}
                    </div>
                    <div className="ig-rot">{mesCorto(m.mes)}</div>
                  </div>
                ))}
              </div>
              {/* Resultado = ingresos − gastos. Las dos series son reales, así
                  que la resta también. NO se muestra "margen %": eso necesita
                  el costo de la mercadería vendida, y `sale_items` no guarda el
                  costo — calcularlo con el costo de HOY daría un margen
                  histórico falso (si sube el precio de compra, cambiaría el
                  margen de una venta de marzo). */}
              {ultimoIG !== undefined ? (
                <div className="ig-res">
                  <span className="label-sm">Resultado de {mesLargo(ultimoIG.mes)}</span>
                  <span className={resultadoMes >= 0 ? 'ig-res-v pos' : 'ig-res-v neg'}>
                    {resultadoMes >= 0 ? '+' : '−'}
                    {plata(String(Math.abs(resultadoMes)))}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="card glass">
              <div className="card-title">
                <h3>Medios de pago · hoy</h3>
              </div>
              {medios.length === 0 ? (
                <div className="label-sm" style={{ lineHeight: 1.5 }}>
                  Todavía no se cobró nada hoy.
                </div>
              ) : (
                <div className="donut-wrap">
                  <div
                    className="donut"
                    style={{
                      background: `conic-gradient(${medios
                        .reduce<{ css: string[]; acc: number }>(
                          (a, m) => {
                            const desde = (a.acc / totalMedios) * 100;
                            a.acc += Number(m.total);
                            const hasta = (a.acc / totalMedios) * 100;
                            a.css.push(
                              `${medioColor(m.medio)} ${desde.toFixed(2)}% ${hasta.toFixed(2)}%`
                            );
                            return a;
                          },
                          { css: [], acc: 0 }
                        )
                        .css.join(', ')})`,
                    }}
                  >
                    <div className="ctr">
                      {/* En el centro va la CANTIDAD de cobros, no el monto: el
                          monto ya está en cada fila de la leyenda, y repetirlo
                          desperdicia el único lugar que queda para un dato que
                          no está en ningún otro lado. */}
                      <div
                        className="tnum"
                        style={{ fontSize: 21, fontWeight: 700, lineHeight: 1 }}
                      >
                        {totalOperaciones}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>
                        cobros hoy
                      </div>
                    </div>
                  </div>
                  <div className="legend">
                    {medios.map((m) => (
                      <div key={m.medio} className="row">
                        <span
                          className="dot"
                          style={{ background: medioColor(m.medio) }}
                        />
                        {medioLabel(m.medio)}
                        <span className="val">{plata(m.total)}</span>
                        <span className="pct">
                          {Math.round((Number(m.total) / totalMedios) * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ═══ VENTAS POR RUBRO + CLIENTES DEL MES ═══ */}
          <div className="grid2" style={{ marginTop: 16 }}>
            <div className="card glass">
              <div className="card-title">
                <h3>
                  <span className="ic" style={{ background: 'rgba(14,143,158,0.14)', color: 'var(--teal)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 21V9M9 21V4M15 21v-8M21 21v-5" />
                    </svg>
                  </span>
                  Ventas por rubro
                </h3>
                <span className="label-sm">{mesLargo(mes.mesActual)}</span>
              </div>
              {rubros.length === 0 ? (
                <p className="label-sm" style={{ lineHeight: 1.5 }}>
                  Todavía no hay ventas este mes.
                </p>
              ) : (
                <>
                  <div className="rub">
                    {rubros.map((r, i) => (
                      <div key={r.rubro} className="rub-r">
                        <span className="rub-n">{r.rubro}</span>
                        <span className="rub-v">{plata(r.total)}</span>
                        <div className="rub-bar">
                          <div
                            className="rub-fill"
                            style={{
                              // Escala al PRIMERO, que es el que más facturó.
                              width: `${(Number(r.total) / Number(rubros[0]!.total)) * 100}%`,
                              background: RUBRO_COLOR[i % RUBRO_COLOR.length],
                            }}
                          />
                        </div>
                        <div className="rub-sub">
                          <span>{Number(r.unidades).toLocaleString('es-AR')} unidades</span>
                          <span className="pctm">{r.porcentaje}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* El rubro sale de `products.category`, que es el de HOY:
                      `sale_items` no lo snapshotea. Recategorizar un producto
                      mueve su historia, y eso se dice en vez de callarlo. */}
                  <p className="label-sm" style={{ marginTop: 12, lineHeight: 1.45 }}>
                    Agrupado por el rubro actual de cada producto.
                  </p>
                </>
              )}
            </div>

            <div className="card glass">
              <div className="card-title">
                <h3>
                  <span className="ic" style={{ background: 'rgba(91,140,255,0.15)', color: '#2f5fd0' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="8" r="3.2" />
                      <path d="M2 20c0-3.4 3-5.6 7-5.6s7 2.2 7 5.6" />
                      <path d="M17 11h5M19.5 8.5v5" />
                    </svg>
                  </span>
                  Clientes del mes
                </h3>
                <span className="label-sm">{mesLargo(mes.mesActual)}</span>
              </div>
              <div className="cli-g">
                <div className="cli-c">
                  <div className="cli-n">{clientes.activos}</div>
                  <div className="cli-l">compraron</div>
                </div>
                {/* El color sólo cuando hay algo que colorear: un CERO en
                    verde se lee como "bien", y cero clientes nuevos no lo es.
                    Mismo criterio que el resto del panel — un cero es una
                    afirmación, no un adorno. */}
                <div className="cli-c">
                  <div
                    className="cli-n"
                    style={clientes.nuevos > 0 ? { color: 'var(--green)' } : undefined}
                  >
                    {clientes.nuevos}
                  </div>
                  <div className="cli-l">nuevos</div>
                </div>
                <div className="cli-c">
                  <div
                    className="cli-n"
                    style={clientes.vuelven > 0 ? { color: 'var(--blue)' } : undefined}
                  >
                    {clientes.vuelven}
                  </div>
                  <div className="cli-l">volvieron</div>
                </div>
              </div>

              {/* ── EL NUMERO QUE DECIDE ALGO ──────────────────────────────
                  Un "clientes activos / total" da 100% y no cambia ninguna
                  decisión. Lo que sí decide es cuánta facturación tiene nombre
                  y apellido: eso dice si vale la pena la cuenta corriente o una
                  promo dirigida. Se dibujan LAS DOS partes — sin la gris, un
                  31% se leería como una pérdida. */}
              {clientes.porcentajeIdentificado === null ? (
                <p className="label-sm" style={{ marginTop: 13, lineHeight: 1.5 }}>
                  Sin ventas este mes.
                </p>
              ) : (
                <div className="cli-split">
                  <div className="cli-sb">
                    <i
                      style={{
                        width: `${clientes.porcentajeIdentificado}%`,
                        background: 'var(--blue)',
                      }}
                    />
                  </div>
                  <div className="cli-leg">
                    <span>
                      <b>{clientes.porcentajeIdentificado}%</b> de clientes conocidos ·{' '}
                      {plata(clientes.facturadoIdentificado)}
                    </span>
                    <span>el resto, consumidor final</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ═══ MÁS VENDIDOS ═══ */}
          {masVendidos.length > 0 ? (
            <div className="card glass" style={{ marginTop: 16 }}>
              <div className="card-title">
                <h3>Más vendidos · hoy</h3>
                <Link className="label-sm" href="/productos">
                  Ver productos →
                </Link>
              </div>
              {masVendidos.map((p, i) => (
                <div key={p.nombre} className="mv-row">
                  <span className="mv-pos">{i + 1}</span>
                  <div className="mv-cuerpo">
                    <div className="mv-top">
                      <span className="mv-nombre">{p.nombre}</span>
                      <span className="mv-u tnum">{Number(p.unidades)} u</span>
                    </div>
                    <div className="mv-pista">
                      <div
                        className="mv-barra"
                        style={{ width: `${(Number(p.total) / topVendido) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="mv-monto tnum">{plata(p.total)}</span>
                </div>
              ))}
            </div>
          ) : null}

          {/* ═══ ÚLTIMAS VENTAS ═══ */}
          <div className="card glass" style={{ marginTop: 16 }}>
            <div className="card-title">
              <h3>Últimas ventas</h3>
              <Link className="label-sm" href="/pos">
                Ir al POS →
              </Link>
            </div>
            {ultimas.length === 0 ? (
              <div className="label-sm" style={{ lineHeight: 1.5 }}>
                Todavía no hay ventas cobradas. La primera va a aparecer acá.
              </div>
            ) : (
              ultimas.map((v) => (
                <div key={v.id} className="tx-row">
                  <span
                    className="tx-ic"
                    style={{ background: medioColor(v.medio) }}
                    aria-hidden
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <div>
                    <div className="tx-name">
                      {v.cliente === '' ? 'Consumidor final' : v.cliente}
                    </div>
                    <div className="tx-sub">
                      {v.hora} · {v.items} ítem{v.items === '1' ? '' : 's'}
                    </div>
                  </div>
                  <span
                    className="pay-pill"
                    style={{
                      background: `${medioColor(v.medio)}1f`,
                      color: medioColor(v.medio),
                    }}
                  >
                    {medioLabel(v.medio)}
                  </span>
                  <span className="tx-amount">{plataC(v.total)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ═══════════════ COLUMNA DERECHA ═══════════════ */}
        <div className="col-side">
          <Link className="cta" href="/pos">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13 2 3 14h8l-1 8 10-12h-8z" />
            </svg>
            Nueva venta
          </Link>

          {/* Anillo: el día contra el mismo día de la semana pasada. La maqueta
              mostraba una "meta del día" de $400.000 que nadie fijó nunca. */}
          <section className="card glass" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div className="ring-wrap">
                <svg viewBox="0 0 80 80" width="78" height="78">
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    fill="none"
                    stroke="rgba(107,95,255,0.13)"
                    strokeWidth="9"
                  />
                  {ratio !== null ? (
                    <circle
                      cx="40"
                      cy="40"
                      r="34"
                      fill="none"
                      stroke="url(#ringg)"
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeDasharray={CIRC.toFixed(1)}
                      strokeDashoffset={(CIRC - dash).toFixed(1)}
                      transform="rotate(-90 40 40)"
                    />
                  ) : null}
                  <defs>
                    <linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#6b5fff" />
                      <stop offset="100%" stopColor="#5b8cff" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="ring-ctr">
                  <div className="ring-pct">{pct === null ? '—' : `${pct}%`}</div>
                </div>
              </div>
              <div>
                <div className="upper-mini">Contra la semana pasada</div>
                <div
                  className="tnum"
                  style={{
                    fontSize: 19,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    marginTop: 4,
                  }}
                >
                  {plata(hoy.total)}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
                  {base === 0
                    ? 'este día de la semana no tiene historia todavía'
                    : `el mismo día pasado: ${plata(hoy.totalSemanaPasada)}`}
                </div>
              </div>
            </div>
          </section>

          {/* ═══ CAJA ═══ */}
          <div className="card glass">
            <div className="card-title">
              <h3>
                <span
                  className="ic"
                  style={{ background: 'rgba(52,199,125,0.13)', color: '#1a8e5a' }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                  >
                    <rect x="2" y="6" width="20" height="12" rx="2" />
                    <circle cx="12" cy="12" r="2.5" />
                  </svg>
                </span>
                Caja
              </h3>
              <span className={caja === null ? 'label-sm' : 'caja-state'}>
                {caja === null ? 'Cerrada' : '● Abierta'}
              </span>
            </div>
            {caja === null ? (
              <>
                <p className="label-sm" style={{ lineHeight: 1.5 }}>
                  No hay una caja abierta. Se abre al empezar el turno, y el
                  efectivo del día se cuenta contra ella.
                </p>
                <AbrirCaja />
              </>
            ) : (
              <>
                {/* La CUENTA, no sólo el resultado. Este número se verifica
                    después contra el cajón: mostrando de qué se compone, el
                    cajero puede cuadrarlo en el momento en vez de confiar. */}
                <div className="kv">
                  <span className="k">Apertura</span>
                  <span className="v">
                    {new Intl.DateTimeFormat('es-AR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'America/Argentina/Ushuaia',
                    }).format(new Date(caja.abierta_at))}{' '}
                    · {plata(caja.initial)}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Cobrado en efectivo</span>
                  <span className="v">{plata(caja.cashSales)}</span>
                </div>
                {Number(caja.customerPayments) > 0 ? (
                  <div className="kv">
                    <span className="k">Cobros de fiado</span>
                    <span className="v">{plata(caja.customerPayments)}</span>
                  </div>
                ) : null}
                {Number(caja.deposits) > 0 ? (
                  <div className="kv">
                    <span className="k">Ingresos a caja</span>
                    <span className="v">{plata(caja.deposits)}</span>
                  </div>
                ) : null}
                {Number(caja.withdraws) > 0 ? (
                  <div className="kv">
                    <span className="k">Retiros</span>
                    <span className="v neg">−{plata(caja.withdraws)}</span>
                  </div>
                ) : null}
                {Number(caja.providerPayments) > 0 ? (
                  <div className="kv">
                    <span className="k">Pagos a proveedores</span>
                    <span className="v neg">−{plata(caja.providerPayments)}</span>
                  </div>
                ) : null}
                <div className="divider" />
                <div className="kv">
                  <span className="k" style={{ fontWeight: 600, color: 'var(--ink-1)' }}>
                    Efectivo en caja
                  </span>
                  <span className="v" style={{ fontSize: 19 }}>
                    {plata(caja.expected)}
                  </span>
                </div>
                {/* Cerrar NO se hace desde acá: el cierre exige contar la
                    plata por denominación, y eso vive en /caja. */}
                <Link
                  className="label-sm"
                  href="/caja"
                  style={{ color: 'var(--purple)', fontWeight: 600 }}
                >
                  Movimientos y cierre →
                </Link>
              </>
            )}
          </div>

          {/* ═══ AFIP — el estado REAL, no un contador inventado ═══ */}
          <div className="card glass">
            <div className="card-title">
              <h3>
                <span
                  className="ic"
                  style={{ background: 'rgba(247,152,74,0.16)', color: '#b9701c' }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  >
                    <path d="M12 9v4M12 17h.01" />
                    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                  </svg>
                </span>
                AFIP
              </h3>
              <span className="afip-pend">Sin conectar</span>
            </div>
            {/* La maqueta mostraba "41 Factura B · CAE último · latencia P95".
                No hay ni una factura emitida: falta el certificado. Un contador
                en 0 diría "hoy no facturaste", que es otra cosa. */}
            <p className="label-sm" style={{ lineHeight: 1.55 }}>
              Pandora todavía <b>no puede emitir facturas</b>: falta cargar el
              certificado digital de ARCA. Las ventas se registran igual y quedan
              listas para facturar cuando esté.
            </p>
            <div className="divider" />
            <div className="kv">
              <span className="k">Ventas sin facturar</span>
              <span className="v">{mes.tickets}</span>
            </div>
            <div className="kv">
              <span className="k">Del mes</span>
              <span className="v">{plata(mes.total)}</span>
            </div>
          </div>

          {/* ═══ POR COBRAR ═══ */}
          {cuentaCorriente.deudores > 0 ? (
            <div className="card glass">
              <div className="card-title">
                <h3>Cuentas corrientes</h3>
                <Link className="label-sm" href="/clientes">
                  Ver →
                </Link>
              </div>
              <div className="kv">
                <span className="k">Por cobrar</span>
                <span className="v" style={{ fontSize: 18, color: '#c0384a' }}>
                  {plata(cuentaCorriente.porCobrar)}
                </span>
              </div>
              <div className="kv">
                <span className="k">Clientes con saldo</span>
                <span className="v">{cuentaCorriente.deudores}</span>
              </div>
            </div>
          ) : null}

          {/* ═══ STOCK BAJO ═══ */}
          {stockBajo.length > 0 ? (
            <div className="card glass">
              <div className="card-title">
                <h3>Reponer</h3>
                <Link className="label-sm" href="/productos">
                  Ver →
                </Link>
              </div>
              {stockBajo.map((p) => (
                <div key={p.nombre} className="stock-row">
                  <span className="stock-name">{p.nombre}</span>
                  <span className="stock-q">
                    {Number(p.stock)} / {Number(p.minimo)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );

  return (
    <AppShell
      storeName={comercio}
      userName={usuario}
      userRole="Dueño"
      afipConnected={false}
      afipDetail="WSFEv1 · sin certificado"
      scroll="pagina"
    >
      {contenido}
    </AppShell>
  );
}
