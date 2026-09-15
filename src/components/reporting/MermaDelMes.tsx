'use client';

/**
 * Stock y merma — la tarjeta de inventario del Panel (RESEARCH-BRIEF-panel §8.e).
 *
 * Composición nueva: la maqueta del panel no tiene este bloque. Reusa el
 * vocabulario visual que ya existe y ya tiene modo oscuro — el número grande de
 * Cierre de mes (`pr-*`), la nota de cobertura y la tabla de Rentabilidad
 * (`mg-*`) — en vez de inventar clases nuevas.
 *
 * Toda la decisión de qué se puede afirmar vive en `src/lib/reporting/merma.ts`.
 * Acá sólo se pinta. Las palabras importan tanto como los números:
 *
 *   - "Sin mermas CARGADAS", nunca "sin merma": que nadie haya registrado una
 *     rotura no prueba que no la hubo.
 *   - Las unidades sin costo se dicen como unidades; no se convierten en $0.
 *   - "A costo de última compra": no es el costo PEPS del inventario al cierre,
 *     y no sirve para comparar meses. La pantalla lo dice.
 */
import {
  calcularMerma,
  calcularValorStock,
  type CrudoMermaMotivo,
  type CrudoMermaProducto,
  type CrudoValorStock,
} from '@/lib/reporting/merma';
import { MOTIVOS_AJUSTE, type MotivoAjuste } from '@/lib/domain/ajuste-stock';

/**
 * ⚠️ NO usar `formatARS` de `@/lib/money/format`: arrastra `env.ts` al bundle del
 * navegador y el panel entero se cae. Ver el mismo aviso en MargenDelMes.tsx.
 */
const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const UNIDADES = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function pesos(v: string | null): string {
  if (v === null) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? PESOS.format(n) : '—';
}

function unidades(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${UNIDADES.format(n)} u` : '—';
}

/** Las mismas palabras que el formulario de ajuste. */
function etiqueta(motivo: string): string {
  return MOTIVOS_AJUSTE[motivo as MotivoAjuste]?.label ?? motivo;
}

/**
 * El nombre del mes a partir del día del COMERCIO que manda el servidor.
 *
 * Con `timeZone: 'UTC'` sobre el mediodía de ese día: un componente cliente se
 * pinta dos veces (servidor en UTC, navegador en UTC-3), y formatear un
 * `new Date()` local daría dos meses distintos el último día a la noche.
 */
function nombreDelMes(hoyComercio: string): string {
  return new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${hoyComercio}T12:00:00Z`)
  );
}

export interface MermaDelMesProps {
  motivos: CrudoMermaMotivo[];
  productos: CrudoMermaProducto[];
  correcciones: Array<{ motivo: string; filas: number }>;
  valorStock: CrudoValorStock;
  hoyComercio: string;
}

export function MermaDelMes({
  motivos,
  productos,
  correcciones,
  valorStock,
  hoyComercio,
}: MermaDelMesProps) {
  const merma = calcularMerma(motivos, productos);
  const stock = calcularValorStock(valorStock);
  const mes = nombreDelMes(hoyComercio);
  const totalCorrecciones = correcciones.reduce((s, c) => s + c.filas, 0);

  return (
    <section className="card glass mm-card">
      <div className="card-title">
        <h3>Stock y merma</h3>
        <span className="upper-mini">{mes}</span>
      </div>

      {/* ── Plata en stock ── */}
      <div className="pr-item">
        <span className="pr-k">Plata en stock</span>
        <span className="pr-v">
          {stock.estado === 'sin_stock'
            ? 'sin stock'
            : stock.estado === 'sin_costo'
              ? 'sin costo cargado'
              : pesos(stock.valor)}
        </span>
        <span className="pr-n">
          a costo de última compra
          {stock.productosSinCosto > 0 &&
            ` · ${stock.productosSinCosto} de ${stock.productosConStock} productos con stock no tienen costo y no están en la cuenta`}
        </span>
      </div>

      <div className="pr-base" style={{ marginTop: 11 }}>
        {merma.estado === 'sin_merma' ? (
          <div className="mg-espera">
            Sin mermas cargadas en {mes}.
            <span>
              Una rotura, un vencimiento o un faltante se cargan desde Productos →
              Ajustar stock. Que no haya ninguna cargada no quiere decir que no las
              hubo.
            </span>
          </div>
        ) : (
          <>
            <div>
              <div className="pr-num">
                {merma.estado === 'sin_costo' ? unidades(merma.unidades) : pesos(merma.costo)}
              </div>
              <div className="pr-aviso">
                {merma.estado === 'sin_costo'
                  ? `perdidas en ${mes} · sin costo cargado para valorizarlas`
                  : `perdidos en mermas de ${mes} · a costo de última compra`}
              </div>
            </div>

            {merma.estado === 'parcial' && (
              <p className="mg-cobertura">
                Además, {unidades(merma.unidadesSinCosto)} de productos sin costo cargado
                no están en los pesos.
              </p>
            )}

            {merma.porMotivo.map((m) => (
              <div key={m.motivo} className="pr-item">
                <span className="pr-k">{etiqueta(m.motivo)}</span>
                <span className="pr-v">
                  {merma.estado === 'sin_costo' ? unidades(m.unidades) : pesos(m.costo)}
                </span>
                <span className="pr-n">
                  {unidades(m.unidades)} · {m.movimientos}{' '}
                  {m.movimientos === 1 ? 'carga' : 'cargas'}
                  {m.participacionPct !== null &&
                    ` · ${m.participacionPct.toFixed(0)}% de la merma`}
                </span>
              </div>
            ))}

            {merma.productos.length > 0 && (
              <table className="mg-tbl" style={{ marginTop: 4 }}>
                <thead>
                  <tr>
                    <th>Lo que más se pierde</th>
                    <th className="mg-r">Unidades</th>
                    <th className="mg-r">Pérdida</th>
                  </tr>
                </thead>
                <tbody>
                  {merma.productos.map((p) => (
                    <tr key={p.product_id}>
                      <td className="mg-nombre">{p.nombre}</td>
                      <td className="mg-r mono">{unidades(p.unidades)}</td>
                      <td className="mg-r">
                        {p.costo === null ? (
                          <span className="mg-tag mg-sin-dato">sin costo</span>
                        ) : (
                          <span className="mono">{pesos(p.costo)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {totalCorrecciones > 0 && (
          <div className="pr-item">
            <span className="pr-k">Correcciones cargadas</span>
            <span className="pr-v">{totalCorrecciones}</span>
            <span className="pr-n">
              {correcciones
                .map((c) => `${c.filas} ${etiqueta(c.motivo).toLowerCase()}`)
                .join(' · ')}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
