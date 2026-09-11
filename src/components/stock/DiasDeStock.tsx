/**
 * Días de stock restantes — la primera proyección que muestra Pandora.
 *
 * ── UNA PROYECCION TIENE QUE MOSTRAR DE QUE ESTA HECHA ────────────────────
 * El sesgo de leer un pronóstico como promesa está documentado (§6.2 del
 * brief). Un "4 días" solo no se puede discutir: o se cree o no. Al lado va
 * **sobre cuántos días se calculó** y **cuánto sale por día**, que es lo que
 * permite mirarlo y decir "no, esta semana fue rara".
 *
 * ── Y SI NO HAY CON QUE, NO MUESTRA NUMEROS ───────────────────────────────
 * Antes de las dos semanas de operación el bloque no estima: dice cuánto
 * falta. Un número confiado en la semana 2 es peor que un vanity metric —
 * aquél no cambiaba ninguna decisión, éste cambia la equivocada (comprar de
 * más, o no comprar).
 *
 * ── TRES ESTADOS, NO UN NUMERO ────────────────────────────────────────────
 * "Sin stock" y "le quedan 2 días" **no son la misma urgencia con distinto
 * número**: en el primero el quiebre ya pasó y hace rato que se pierden
 * ventas; en el segundo hay tiempo de llamar al proveedor. Van separados.
 */
import Link from 'next/link';
import {
  clasificar,
  coberturaDeHistoria,
  decirDias,
  esParaElPanel,
  MINIMO_DIAS_HISTORIA,
  ventanaEfectiva,
  type EstadoStock,
} from '@/lib/stock/dias-de-stock';

export interface DiasDeStockItem {
  producto_id: string;
  nombre: string;
  stock: string;
  minimo: string | null;
  vendido: string;
  velocidad: string;
  dias_restantes: string | null;
}

export interface DiasDeStockProps {
  items: DiasDeStockItem[];
  diasDeHistoria: number;
  /** Cuántas filas como máximo. El panel es un resumen, no un listado. */
  limite?: number;
}

const ETIQUETA: Record<EstadoStock, string> = {
  sin_stock: 'Sin stock',
  se_acaba: 'Se acaba',
  sin_rotacion: 'Sin salida',
  holgado: '',
};

/**
 * El color va por CLASE, nunca por `style` inline.
 *
 * Un estilo inline no puede tener variante de modo oscuro. Cuando estos
 * colores estaban ahi, "Sin stock" daba un contraste de 5.84 en claro y
 * **2.65 en oscuro** — medido sampleando pixeles, no leyendo el CSS. El
 * mismo rojo oscuro sobre fondo casi negro. Mismo bug que hubo en `.qa-b`.
 */
const CLASE: Record<EstadoStock, string> = {
  sin_stock: 'ds-tag ds-sin-stock',
  se_acaba: 'ds-tag ds-se-acaba',
  sin_rotacion: 'ds-tag ds-sin-rotacion',
  holgado: 'ds-tag',
};

export function DiasDeStock({ items, diasDeHistoria, limite = 5 }: DiasDeStockProps) {
  const cobertura = coberturaDeHistoria(diasDeHistoria);
  const ventana = ventanaEfectiva(diasDeHistoria);

  // ── Todavía no hay con qué estimar ────────────────────────────────────
  if (!cobertura.alcanza) {
    return (
      <div className="card glass">
        <div className="card-title">
          <h3>Días de stock</h3>
        </div>
        <div className="ds-espera">
          {cobertura.diasDeHistoria === 0
            ? 'Todavía no hay ventas registradas.'
            : `Llevás ${cobertura.diasDeHistoria} ${
                cobertura.diasDeHistoria === 1 ? 'día' : 'días'
              } de ventas.`}
          <span>
            Para estimar cuánto dura el stock hacen falta {MINIMO_DIAS_HISTORIA} días.
            {cobertura.faltanDias > 0
              ? ` Faltan ${cobertura.faltanDias}.`
              : ''}{' '}
            Con menos, un número acá sería adivinar.
          </span>
        </div>
      </div>
    );
  }

  const filas = items
    .map((it) => {
      const stock = Number(it.stock);
      const dias = it.dias_restantes === null ? null : Number(it.dias_restantes);
      return {
        ...it,
        stockNum: stock,
        diasNum: dias,
        estado: clasificar(stock, dias),
      };
    })
    .filter((f) =>
      esParaElPanel({
        estado: f.estado,
        stock: f.stockNum,
        minimo: f.minimo === null ? null : Number(f.minimo),
      })
    )
    .slice(0, limite);

  return (
    <div className="card glass">
      <div className="card-title">
        <h3>Días de stock</h3>
        <Link className="label-sm" href="/productos">
          Ver →
        </Link>
      </div>

      {filas.length === 0 ? (
        <div className="ds-ok">
          No hay nada por acabarse.
          <span>Calculado sobre los últimos {ventana} días.</span>
        </div>
      ) : (
        <>
          {filas.map((f) => (
            <div className="ds-row" key={f.producto_id}>
              <div className="ds-tx">
                <div className="ds-n">{f.nombre}</div>
                {/* De qué está hecho el número. Sin esto no se puede discutir. */}
                <div className="ds-s">
                  {f.estado === 'sin_stock'
                    ? `Vendías ${Number(f.velocidad).toFixed(1)} por día`
                    : f.estado === 'sin_rotacion'
                      ? `Sin ventas en ${ventana} días · quedan ${f.stockNum}`
                      : `${Number(f.velocidad).toFixed(1)} por día · quedan ${f.stockNum}`}
                </div>
              </div>
              <span className={CLASE[f.estado]}>
                {f.estado === 'se_acaba' && f.diasNum !== null
                  ? decirDias(f.diasNum)
                  : ETIQUETA[f.estado]}
              </span>
            </div>
          ))}
          <div className="ds-pie">
            Sobre los últimos {ventana} días de ventas
          </div>
        </>
      )}
    </div>
  );
}
