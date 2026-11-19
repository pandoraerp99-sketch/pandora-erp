'use client';

/**
 * La columna de la derecha de "Cargar gasto": lo del mes y lo último cargado.
 * Es la de la maqueta (`facturas-v4.html`, pestaña Gastos).
 *
 * "Gastos del mes" es SIEMPRE el mes en curso, aunque el libro tenga elegido
 * otro período: al cargar, lo que sirve es ver cómo va este mes. El número
 * grande es la suma de las MISMAS filas que dibujan las barras (devengado por
 * fecha del gasto, como "Por categoría"); si fuera `resumen.total` ("plata que
 * salió"), el número y las barras podrían no coincidir y nadie sabría por qué.
 */
import Decimal from 'decimal.js';
import { catClase, catLabel, fechaCorta, medioLabel, plata } from './gastosFormato';

export interface MesCargaDTO {
  /** Cómo se llama el mes, para el título ("noviembre 2026"). */
  etiqueta: string;
  total: string;
  porCategoria: Array<{ categoria: string; total: string }>;
}

export interface GastoRecienteDTO {
  id: string;
  fecha: string;
  categoria: string;
  payee_name: string | null;
  descripcion: string | null;
  total: string;
  medio_pago: string;
}

/** Ancho de la barra: parte del total del mes, en %, con un decimal. */
function ancho(parte: string, total: string): string {
  const t = new Decimal(total);
  if (t.lte(0)) return '0%';
  return `${new Decimal(parte).div(t).times(100).toDecimalPlaces(1).toString()}%`;
}

export function ResumenCarga({
  mes,
  recientes,
}: {
  mes: MesCargaDTO;
  recientes: GastoRecienteDTO[];
}) {
  const filas = [...mes.porCategoria]
    .filter((c) => new Decimal(c.total).gt(0))
    .sort((a, b) => new Decimal(b.total).cmp(new Decimal(a.total)));

  return (
    <div className="cg-side">
      <section className="card glass-strong" aria-labelledby="cgMesTit">
        <div className="card-title">
          <h3 id="cgMesTit">Gastos del mes</h3>
          <span className="upper-mini">{mes.etiqueta}</span>
        </div>
        <div className="gbig">{plata(mes.total)}</div>
        {filas.length === 0 ? (
          <p className="cg-vacio">Todavía no hay gastos cargados este mes.</p>
        ) : (
          <ul className="gsum">
            {filas.map((c) => (
              <li key={c.categoria} className={`gsum-item ${catClase(c.categoria)}`}>
                <div className="gsum-head">
                  <span className="gsdot" aria-hidden="true" />
                  <span className="gsname">{catLabel(c.categoria)}</span>
                  <span className="gsval">{plata(c.total)}</span>
                </div>
                <div className="gsbar" aria-hidden="true">
                  <i style={{ width: ancho(c.total, mes.total) }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card glass" aria-labelledby="cgUltTit">
        <div className="card-title">
          <h3 id="cgUltTit">Últimos gastos</h3>
        </div>
        {recientes.length === 0 ? (
          <p className="cg-vacio">Cuando registres un gasto, aparece acá.</p>
        ) : (
          <ul className="cg-ult">
            {recientes.map((g) => (
              <li key={g.id} className="gasto-row">
                <span className={`gcat ${catClase(g.categoria)}`}>{catLabel(g.categoria)}</span>
                <div className="gtxt">
                  <div className="gconcepto">
                    {g.payee_name ?? g.descripcion ?? `${catLabel(g.categoria)} sin proveedor`}
                  </div>
                  <div className="gsub">
                    {g.medio_pago === 'cuenta_corriente'
                      ? 'Cuenta corriente'
                      : medioLabel(g.medio_pago)}{' '}
                    · {fechaCorta(g.fecha)}
                  </div>
                </div>
                <span className="gmonto">−{plata(g.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
