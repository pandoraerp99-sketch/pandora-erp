'use client';

/**
 * Proyección de cierre de mes.
 *
 * ── LA REGLA QUE MANDA ACÁ ─────────────────────────────────────────────────
 * `RESEARCH-BRIEF-calendario-y-proyecciones` §6.2: la proyección **nunca va
 * sola**. Siempre con las tres cosas que la sostienen — sobre cuántos días se
 * calculó, cuál es el promedio diario, y cuánto falta del mes. Un número solo
 * (`$2.400.000`) se lee como promesa; con su base al lado se puede discutir.
 *
 * Y si la base es corta, NO se muestra número: se dice cuánto falta.
 *
 * ── POR QUÉ LA PALABRA "PROYECCIÓN" ESTÁ EN GRANDE ─────────────────────────
 * `RESEARCH-BRIEF-panel.md` §7 tenía esto DESCARTADO: *"un número grande en la
 * pantalla de inicio se lee como promesa"*. El trigger para reabrirlo era
 * literalmente "sólo con rótulo explícito". El rótulo no es decoración: es la
 * condición bajo la cual el bloque existe.
 *
 * ── POR QUÉ NO COINCIDE CON "FACTURACIÓN DEL MES" ──────────────────────────
 * Esa tarjeta muestra lo que va del mes INCLUIDO hoy. La base de acá son los
 * días TERMINADOS: hoy está a medio andar y contarlo como día completo haría
 * que la proyección baje sola a lo largo de la mañana. Los dos números son
 * correctos y distintos, así que el bloque dice cuáles días mira — igual que
 * Rentabilidad dice qué porción de lo facturado cubre.
 */
import type { Proyeccion } from '@/lib/reporting/cierre-de-mes';

/**
 * ⚠️ Formateador local a propósito: `formatARS` arrastra
 * `money/policy → env.ts` (variables del SERVIDOR) al bundle del cliente y
 * tumba la página entera con "Environment validation failed". Ver el comentario
 * largo en `MargenDelMes.tsx`.
 */
const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const pesos = (v: string | null) => {
  if (v === null) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? PESOS.format(n) : '—';
};

const plural = (n: number, singular: string, plural_: string) =>
  `${n} ${n === 1 ? singular : plural_}`;

export function CierreDeMes({ p }: { p: Proyeccion }) {
  return (
    <section className="card glass">
      <div className="card-title">
        <h3>Cierre de mes</h3>
        <span className="upper-mini">Proyección</span>
      </div>

      {p.estado === 'sin_base' ? (
        <div className="pr-espera">
          Todavía no alcanza el mes para proyectar.
          <span>
            Faltan {plural(p.diasParaPoder, 'día', 'días')} de operación para
            que el ritmo signifique algo. Antes de eso, cualquier número diría
            más sobre el azar de estos días que sobre el mes.
          </span>
          {p.diasBase > 0 && (
            <span>
              Van {pesos(p.acumuladoCompletos)} en{' '}
              {plural(p.diasBase, 'día terminado', 'días terminados')}.
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="pr-num">{pesos(p.proyectado)}</div>
          <div className="pr-aviso">
            Es una proyección al ritmo actual, no un compromiso.
          </div>

          {/* Las tres patas de §6.2. Sin esto el número no puede estar. */}
          <div className="pr-base">
            <div className="pr-item">
              <span className="pr-k">Base</span>
              <span className="pr-v">
                {plural(p.diasBase, 'día terminado', 'días terminados')}
              </span>
              <span className="pr-n">hoy no cuenta: está a medio andar</span>
            </div>
            <div className="pr-item">
              <span className="pr-k">Promedio por día</span>
              <span className="pr-v">{pesos(p.promedioDiario)}</span>
              <span className="pr-n">
                sobre {pesos(p.acumuladoCompletos)} facturados
              </span>
            </div>
            <div className="pr-item">
              <span className="pr-k">Falta del mes</span>
              <span className="pr-v">
                {plural(p.diasQueFaltan, 'día', 'días')}
              </span>
              <span className="pr-n">de {p.diasDelMes}, contando hoy</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
