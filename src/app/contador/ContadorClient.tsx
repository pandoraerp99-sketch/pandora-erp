'use client';

/**
 * Panel de la contadora.
 *
 * Maqueta: `pos-preview/contador-v2.html`. El selector de empresas es la fila
 * de chips `.emp-bar` / `.emp-chip` de la maqueta.
 *
 * Todo lo que se muestra sale de datos reales. Lo que no se puede calcular
 * todavía se declara, con el motivo — ver el bloque "Todavía no disponible".
 */
import { useState, useTransition } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { CONTADOR_CSS } from './contadorCss';
import { cambiarEmpresaAction, exportarVentasCsvAction } from './actions';

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
}

interface Props {
  empresas: Array<{ id: string; name: string }>;
  empresaActivaId: string;
  empresaActivaNombre: string;
  esContador: boolean;
  resumen: ResumenDTO;
  usuario: string;
}

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const plata = (v: string) => PESOS.format(Number(v));

/** Las cifras de la banda superior, con los valores de la maqueta. */
const ESTILO_CIFRA: React.CSSProperties = {
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
 * Lo que la maqueta muestra y todavía no se puede calcular.
 *
 * Se listan con el MOTIVO, no como paneles vacíos. Un contador que ve "IVA
 * crédito: $0" archiva ese número; uno que lee "no hay compras cargadas" sabe
 * que falta trabajo.
 */
const PENDIENTES: Array<{ que: string; porque: string }> = [
  {
    que: 'IVA crédito y posición de IVA',
    porque: 'todavía no se cargan facturas de compra',
  },
  {
    que: 'Estado de resultados',
    porque: 'falta registrar los gastos del comercio',
  },
  {
    que: 'Asientos contables',
    porque: 'no hay plan de cuentas definido',
  },
  {
    que: 'Retenciones y percepciones',
    porque: 'no se registran todavía',
  },
  {
    que: 'IIBB · Tierra del Fuego (AREF)',
    porque: 'falta la parametrización provincial',
  },
  {
    que: 'Conciliación de banco y MercadoPago',
    porque: 'no se importan extractos',
  },
  {
    que: 'Número de comprobante en el export',
    porque: 'todavía no se emite ante AFIP: falta el certificado',
  },
];

export function ContadorClient({
  empresas,
  empresaActivaId,
  empresaActivaNombre,
  esContador,
  resumen,
  usuario,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cambiar = (id: string) => {
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
      const res = await exportarVentasCsvAction(resumen.periodo.desde);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // La descarga la arma el navegador: el CSV ya está en memoria.
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.nombre;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const contenido = (
    <>
      <style>{CONTADOR_CSS}</style>

      <div className="bar">
        <div className="bar-id">
          <span className="bar-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M8 13h8M8 17h5" />
            </svg>
          </span>
          <div>
            <div className="bar-title">Contador</div>
            <div className="bar-sub">
              {empresaActivaNombre} · <b>{resumen.periodo.etiqueta}</b>
            </div>
          </div>
        </div>
        <div className="bar-actions">
          <button
            type="button"
            className="b primary"
            onClick={exportar}
            disabled={pending || resumen.ventas.cantidad === 0}
            title={
              resumen.ventas.cantidad === 0
                ? 'No hay ventas en el período'
                : undefined
            }
          >
            {pending ? 'Preparando…' : 'Exportar ventas (CSV)'}
          </button>
        </div>
      </div>

      {/* Selector de empresas: el diferenciador. Un login, N comercios. */}
      {esContador && empresas.length > 0 ? (
        <div className="emp-bar">
          <span className="emp-lbl">Empresas:</span>
          {empresas.map((e) => (
            <button
              key={e.id}
              type="button"
              className={e.id === empresaActivaId ? 'emp-chip on' : 'emp-chip'}
              onClick={() => cambiar(e.id)}
              disabled={pending}
            >
              {e.name}
            </button>
          ))}
        </div>
      ) : null}

      {error !== null ? (
        <p className="label-sm" style={{ color: '#c0384a', marginBottom: 12 }}>
          {error}
        </p>
      ) : null}

      {/* La banda de arriba de la maqueta: NO son tarjetas KPI (esta maqueta
          no tiene .kpis — eso es de Clientes). Es una card glass-strong con
          las cifras en linea, cada una .upper-mini + .tnum. */}
      <div
        className="card glass-strong"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          padding: '15px 22px',
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '0 0 auto' }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 700,
              color: 'var(--ink)',
              letterSpacing: '-0.01em',
            }}
          >
            Tu mes, sin cargar un dato a mano
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
            Pandora lo organiza; vos revisás, aprobás y presentás.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 34, marginLeft: 'auto' }}>
          <div>
            <div className="upper-mini">Ventas del período</div>
            <div className="tnum" style={ESTILO_CIFRA}>
              {plata(resumen.ventas.total)}
            </div>
          </div>
          <div>
            <div className="upper-mini">IVA débito</div>
            <div className="tnum" style={ESTILO_CIFRA}>
              {plata(resumen.ventas.iva)}
            </div>
          </div>
          <div>
            <div className="upper-mini">Exento · Ley 19.640</div>
            <div className="tnum" style={ESTILO_CIFRA}>
              {plata(resumen.ventas.exento)}
            </div>
          </div>
          <div>
            <div className="upper-mini">Comprobantes</div>
            <div className="tnum" style={ESTILO_CIFRA}>
              {resumen.ventas.cantidad}
            </div>
          </div>
          <div>
            <div className="upper-mini">Por cobrar</div>
            <div
              className="tnum"
              style={{
                ...ESTILO_CIFRA,
                color:
                  resumen.cuentasCorrientes.deudores > 0 ? '#c0384a' : undefined,
              }}
            >
              {plata(resumen.cuentasCorrientes.porCobrar)}
            </div>
          </div>
        </div>
      </div>

      <div className="content">
        <div className="col-main">
          <div className="card glass">
            <div className="card-title">
              <h3>Cobros por medio de pago</h3>
              <span className="label-sm">{resumen.periodo.etiqueta}</span>
            </div>
            {resumen.medios.length === 0 ? (
              <p className="label-sm">No hubo cobros en el período.</p>
            ) : (
              resumen.medios.map((m) => (
                <div className="tx-row" key={m.medio}>
                  <span />
                  <div>{MEDIO_LABEL[m.medio] ?? m.medio}</div>
                  <span className="label-sm">
                    {m.cantidad === 1 ? '1 cobro' : `${m.cantidad} cobros`}
                  </span>
                  <span className="tnum" style={{ fontWeight: 600 }}>
                    {plata(m.total)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="card glass">
            <div className="card-title">
              <h3>Cierres de caja</h3>
              <span className="label-sm">{resumen.periodo.etiqueta}</span>
            </div>
            <div className="cd-stats">
              <div>
                <div className="upper-mini">Cierres</div>
                <div className="tnum cd-sv">{resumen.caja.cierres}</div>
              </div>
              <div>
                <div className="upper-mini">Con descuadre</div>
                <div className="tnum cd-sv">{resumen.caja.conDescuadre}</div>
              </div>
              <div>
                <div className="upper-mini">Diferencia total</div>
                <div className="tnum cd-sv">
                  {plata(resumen.caja.descuadreTotal)}
                </div>
              </div>
            </div>
            <p className="label-sm" style={{ marginTop: 10 }}>
              La diferencia es la suma de los descuadres en valor absoluto: un
              faltante y un sobrante no se cancelan entre sí.
            </p>
          </div>
        </div>

        <aside className="col-side" style={{ width: 320 }}>
          <div className="card glass">
            <div className="card-title">
              <h3>Todavía no disponible</h3>
            </div>
            <p className="label-sm" style={{ marginBottom: 10 }}>
              Se declara en vez de mostrarse en cero: un panel vacío se lee como
              &quot;no hubo movimiento&quot;.
            </p>
            {PENDIENTES.map((p) => (
              <div className="tx-row" key={p.que}>
                <span />
                <div>
                  <div style={{ fontWeight: 600 }}>{p.que}</div>
                  <div className="label-sm">{p.porque}</div>
                </div>
                <span />
                <span />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );

  return (
    <AppShell
      userName={usuario}
      userRole={esContador ? 'Contador' : 'Dueño'}
      storeName={empresaActivaNombre}
      // La pantalla scrollea como un documento, igual que Caja: es para leer,
      // no para operar contra reloj.
      scroll="pagina"
    >
      {contenido}
    </AppShell>
  );
}
