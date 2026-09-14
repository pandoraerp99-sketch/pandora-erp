'use client';

/**
 * Ajuste manual de stock.
 *
 * No nace de una maqueta: `stock-v2.html` es una pantalla de Stock entera, sin
 * modal de ajuste. Se compone con el vocabulario del modal de producto
 * (`.pmov` / `.pmod` / `.pm-*`) y dos piezas propias (`.aj-*`).
 *
 * La regla es la del dominio (`planDeAjuste`), la MISMA que aplica el service:
 * la pantalla no puede ofrecer algo que el libro rechaza. El service la vuelve
 * a correr igual — esto es para que el botón no se habilite en vano.
 *
 * Decisiones: RESEARCH-BRIEF-ajuste-de-stock.md §5.
 */
import { useState } from 'react';
import Decimal from 'decimal.js';
import {
  AjusteInvalidoError,
  MOTIVOS_AJUSTE,
  MOTIVOS_CORRECCION,
  MOTIVOS_MERMA,
  planDeAjuste,
  type MotivoAjuste,
  type PlanDeAjuste,
} from '@/lib/domain/ajuste-stock';

export interface ProductoAjustable {
  id: string;
  name: string;
  stock_current: string;
  unit_type: string;
}

export interface ErrorDeAjuste {
  mensaje: string;
  campos?: Record<string, string>;
}

interface Props {
  producto: ProductoAjustable;
  pending: boolean;
  error: ErrorDeAjuste | null;
  onCancelar: () => void;
  onConfirmar: (input: { delta: string; motivo: MotivoAjuste; detalle?: string }) => void;
}

/** Cantidad para leer: sin ceros de más y con coma. "28", "1,5". */
export function cantidadLegible(v: string | Decimal): string {
  return new Decimal(v).toDecimalPlaces(4).toString().replace('.', ',');
}

function unidad(unitType: string): string {
  return unitType === 'unidad' ? 'u' : unitType;
}

