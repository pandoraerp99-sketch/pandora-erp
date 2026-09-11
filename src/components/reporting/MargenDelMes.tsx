'use client';

/**
 * Rentabilidad del mes — margen bruto histórico.
 *
 * ── QUÉ ES ESTE BLOQUE Y QUÉ NO ────────────────────────────────────────────
 * Es una **composición nueva**, no un port. La maqueta del panel no tiene
 * tarjeta de margen; la de "Rentabilidad por producto" vive en
 * `reportes-v2.html`, que es otra pantalla y todavía no existe en la app. De
 * ahí se toma el tratamiento visual (tabla con números a la derecha, el margen
 * como pastilla de color) y de `ofertas.html` el umbral y las palabras, para
 * que un 14% no signifique una cosa en Ofertas y otra acá.
 *
 * El brief lo tenía descartado con un trigger explícito —"`sale_items` NO
 * guarda el costo"— y ese trigger se cumplió con la migration 0031.
 *
 * ── LOS TRES ESTADOS ───────────────────────────────────────────────────────
 * Toda la decisión vive en `src/lib/reporting/margen.ts`. Acá sólo se pinta:
 *   - `sin_datos` → NO se muestra número. Se dice qué falta.
 *   - `parcial`   → número + qué porción de lo facturado cubre.
 *   - `completo`  → número, sin nota.
 *
 * El color nunca va inline: va por clase, porque un `style` no puede tener
 * variante de modo oscuro y eso ya rompió el contraste dos veces (`.qa-b` y
 * los badges de días de stock, medidos en 2.65 — falla WCAG AA).
 */
import {
  calcularMargen,
  rentabilidadDe,
  colorDelMargen,
  decirMargen,
  decirPct,
  type CrudoMargen,
  type CrudoProducto,
  type ColorMargen,
} from '@/lib/reporting/margen';
/**
 * ⚠️ NO usar `formatARS` de `@/lib/money/format` acá.
 *
 * La cadena es `format.ts → decimal.ts → policy.ts → env.ts`, y `env.ts` valida
 * las variables del SERVIDOR (DATABASE_URL, JWT_SECRET, …). Importarlo desde un
 * componente cliente lo mete en el bundle del navegador, donde esas variables
 * no existen: el panel entero se cae con "Environment validation failed" y la
 * pantalla queda en "This page couldn't load". Medido, no supuesto.
 *
 * Por eso el resto de las pantallas (GastosClient, ProductosClient) también
 * tienen su propio `Intl.NumberFormat` en vez de importar el helper. No es
 * duplicación por descuido.
 */
const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

/** La plata llega en string y se formatea sin pasar por aritmética. */
function pesos(v: string | null): string {
  if (v === null) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? PESOS.format(n) : '—';
}

/** El color es una CLASE, nunca un `style` inline. */
const CLASE: Record<ColorMargen, string> = {
  sano: 'mg-sano',
  ajustado: 'mg-ajustado',
  bajo_costo: 'mg-bajo-costo',
  sin_dato: 'mg-sin-dato',
};

const ENTEROS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export function MargenDelMes({
  crudo,
  productos,
}: {
  crudo: CrudoMargen;
  productos: CrudoProducto[];
}) {
  const m = calcularMargen(crudo);
  const filas = productos.map(rentabilidadDe);

  return (
    <section className="card glass">
      <div className="card-title">
        <h3>Rentabilidad</h3>
        <span className="upper-mini">Margen del mes</span>
      </div>

      {m.estado === 'sin_datos' ? (
        <div className="mg-espera">
          Todavía no hay ninguna venta del mes con el costo registrado.
          <span>
            El costo se guarda en cada venta desde que el producto lo tiene
            cargado. Cargalo en Productos y el margen empieza a calcularse solo
            — hacia atrás no se puede reconstruir.
          </span>
          {m.facturadoTotal !== '0.0000' && (
            <span>
              Este mes se facturaron {pesos(m.facturadoTotal)} en{' '}
              {ENTEROS.format(m.lineasTotal)} líneas.
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="mg-head">
            <div>
              <div className={`mg-big ${CLASE[colorDelMargen(m.margenPct)]}`}>
                {pesos(m.margen)}
              </div>
              <div className="mg-sub">
                sobre {pesos(m.facturadoConCosto)} facturados
              </div>
            </div>
            <span className={`mg-pill ${CLASE[colorDelMargen(m.margenPct)]}`}>
              {decirMargen(m.margenPct)}
            </span>
          </div>

          {m.estado === 'parcial' && (
            <p className="mg-cobertura">
              Cubre el {decirPct(m.coberturaPct)} de lo facturado del mes.{' '}
              {ENTEROS.format(m.lineasSinCosto)} de {ENTEROS.format(m.lineasTotal)}{' '}
              líneas se vendieron sin costo cargado y quedan afuera de la cuenta.
            </p>
          )}

          {filas.length > 0 && (
            <table className="mg-tbl">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="mg-r">Facturado</th>
                  <th className="mg-r">Margen</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.product_id}>
                    <td className="mg-nombre">{f.nombre}</td>
                    <td className="mg-r mono">
                      {pesos(f.facturado)}
                    </td>
                    <td className="mg-r">
                      <span className={`mg-tag ${CLASE[colorDelMargen(f.margenPct)]}`}>
                        {f.margenPct === null ? 'sin costo' : decirPct(f.margenPct)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
