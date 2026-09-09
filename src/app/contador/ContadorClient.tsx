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
import { AppShell } from '@/components/shell/AppShell';
import { CONTADOR_CSS } from './contadorCss';
import { cambiarEmpresaAction, exportarVentasCsvAction } from './actions';

export type Grano = 'mes' | 'trimestre' | 'anio';

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
  deudores: Array<{ nombre: string; saldo: string }>;
  usuario: string;
}

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const plata = (v: string) => PESOS.format(Number(v));

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

const GRANOS: Array<{ valor: Grano; label: string }> = [
  { valor: 'mes', label: 'Mes' },
  { valor: 'trimestre', label: 'Trimestre' },
  { valor: 'anio', label: 'Año' },
];

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
  {
    que: 'Detalle de proveedores/acreedores al cierre',
    porque: 'el gasto se registra pagado; no hay cuenta corriente de proveedores',
  },
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
  deudores,
  usuario,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cambiarGrano = (g: Grano) => {
    const url = new URL(window.location.href);
    url.searchParams.set('periodo', g);
    window.location.href = url.toString();
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

  const exportar = () => {
    setError(null);
    startTransition(async () => {
      const res = await exportarVentasCsvAction(resumen.periodo.desde, grano);
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
            className="emp-chip"
            disabled
            title="La invitación la hace el dueño del comercio desde su cuenta. Esa pantalla todavía no está."
            style={{
              border: '1.5px dashed rgba(107,95,255,0.45)',
              color: 'var(--purple)',
              background: 'rgba(107,95,255,0.06)',
              fontWeight: 600,
            }}
          >
            + Invitar empresa
          </button>
        </div>

        {error !== null ? (
          <p className="label-sm" style={{ color: '#c0384a' }}>
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
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              flex: '0 0 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background:
                'linear-gradient(150deg,rgba(52,199,125,0.18),rgba(107,95,255,0.12))',
              color: '#1a8e5a',
            }}
          >
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
              <div className="tnum" style={{ ...CIFRA, color: '#1a8e5a' }}>
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
              <div className="iva-pos">
                <span>Saldo a pagar</span>
                <span className="iva-amt tnum">
                  {plata(
                    (
                      Number(resumen.ventas.iva) - Number(resumen.gastos.credito)
                    ).toFixed(2)
                  )}
                </span>
              </div>
            ) : (
              <div className="iva-pos">
                <span>Saldo a pagar</span>
                <span
                  className="label-sm"
                  style={{ color: '#b96c1a', textAlign: 'right', maxWidth: 200 }}
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
            {/* La maqueta pone "Estado de Resultados" acá. Necesita costo de
                mercadería vendida y gastos, que no se registran: daría un
                resultado inventado. */}
            <p className="label-sm" style={{ marginTop: 12 }}>
              El Estado de Resultados necesita el costo de mercadería vendida y
              los gastos, que todavía no se registran.
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
                  <div className="cs-k">Total</div>
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
              <p className="label-sm">
                Los que tienen factura el estudio ya los baja de ARCA; los otros{' '}
                <b>
                  {resumen.gastos.cantidad - resumen.gastos.comprobantes}
                </b>{' '}
                son los que hay que mandarle.
              </p>
            </>
          )}
        </section>

        <div className="sec-h2">{H2_ICONO}Cuentas corrientes</div>
        <section className="card glass">
          <div className="card-title">
            <h3>Deudores</h3>
            <span className="upper-mini">saldo a hoy</span>
          </div>
          <div className="cc-2">
            <div className="cc-box">
              <div className="cc-bk">Total por cobrar</div>
              <div
                className="cc-bv tnum"
                style={
                  resumen.cuentasCorrientes.deudores > 0
                    ? { color: '#c0384a' }
                    : undefined
                }
              >
                {plata(resumen.cuentasCorrientes.porCobrar)}
              </div>
            </div>
            <div className="cc-box">
              <div className="cc-bk">Clientes con deuda</div>
              <div className="cc-bv tnum">
                {resumen.cuentasCorrientes.deudores}
              </div>
            </div>
          </div>
          {deudores.length === 0 ? (
            <p className="label-sm">Nadie debe: todas las cuentas al día.</p>
          ) : (
            <div className="cc-list">
              {deudores.map((d) => (
                <div className="cc-row" key={d.nombre}>
                  <span className="cc-av">{iniciales(d.nombre)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>{d.nombre}</div>
                  <span className="cc-m">{plata(d.saldo)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="label-sm" style={{ marginTop: 10 }}>
            Es el saldo a HOY, no del período: la deuda no se reinicia cada mes.
          </p>
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