export function AjusteStockModal({ producto, pending, error, onCancelar, onConfirmar }: Props) {
  const [sentido, setSentido] = useState<'restar' | 'sumar'>('restar');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState<MotivoAjuste | null>(null);
  const [detalle, setDetalle] = useState('');

  const esMerma = motivo !== null && MOTIVOS_AJUSTE[motivo].grupo === 'merma';
  // Una merma sólo resta: con un motivo de merma elegido, "Sumar" no existe.
  const sentidoEfectivo = esMerma ? 'restar' : sentido;

  // Se acepta coma decimal: es como se escribe acá.
  const cant = cantidad.trim().replace(',', '.');
  const delta = cant === '' ? '' : sentidoEfectivo === 'restar' ? `-${cant}` : cant;

  let plan: PlanDeAjuste | null = null;
  let problema: AjusteInvalidoError | null = null;
  if (motivo !== null && cant !== '') {
    try {
      plan = planDeAjuste({ motivo, delta, detalle });
    } catch (e) {
      if (e instanceof AjusteInvalidoError) problema = e;
      else throw e;
    }
  }

  const actual = new Decimal(producto.stock_current);
  const nuevo = plan ? actual.plus(new Decimal(delta)) : null;
  const noAlcanza = nuevo !== null && nuevo.lt(0);
  const u = unidad(producto.unit_type);

  // El error de un campo: primero el del servidor (manda), después el local.
  const errorDe = (campo: 'delta' | 'detalle' | 'motivo') =>
    error?.campos?.[campo] ?? (problema?.campo === campo ? problema.message : null);

  const grupoDeBotones = (lista: readonly MotivoAjuste[]) => (
    <div className="aj-motivos" role="radiogroup">
      {lista.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={motivo === m}
          className={`aj-motivo${motivo === m ? ' on' : ''}`}
          onClick={() => setMotivo(m)}
        >
          {MOTIVOS_AJUSTE[m].label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="pmov open" onClick={onCancelar}>
      <div
        className="pmod"
        role="dialog"
        aria-modal="true"
        aria-label={`Ajustar stock de ${producto.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-head">
          <div>
            <div className="pm-title">Ajustar stock</div>
            <div className="pm-sub">
              {producto.name} · hay <b className="tnum">{cantidadLegible(actual)} {u}</b>
            </div>
          </div>
          <button type="button" className="pm-x" onClick={onCancelar} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="pm-fld">
          <label>Motivo</label>
          <div className="aj-grupo">Merma · sólo resta</div>
          {grupoDeBotones(MOTIVOS_MERMA)}
          <div className="aj-grupo">Corrección</div>
          {grupoDeBotones(MOTIVOS_CORRECCION)}
          {errorDe('motivo') ? <div className="aj-err">{errorDe('motivo')}</div> : null}
        </div>

        <div className="pm-fld">
          <label htmlFor="ajCant">Cantidad</label>
          <div className="aj-seg">
            <button
              type="button"
              className={sentidoEfectivo === 'restar' ? 'on' : undefined}
              onClick={() => setSentido('restar')}
            >
              − Restar
            </button>
            <button
              type="button"
              className={sentidoEfectivo === 'sumar' ? 'on' : undefined}
              onClick={() => setSentido('sumar')}
              disabled={esMerma}
              title={esMerma ? 'Una merma sólo resta stock' : undefined}
            >
              + Sumar
            </button>
          </div>
          <input
            id="ajCant"
            inputMode="decimal"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            placeholder="0"
            aria-invalid={errorDe('delta') ? true : undefined}
          />
          {errorDe('delta') ? <div className="aj-err">{errorDe('delta')}</div> : null}
        </div>

        <div className="pm-fld">
          <label htmlFor="ajDet">
            Detalle {motivo !== null && MOTIVOS_AJUSTE[motivo].detalleObligatorio ? '' : '(opcional)'}
          </label>
          <input
            id="ajDet"
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            placeholder={motivo === 'otro' ? 'Contá qué pasó' : 'Ej: se cayó el pack'}
            maxLength={200}
          />
          {errorDe('detalle') ? <div className="aj-err">{errorDe('detalle')}</div> : null}
        </div>

        {/* El antes → después, en números: es lo que se va a confirmar. */}
        <div className="pm-prev">
          <div className="pc">
            <div className="pk">Hay ahora</div>
            <div className="pv">{cantidadLegible(actual)} {u}</div>
          </div>
          <div className="pc">
            <div className="pk">Va a quedar</div>
            <div className={`pv${noAlcanza ? ' mgbad' : ''}`}>
              {nuevo === null ? '—' : `${cantidadLegible(nuevo)} ${u}`}
            </div>
          </div>
        </div>

        {noAlcanza ? (
          <div className="pm-warn show" role="alert">
            No alcanza: hay {cantidadLegible(actual)} {u} y el ajuste resta{' '}
            {cantidadLegible(new Decimal(delta).abs())}. El stock no puede quedar en negativo.
          </div>
        ) : null}

        {error && !error.campos ? (
          <div className="pm-warn show" role="alert">
            {error.mensaje}
          </div>
        ) : null}

        <div className="pm-note">
          Queda en el <b>historial</b> con la fecha de hoy y tu usuario. No se edita
          ni se borra: si te equivocás, se corrige con otro ajuste.
        </div>

        <div className="pm-acts">
          <button type="button" className="pm-btn ghost" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className="pm-btn primary"
            disabled={pending || plan === null || noAlcanza}
            onClick={() => {
              if (plan === null || motivo === null) return;
              onConfirmar({
                delta,
                motivo,
                detalle: detalle.trim() === '' ? undefined : detalle.trim(),
              });
            }}
          >
            {pending ? 'Registrando…' : 'Registrar ajuste'}
          </button>
        </div>
      </div>
    </div>
  );
}
