'use client';

/**
 * El calendario del mes, con los días pintados según lo que se vendió.
 *
 * ── POR QUE UN CALENDARIO PINTADO Y NO UNA GRILLA DE NUMEROS ──────────────
 * Un calendario que sólo muestra del 1 al 30 no aporta nada: eso ya está en el
 * teléfono. Pintando cada día según lo facturado, la grilla es además un
 * gráfico — se ve el patrón semanal, el día flojo y el efecto del feriado sin
 * leer un solo número.
 *
 * ── "CERRE" Y "NO TENGO EL DATO" SE PINTAN DISTINTO ───────────────────────
 * Un día con cero ventas es una afirmación: ese día no entró plata. Un día
 * fuera del rango cargado es otra cosa: no sabemos. Si los dos se dibujaran
 * igual, el calendario diría que el comercio estuvo cerrado seis meses antes de
 * existir. Van con tratamiento distinto y con la leyenda que lo explica.
 *
 * ── SIN `new Date(iso)` ───────────────────────────────────────────────────
 * Parsear '2026-09-10' con `new Date` lo interpreta como medianoche UTC, que en
 * Ushuaia es el día ANTERIOR a las 21:00. Toda la aritmética de fechas de acá
 * usa enteros y `Date.UTC`, igual que los helpers del Panel.
 */
import { useMemo, useState } from 'react';
import {
  claveDeDia,
  diaDeSemanaLunesPrimero,
  diasDelMes,
  moverMes,
  partesDeFecha,
} from '@/lib/calendar/fechas';

export interface DiaVentas {
  dia: string;
  total: string;
  tickets: string;
}

export interface Feriado {
  fecha: string;
  nombre: string;
  tipo: string;
  jurisdiction: string;
  nota: string | null;
}

export interface Cobertura {
  anio: number;
  jurisdiction: string;
  completo: boolean;
  nota: string | null;
  verified_at: string;
}

export interface CalendarioMesProps {
  dias: DiaVentas[];
  feriados: Feriado[];
  cobertura: Cobertura[];
  /** Hoy, según el comercio. Lo calcula el servidor: ver `page.tsx`. */
  hoy: string;
  formato: (v: string) => string;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Los tipos que son feriado de verdad. El asueto provincial NO lo es. */
const ES_FERIADO_NACIONAL = new Set(['inamovible', 'trasladable', 'turistico', 'no_laborable']);

export function CalendarioMes({ dias, feriados, cobertura, hoy, formato }: CalendarioMesProps) {
  const [anioHoy, mesHoy] = partesDeFecha(hoy);
  const [ver, setVer] = useState<{ anio: number; mes: number }>({ anio: anioHoy, mes: mesHoy });
  const [elegido, setElegido] = useState<string | null>(null);

  const porDia = useMemo(() => {
    const m = new Map<string, DiaVentas>();
    for (const d of dias) m.set(d.dia, d);
    return m;
  }, [dias]);

  const porFecha = useMemo(() => {
    const m = new Map<string, Feriado[]>();
    for (const f of feriados) {
      const prev = m.get(f.fecha);
      if (prev) prev.push(f);
      else m.set(f.fecha, [f]);
    }
    return m;
  }, [feriados]);

  const celdas = useMemo(() => {
    const { anio, mes } = ver;
    const total = diasDelMes(anio, mes);
    const offset = diaDeSemanaLunesPrimero(anio, mes, 1);
    // El máximo del MES que se está viendo, no de toda la serie: si se escalara
    // contra el récord histórico, un mes flojo se vería entero en blanco y no
    // se distinguiría un día de otro.
    let max = 0;
    const items: Array<{
      dia: number;
      clave: string;
      venta: DiaVentas | undefined;
      feriados: Feriado[];
    }> = [];
    for (let d = 1; d <= total; d++) {
      const clave = claveDeDia(anio, mes, d);
      const venta = porDia.get(clave);
      if (venta) max = Math.max(max, Number(venta.total));
      items.push({ dia: d, clave, venta, feriados: porFecha.get(clave) ?? [] });
    }
    return { offset, items, max };
  }, [ver, porDia, porFecha]);

  const mover = (paso: number) => {
    setVer((v) => moverMes(v.anio, v.mes, paso));
    setElegido(null);
  };

  // Cobertura del año que se está mirando. Sin fila, no tenemos el calendario:
  // se dice, en vez de dibujar un año sin feriados.
  const delAnio = cobertura.filter((c) => c.anio === ver.anio);
  const avisoCobertura =
    delAnio.length === 0
      ? `Todavía no está cargado el calendario de feriados de ${ver.anio}.`
      : delAnio.find((c) => !c.completo)?.nota ?? null;

  const elegidoVenta = elegido === null ? undefined : porDia.get(elegido);
  const elegidoFeriados = elegido === null ? [] : porFecha.get(elegido) ?? [];

  return (
    <>
      <div className="cal-head">
        <div className="card-title" style={{ margin: 0 }}>
          <h3>
            Calendario · <span className="cal-mes">{MESES[ver.mes - 1]} {ver.anio}</span>
          </h3>
        </div>
        <div className="cal-nav">
          <button type="button" onClick={() => mover(-1)} aria-label="Mes anterior">‹</button>
          <button
            type="button"
            onClick={() => { setVer({ anio: anioHoy, mes: mesHoy }); setElegido(null); }}
            className="cal-hoy-btn"
          >
            Hoy
          </button>
          <button type="button" onClick={() => mover(1)} aria-label="Mes siguiente">›</button>
        </div>
      </div>

      <div className="cal-grid" role="grid">
        {DOW.map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {Array.from({ length: celdas.offset }, (_, i) => (
          <div key={`v${i}`} className="cal-day empty" />
        ))}
        {celdas.items.map((c) => {
          const esHoy = c.clave === hoy;
          const feriadoNac = c.feriados.some((f) => ES_FERIADO_NACIONAL.has(f.tipo));
          const asueto = c.feriados.some((f) => f.tipo === 'asueto_provincial');
          // Tres estados distintos, no dos:
          //   futuro  — todavía no pasó. No falta nada.
          //   sinDato — anterior al rango cargado. No sabemos.
          //   cero    — pasó y no entró plata. Es una afirmación.
          // Rayar el futuro como "sin datos" llenaba de trama media tarjeta y
          // se leía como que algo estaba roto. Medido sobre el render: 20 de 30
          // celdas de septiembre.
          const futuro = c.clave > hoy;
          const sinDato = !futuro && c.venta === undefined;
          const monto = c.venta === undefined ? 0 : Number(c.venta.total);
          const intensidad = celdas.max === 0 || monto === 0 ? 0 : 0.10 + (monto / celdas.max) * 0.34;
          const clases = [
            'cal-day',
            esHoy ? 'today' : '',
            futuro ? 'futuro' : '',
            sinDato ? 'sindato' : '',
            feriadoNac ? 'feriado nac' : '',
            asueto ? 'feriado prov' : '',
            elegido === c.clave ? 'sel' : '',
          ].filter(Boolean).join(' ');
          const titulo = [
            c.feriados.map((f) => f.nombre).join(' · '),
            futuro
              ? 'todavía no pasó'
              : sinDato
                ? 'sin datos'
                : `${formato(c.venta!.total)} · ${c.venta!.tickets} tickets`,
          ].filter(Boolean).join(' — ');
          return (
            <button
              type="button"
              key={c.clave}
              className={clases}
              title={titulo}
              aria-label={`${c.dia} de ${MESES[ver.mes - 1]} — ${titulo}`}
              onClick={() => setElegido(elegido === c.clave ? null : c.clave)}
              style={
                futuro || sinDato || intensidad === 0
                  ? undefined
                  : { background: `rgba(107,95,255,${intensidad.toFixed(3)})` }
              }
            >
              {c.dia}
              {c.feriados.length > 0 ? (
                <span className="ev">
                  <i className={asueto && !feriadoNac ? 'prov' : 'nac'} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span><i style={{ background: 'rgba(107,95,255,0.42)' }} />Más ventas</span>
        <span><i style={{ background: 'rgba(107,95,255,0.12)' }} />Menos</span>
        <span><i className="lg-cero" />Sin ventas</span>
        <span><i className="lg-sindato" />Sin datos</span>
        <span><i className="lg-futuro" />Todavía no</span>
        <span><i className="lg-nac" />Feriado nacional</span>
        <span><i className="lg-prov" />Asueto provincial</span>
        <span><i className="lg-hoy" />Hoy</span>
      </div>

      {elegido === null ? null : (
        <div className="cal-detail">
          <div className="cal-detail-day">
            {(() => {
              const [, m, d] = partesDeFecha(elegido);
              return `${d} de ${MESES[m - 1]}`;
            })()}
          </div>
          {elegidoFeriados.map((f) => (
            <div key={f.nombre} className="cal-fer">
              <b>{f.nombre}</b>
              {/* El asueto provincial no obliga al comercio. Decirlo es el punto
                  entero de haberlo separado de los feriados nacionales. */}
              {f.nota === null ? null : <span className="cal-fer-nota">{f.nota}</span>}
            </div>
          ))}
          {elegido > hoy ? (
            <div className="label-sm">Todavía no pasó.</div>
          ) : elegidoVenta === undefined ? (
            <div className="label-sm">No hay datos de ventas para ese día.</div>
          ) : Number(elegidoVenta.total) === 0 ? (
            <div className="label-sm">Sin ventas ese día.</div>
          ) : (
            <div className="cal-detail-kv">
              <span>
                <b className="tnum">{formato(elegidoVenta.total)}</b> facturado
              </span>
              <span>
                <b className="tnum">{elegidoVenta.tickets}</b> tickets
              </span>
            </div>
          )}
        </div>
      )}

      {avisoCobertura === null ? null : (
        <div className="cal-aviso">{avisoCobertura}</div>
      )}
    </>
  );
}
