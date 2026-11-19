/**
 * CSS propio de la pantalla de Caja — extraido de public/caja.html (la maqueta
 * que se servia en /caja) y filtrado por script para dejar SOLO lo que el
 * AppShell compartido no define.
 *
 * Por que existe: Caja tenia su copia entera del sistema de diseno
 * (mockupCss.ts, 674 lineas) que duplicaba el shell. Al montar Caja sobre
 * <AppShell> esa duplicacion pisaba el shell. Ahora hay UNA sola fuente del
 * shell (shellCss.ts) y esto es solo lo especifico: alivios, denominacion,
 * arqueo por medio, Lectura X, modales y reconciliacion.
 *
 * NO editar a mano: regenerar con el script de split contra la maqueta.
 *
 * ── MODO OSCURO (2026-09-16) ──────────────────────────────────────────────
 * Hasta hoy esta pantalla se veía ENTERA EN CLARO con el tema oscuro puesto:
 * la luna aparecía y no hacía nada. Tenía seis parches sueltos y le faltaba el
 * núcleo, pero sobre todo le faltaban CUATRO TOKENS que define su propio
 * `:root` y el núcleo no conoce (`--ink-0`, `--blue-2`, y los alias viejos
 * `--glass-border` / `--glass-shadow`): con el borde blanco y la sombra clara
 * puestos por token, repintar el fondo no alcanzaba.
 *
 * El bloque oscuro va al FINAL, después del `:root` de arriba — ese es el
 * orden que hace que `html[data-theme="dark"]` gane. Medido con
 * `scripts/tokens-y-colores-claros.sh`.
 */
import { OSCURO_NUCLEO } from '../_css/tema-oscuro';

export const CAJA_CSS = `
:root{
  /* Tokens que usa Caja y el shell del POS no define. Mismos valores del
     sistema; solo cambian de nombre por drift entre mockups. */
  --ink-0:#0d1424;
  --blue:#5b8cff; --blue-2:#8eb0ff;
  --orange:#f7984a; --pink:#ee6a8e;
  --r-md:14px; --r-lg:20px;
  --font:'Inter',ui-sans-serif,system-ui,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,monospace;
  /* Alias de la receta glass: caja usa nombres viejos, shell los nuevos. */
  --glass-border:rgba(255,255,255,0.85);
  --glass-shadow:0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 32px rgba(54,70,120,0.10), 0 2px 8px rgba(54,70,120,0.06);
}

/* ── Radio de los bordes en el glass ──────────────────────────────────────
   La .glass del POS NO define border-radius: allá cada componente pone el
   suyo (.card 16px, .catalog 20px, .cart 20px). La .glass de la maqueta de
   CAJA sí lo traía (var(--r-lg)), y las cards de esta pantalla dependen de
   eso. Al unificar el shell esa regla se perdió y quedaba TODO CUADRADO
   (bug 2026-09-03).

   Sólo aplica mientras Caja está montada: la hoja de estilos vive dentro del
   componente, así que no le toca el radio a ninguna otra pantalla.

   OJO al editar este archivo: NO escribir la etiqueta de estilo literal en los
   comentarios. React la escapa al serializar en el servidor (para que el
   navegador no cierre la etiqueta antes de tiempo) y en el cliente queda cruda
   → error de hidratación por texto que no coincide. Pasó de verdad. */
.glass, .glass-strong { border-radius:var(--r-lg); }

.tnum { font-variant-numeric:tabular-nums; }

.mono { font-family:var(--mono); }

/* ===== Sidebar ===== */
  .side {
    position:fixed; left:10px; top:10px; bottom:10px; width:210px;
    padding:22px 14px 18px; display:flex; flex-direction:column; z-index:10; border-radius:var(--r-lg);
  }

.nav { display:flex; flex-direction:column; gap:3px; flex:1; overflow-y:auto; min-height:0; padding-right:4px; margin-right:-4px; }

.afip-chip {
    margin-top:auto; margin-bottom:12px; padding:11px 12px; border-radius:14px;
    background:rgba(52,199,125,0.10); border:1px solid rgba(52,199,125,0.28);
    box-shadow:0 1px 0 rgba(255,255,255,0.6) inset;
  }

.afip-title { font-size:11.5px; font-weight:700; color:#1a7a4a; letter-spacing:-0.01em; }

.afip-badge { margin-left:auto; font-size:8.5px; font-weight:700; color:var(--green); letter-spacing:0.06em; font-family:var(--mono); }

.live-dot { width:8px; height:8px; border-radius:999px; background:var(--green); position:relative; display:inline-block; flex-shrink:0; }

.live-dot::after {
    content:''; position:absolute; inset:-4px; border-radius:999px; background:var(--green);
    opacity:0.4; animation:liveRing 1.8s cubic-bezier(.2,.7,.2,1) infinite;
  }

/* session bar */
  .session-bar { display:flex; align-items:center; gap:24px; padding:16px 20px; margin-bottom:18px; }
/* La maqueta usa el interlineado del navegador; la app hereda 1,5 y la barra
   medía 91px contra 80 (estilos computados, 2026-11-18). */
.session-bar { line-height:normal; }

.session-title { font-size:24px; font-weight:700; letter-spacing:-0.03em; color:var(--ink-0); }

.session-sub { font-size:12.5px; color:var(--ink-3); margin-top:2px; }

.session-meta { display:flex; align-items:center; gap:26px; }

.session-glance { margin:0 auto; display:flex; align-items:center; gap:22px; }

.sg { display:flex; flex-direction:column; gap:3px; }

.sg-k { font-size:9.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.07em; font-family:var(--mono); font-weight:500; }

.sg-v { font-size:16px; font-weight:600; color:var(--ink-0); font-family:var(--mono); letter-spacing:-0.01em; }

.sg-div { width:1px; height:26px; background:rgba(13,20,36,0.08); }

.meta-cell { display:flex; flex-direction:column; gap:3px; }

.meta-k { font-size:10px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.08em; font-family:var(--mono); font-weight:500; }

.meta-v { font-size:13.5px; font-weight:600; color:var(--ink-1); display:flex; align-items:center; gap:7px; }

.pill-open {
    display:inline-flex; align-items:center; gap:7px; padding:7px 13px; border-radius:999px;
    background:rgba(52,199,125,0.13); color:#1a8e5a; font-size:12.5px; font-weight:600;
  }

.pill-closed {
    display:inline-flex; align-items:center; gap:7px; padding:7px 13px; border-radius:999px;
    background:rgba(120,129,168,0.16); color:var(--ink-2); font-size:12.5px; font-weight:600;
  }

.cerrada-ov{ position:fixed; inset:0; z-index:90; display:none; align-items:center; justify-content:center; padding:24px; background:rgba(13,20,36,0.30); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); }

.cerrada-card{ width:400px; max-width:100%; padding:34px 30px 28px; border-radius:22px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:5px; animation:aliAdjIn 240ms ease; }

.cerrada-ic{ width:58px; height:58px; border-radius:17px; display:flex; align-items:center; justify-content:center; background:rgba(120,129,168,0.14); color:var(--ink-2); margin-bottom:8px; }

.cerrada-card h2{ font-size:21px; font-weight:700; letter-spacing:-0.02em; }

.cerrada-card p{ font-size:13px; color:var(--ink-2); line-height:1.5; max-width:300px; margin-top:2px; }

.cerrada-last{ font-size:11.5px; color:var(--ink-3); margin:6px 0 14px; }

.abrir-dif{ margin-top:9px; font-size:11.5px; font-weight:700; text-align:center; padding:8px 10px; border-radius:9px; line-height:1.35; }

.abrir-dif.ok{ background:rgba(52,199,125,0.13); color:#1a8e5a; }

.abrir-dif.falta{ background:rgba(247,152,74,0.16); color:#b96c1a; }

.abrir-dif.sobra{ background:rgba(91,140,255,0.13); color:#3a63c0; }

#abrirDenomToggle.on{ background:rgba(107,95,255,0.12); color:var(--purple); border-color:rgba(107,95,255,0.28); }

.mini-ava { width:30px; height:30px; border-radius:999px; background:linear-gradient(135deg,var(--purple),var(--blue));
    display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px; font-weight:600;
    border:2px solid rgba(255,255,255,0.85); flex-shrink:0; }

.caja-grid { display:grid; grid-template-columns:1fr 384px; gap:18px; align-items:start; }

.col { display:flex; flex-direction:column; gap:18px; }

.card-title { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }

.card-title h3 { margin:0; font-size:14.5px; font-weight:600; color:var(--ink-0); letter-spacing:-0.01em; display:flex; align-items:center; gap:8px; }

.upper-mini { font-size:10.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.08em; font-family:var(--mono); font-weight:500; }

.more-btn { background:none; border:none; color:var(--ink-3); cursor:pointer; padding:4px; border-radius:6px; display:inline-flex; transition:all 180ms; }

.more-btn:hover { color:var(--ink-0); background:rgba(13,20,36,0.05); }

/* Efectivo card */
  .cash-card { padding:24px 26px; overflow:hidden; }

.cash-top { display:flex; align-items:flex-start; justify-content:space-between; }

.cash-num { font-family:var(--mono); font-size:52px; font-weight:600; letter-spacing:-0.02em; line-height:1; color:var(--ink-0); margin:6px 0 0; }

.cash-sub { display:flex; gap:28px; margin-top:18px; }
.mov-pedido { color:var(--ink-3); font-size:12px; }

.cash-sub .k { font-size:11px; color:var(--ink-3); font-weight:500; }

.cash-sub .v { font-family:var(--mono); font-size:16px; font-weight:500; color:var(--ink-1); margin-top:3px; }

.cash-icon {
    width:46px; height:46px; border-radius:13px; display:flex; align-items:center; justify-content:center;
    background:rgba(107,95,255,0.10); color:var(--purple); flex-shrink:0;
  }

.cash-actions { display:flex; gap:9px; margin-top:22px; }

.btn {
    display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:10px 16px;
    border-radius:11px; font-size:13px; font-weight:600; font-family:var(--font); cursor:pointer;
    border:1px solid var(--glass-border); background:var(--glass-bg-2);
    color:var(--ink-1); transition:all 180ms; box-shadow:0 1px 0 rgba(255,255,255,0.7) inset, 0 2px 6px rgba(54,70,120,0.05);
  }

.btn:hover { transform:translateY(-1px); color:var(--ink-0); }

/* Medios de pago */
  .pay-wrap { display:grid; grid-template-columns:172px 1fr; gap:24px; align-items:center; }

.donut-wrap { position:relative; width:172px; height:172px; }

.donut-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }

.donut-center .big { font-family:var(--mono); font-size:20px; font-weight:600; letter-spacing:-0.02em; color:var(--ink-0); }

.donut-center .lbl { font-size:10px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.08em; font-family:var(--mono); margin-top:2px; }

.pay-list { display:flex; flex-direction:column; gap:14px; }

.pay-row { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:11px; }

.pay-dot { width:10px; height:10px; border-radius:3px; flex-shrink:0; }

.pay-name { font-size:13px; font-weight:500; color:var(--ink-1); }

.pay-tick { font-size:11px; color:var(--ink-3); margin-top:2px; }

.pay-amt { font-family:var(--mono); font-size:14.5px; font-weight:500; color:var(--ink-0); text-align:right; }

.pay-pct { font-size:11px; color:var(--ink-3); font-family:var(--mono); text-align:right; margin-top:2px; }

/* movimientos manuales */
  .mov-cols { display:grid; grid-template-columns:1fr 1fr; gap:0; }

.mov-cols > div:first-child { padding-right:22px; border-right:1px solid rgba(13,20,36,0.07); }

.mov-cols > div:last-child { padding-left:22px; }

.mov-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:13px; }

.mov-head .t { font-size:12px; font-weight:600; color:var(--ink-2); display:flex; align-items:center; gap:7px; }

.mov-head .sum { font-family:var(--mono); font-size:13.5px; font-weight:600; }

.mov-item { display:flex; align-items:center; gap:11px; padding:9px 0; border-top:1px solid rgba(13,20,36,0.05); }

.mov-item:first-of-type { border-top:none; }

.mov-ic { width:30px; height:30px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }

/* Ingreso / egreso. Estaban como style inline en el componente — mismos
   valores, ahora en clase para que el modo oscuro pueda pisarlos. */
.mov-ic.ing { background:rgba(52,199,125,0.12); color:#1a8e5a; }

.mov-ic.egr { background:rgba(239,93,106,0.12); color:var(--red); }

.mov-txt { flex:1; min-width:0; }

.mov-r { font-size:12.5px; font-weight:500; color:var(--ink-1); }

.mov-h { font-size:11px; color:var(--ink-3); font-family:var(--mono); margin-top:1px; }

.mov-v { font-family:var(--mono); font-size:13.5px; font-weight:500; }

/* tabla últimos movimientos */
  .tbl { width:100%; border-collapse:collapse; }

.tbl th {
    text-align:left; font-size:10px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.08em;
    font-family:var(--mono); font-weight:500; padding:0 0 11px; border-bottom:1px solid rgba(13,20,36,0.07);
  }

.tbl th.r, .tbl td.r { text-align:right; }

.tbl td { padding:12px 0; border-top:1px solid rgba(13,20,36,0.05); font-size:13px; color:var(--ink-1); vertical-align:middle; }

.tbl tr:first-child td { border-top:none; }

.tbl .hora { font-family:var(--mono); font-size:12.5px; color:var(--ink-2); }

.tbl .amt { font-family:var(--mono); font-size:13.5px; font-weight:500; }

.tipo-chip { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; }

.tipo-ic { width:24px; height:24px; border-radius:7px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }

.medio-chip { display:inline-flex; align-items:center; gap:7px; font-size:12.5px; color:var(--ink-2); }

.medio-sw { width:8px; height:8px; border-radius:2.5px; flex-shrink:0; }

.medio-sw.mixto { background:linear-gradient(135deg,#34c77d 0 50%,#5b8cff 50% 100%); }

.medio-split { font-size:10px; color:var(--ink-4); margin-left:3px; }

.cbte-ref { font-family:var(--mono); font-size:12px; color:var(--ink-2); }

/* últimos movimientos — filtro por medio + scroll (10 visibles) */
  .mov-filters { display:flex; flex-wrap:wrap; gap:7px; margin:2px 0 14px; }

.mov-fchip {
    display:inline-flex; align-items:center; gap:7px; font-size:11.5px; font-weight:600;
    padding:6px 12px; border-radius:999px; cursor:pointer;
    background:rgba(255,255,255,0.30); border:1px solid rgba(13,20,36,0.07); color:var(--ink-3);
    -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px);
    transition:transform 160ms cubic-bezier(0.16,1,0.3,1), background 160ms, border-color 160ms, color 160ms, box-shadow 160ms;
  }

.mov-fchip .fsw { width:8px; height:8px; border-radius:2.5px; opacity:0.4; transition:opacity 160ms, box-shadow 160ms; }

.mov-fchip:hover { transform:translateY(-1px); border-color:rgba(107,95,255,0.28); color:var(--ink-2); }

.mov-fchip[aria-pressed="true"] {
    background:var(--glass-bg-2); border-color:rgba(107,95,255,0.32); color:var(--ink-1);
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.8), 0 3px 10px rgba(54,70,120,0.10);
  }

.mov-fchip[aria-pressed="true"] .fsw { opacity:1; box-shadow:0 0 0 2.5px rgba(255,255,255,0.6); }

.mov-fchip[aria-pressed="true"]:hover { border-color:rgba(107,95,255,0.5); }

.mov-scroll { max-height:400px; overflow-y:auto; }

.mov-scroll thead th {
    position:sticky; top:0; z-index:1; padding:7px 0 11px;
    background:linear-gradient(rgba(255,255,255,0.90), rgba(255,255,255,0.62));
    -webkit-backdrop-filter:blur(10px) saturate(140%); backdrop-filter:blur(10px) saturate(140%);
  }

.mov-empty { text-align:center; padding:28px 10px; color:var(--ink-3); font-size:12.5px; }

.mov-empty b { color:var(--purple); cursor:pointer; }

/* reasignar el medio de una venta (corrige mala clasificación) */
  .medio-edit { cursor:pointer; position:relative; border-radius:8px; transition:background 140ms; }

.medio-edit:hover { background:rgba(107,95,255,0.06); }

.medio-edit:focus-visible { outline:2px solid var(--purple); outline-offset:-2px; }

.medio-edit .medio-edit-ic { display:inline-flex; vertical-align:middle; margin-left:7px; color:var(--purple); opacity:0.32; transition:opacity 140ms; }

.medio-edit:hover .medio-edit-ic, .medio-edit:focus-visible .medio-edit-ic { opacity:0.9; }

.mov-corr { margin-left:8px; font-size:9.5px; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; font-family:var(--mono); color:#1a8e5a; background:rgba(52,199,125,0.14); padding:2px 7px; border-radius:6px; vertical-align:middle; }

.reasign-cur { font-size:13px; color:var(--ink-2); }

.reasign-cur b { color:var(--ink-0); }

.reasign-pick { display:grid; grid-template-columns:1fr 1fr; gap:8px; }

.reasign-opt { display:inline-flex; align-items:center; gap:8px; padding:10px 12px; border-radius:11px; font-size:13px; font-weight:600; color:var(--ink-1); background:rgba(255,255,255,0.5); border:1px solid rgba(13,20,36,0.08); cursor:pointer; transition:all 150ms; text-align:left; }

.reasign-opt:hover:not(:disabled) { border-color:rgba(107,95,255,0.4); transform:translateY(-1px); }

.reasign-opt.sel { background:var(--glass-bg-2); border-color:var(--purple); box-shadow:0 0 0 3px rgba(107,95,255,0.12); }

.reasign-opt:disabled { opacity:0.5; cursor:default; }

.reasign-sw { width:9px; height:9px; border-radius:3px; flex:0 0 auto; }

.reasign-cur-tag { font-size:9px; font-weight:700; text-transform:uppercase; font-family:var(--mono); color:var(--ink-4); margin-left:auto; }

.reasign-impact { background:rgba(107,95,255,0.06); border:1px solid rgba(107,95,255,0.16); border-radius:12px; padding:11px 13px; }

.reasign-imp-h { font-size:9.5px; text-transform:uppercase; letter-spacing:0.07em; font-family:var(--mono); color:var(--ink-3); font-weight:600; margin-bottom:7px; }

.reasign-imp-row { display:flex; align-items:center; justify-content:space-between; font-size:12.5px; color:var(--ink-1); padding:3px 0; }

.reasign-imp-row > span { display:inline-flex; align-items:center; gap:7px; }

.reasign-imp-row b { font-family:var(--mono); }

.rm.flash { animation:rmFlash 1000ms ease-out; border-radius:12px; }

.toast { position:fixed; left:50%; bottom:26px; transform:translate(-50%,16px); z-index:200; max-width:440px; padding:12px 18px; border-radius:13px; background:var(--glass-bg-2); -webkit-backdrop-filter:blur(24px) saturate(150%); backdrop-filter:blur(24px) saturate(150%); border:1px solid var(--glass-border); box-shadow:var(--glass-shadow); font-size:12.5px; font-weight:600; color:var(--ink-1); opacity:0; transition:opacity 280ms, transform 280ms cubic-bezier(0.16,1,0.3,1); pointer-events:none; }

.toast.show { opacity:1; transform:translate(-50%,0); }

/* editor de reparto de pago (estilo lisCobro) — TODO namespaced rs-* para no
     cruzarse con el arqueo (.rm/#efContado) ni el modal de denominación (.dq) */
  .rs-bar { height:6px; border-radius:99px; background:rgba(13,20,36,0.08); overflow:hidden; }

.rs-bar-fill { height:100%; width:0%; border-radius:99px; background:linear-gradient(90deg,var(--purple),var(--purple-2)); transition:width 240ms cubic-bezier(.2,.8,.2,1); }

.rs-bar-fill.done { background:linear-gradient(90deg,#1f9d63,#34c77d); }

.rs-stat { display:flex; justify-content:space-between; align-items:baseline; font-size:11.5px; color:var(--ink-3); }

.rs-stat b { font-family:var(--mono); font-size:13px; font-weight:700; color:var(--ink-0); margin-left:3px; font-variant-numeric:tabular-nums; }

#rs-rem-wrap.done, #rs-rem-wrap.done b { color:#1a8e5a; }

.rs-rows { display:flex; flex-direction:column; gap:6px; }

.rs-row { display:flex; align-items:center; gap:9px; padding:8px 10px; border-radius:11px; cursor:pointer; background:rgba(255,255,255,0.5); border:1.5px solid rgba(13,20,36,0.08); transition:all 140ms; }

.rs-row.active { border-color:var(--purple); background:rgba(107,95,255,0.07); }

.rs-sw { width:9px; height:9px; border-radius:3px; flex:0 0 auto; }

.rs-n { flex:1; font-size:12.5px; font-weight:600; color:var(--ink-1); }

.rs-f { display:flex; align-items:center; gap:3px; padding:5px 9px; border-radius:9px; background:rgba(13,20,36,0.04); border:1px solid rgba(13,20,36,0.08); transition:all 140ms; }

.rs-row.active .rs-f { background:rgba(107,95,255,0.09); border-color:rgba(107,95,255,0.4); }

.rs-c { font-family:var(--mono); font-size:12px; font-weight:700; color:var(--ink-4); }

.rs-row.active .rs-c { color:var(--purple); }

.rs-in { width:74px; text-align:right; font-family:var(--mono); font-size:14.5px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--ink-0); background:transparent; border:none; outline:none; padding:0; caret-color:var(--purple); }

.rs-in.zero { color:var(--ink-4); }

.rs-row.active .rs-in { color:var(--purple); }

.rs-in::placeholder { color:var(--ink-4); }

.rs-fill { width:100%; display:flex; align-items:center; justify-content:center; gap:7px; padding:9px; border-radius:11px; font-size:12px; font-weight:600; color:var(--purple); background:rgba(107,95,255,0.08); border:1px solid rgba(107,95,255,0.22); cursor:pointer; transition:all 140ms; }

.rs-fill:hover { background:rgba(107,95,255,0.14); }

.rs-fill b { font-weight:700; }

.rs-hint { font-size:10.5px; color:var(--ink-4); text-align:center; margin:-3px 0 -1px; }

.rs-numpad { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }

.rs-numpad button { height:38px; border-radius:10px; font-family:var(--mono); font-size:16px; font-weight:600; color:var(--ink-0); background:rgba(255,255,255,0.55); border:1px solid rgba(13,20,36,0.08); cursor:pointer; transition:all 120ms; }

.rs-numpad button:hover { background:#fff; }

.rs-numpad button:active { transform:scale(0.95); background:rgba(107,95,255,0.10); }

.rs-numpad button.bk { color:var(--ink-3); }

/* pedido sin medio (bloquea el cierre) */
  .pedido-alert { margin-top:16px; padding:13px 15px; border-radius:13px; background:rgba(247,152,74,0.10); border:1px solid rgba(247,152,74,0.28); }

.pedido-alert.hidden { display:none; }

.pedido-alert-h { display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:700; color:#c46a1f; }

.pedido-alert-h svg { width:15px; height:15px; flex:0 0 auto; }

.pedido-row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px; font-size:12px; color:var(--ink-1); }

.pedido-row .cbte-ref { font-weight:600; }

.pedido-assign { display:inline-flex; gap:5px; flex-wrap:wrap; }

.pedido-assign button { font-size:10.5px; font-weight:600; padding:4px 9px; border-radius:8px; border:1px solid rgba(13,20,36,0.12); background:rgba(255,255,255,0.65); color:var(--ink-1); cursor:pointer; transition:all 140ms; }

.pedido-assign button:hover { border-color:var(--purple); color:var(--purple); }

.pedido-hint { font-size:11px; color:var(--ink-2); margin-top:9px; line-height:1.45; }

.pedido-hint b { color:#c46a1f; }

/* arqueo */
  .arqueo { padding:22px 22px 24px; }

.arq-row { display:flex; align-items:center; justify-content:space-between; padding:14px 0; border-top:1px solid rgba(13,20,36,0.06); }

.arq-row:first-of-type { border-top:none; }

.arq-k { font-size:13px; color:var(--ink-2); font-weight:500; }

.arq-v { font-family:var(--mono); font-size:16px; font-weight:500; color:var(--ink-0); }

.arq-input-wrap { position:relative; }

.arq-input {
    width:148px; text-align:right; font-family:var(--mono); font-size:16px; font-weight:500; color:var(--ink-0);
    padding:9px 12px 9px 24px; border-radius:10px; border:1px solid rgba(107,95,255,0.35);
    background:rgba(255,255,255,0.85); outline:none; box-shadow:0 0 0 3px rgba(107,95,255,0.08);
  }

.arq-input:focus { border-color:var(--purple); box-shadow:0 0 0 4px rgba(107,95,255,0.14); }

.arq-peso { position:absolute; left:11px; top:50%; transform:translateY(-50%); font-family:var(--mono); font-size:15px; color:var(--ink-3); pointer-events:none; }

.diff-box {
    display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-radius:13px; margin-top:6px;
  }

.diff-box.faltante { background:rgba(239,93,106,0.10); border:1px solid rgba(239,93,106,0.25); }

.diff-box.sobrante { background:rgba(52,199,125,0.10); border:1px solid rgba(52,199,125,0.25); }

.diff-box.ok { background:rgba(52,199,125,0.10); border:1px solid rgba(52,199,125,0.25); }

.diff-k { font-size:12.5px; font-weight:600; }

.diff-v { font-family:var(--mono); font-size:20px; font-weight:600; }

.c-red { color:var(--red); }

.c-green { color:#1a8e5a; }

.c-ink { color:var(--ink-0); }

.motivo-lbl { font-size:11.5px; color:var(--ink-2); font-weight:500; margin:16px 0 7px; display:flex; align-items:center; gap:6px; }

.req { color:var(--red); font-size:10px; font-weight:700; font-family:var(--mono); }

.motivo-input {
    width:100%; font-family:var(--font); font-size:12.5px; color:var(--ink-0);
    padding:10px 12px; border-radius:10px; border:1px solid rgba(13,20,36,0.12);
    background:rgba(255,255,255,0.7); outline:none; resize:none; min-height:58px;
  }

.motivo-input:focus { border-color:rgba(107,95,255,0.45); box-shadow:0 0 0 3px rgba(107,95,255,0.10); }

.motivo-input::placeholder { color:var(--ink-4); }

/* resumen */
  .res-grid { display:grid; grid-template-columns:1fr 1fr; gap:2px 0; }

.res-cell { padding:14px 0; }

.res-cell:nth-child(odd) { padding-right:18px; border-right:1px solid rgba(13,20,36,0.06); }

.res-cell:nth-child(even) { padding-left:18px; }

.res-cell:nth-child(-n+2) { padding-top:0; }

.res-cell:nth-child(n+3) { border-top:1px solid rgba(13,20,36,0.06); }

.res-cell:nth-child(4) { border-right:none; }

.res-cell:nth-child(2) { border-right:none; }

.res-k { font-size:11px; color:var(--ink-3); font-weight:500; }

.res-v { font-family:var(--mono); font-size:19px; font-weight:500; color:var(--ink-0); margin-top:5px; }

.fade-in { animation:fadeUp 600ms cubic-bezier(.2,.7,.2,1) backwards; }

.lecturax{ display:inline-flex; align-items:center; gap:8px; height:42px; padding:0 16px; border-radius:13px; font-size:13px; font-weight:600; color:var(--ink-1); cursor:pointer; transition:all 160ms; flex:0 0 auto; }

.lecturax:hover{ transform:translateY(-1px); color:var(--ink-0); }

.lecturax svg{ width:16px; height:16px; }

/* cash-card 2 columnas (relleno espacio vacío) */
.cash-grid{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,340px); gap:30px; align-items:stretch; }

.cash-left{ display:flex; flex-direction:column; }

.cash-right{ display:flex; flex-direction:column; border-left:1px solid rgba(13,20,36,0.07); padding-left:30px; }

.cash-right-head{ display:flex; align-items:center; justify-content:space-between; }

.cash-chart{ flex:1; display:flex; align-items:flex-end; min-height:96px; margin-top:10px; }

.cash-spark{ width:100%; height:96px; display:block; }

.cash-right-foot{ display:flex; align-items:center; justify-content:space-between; margin-top:11px; font-size:11px; color:var(--ink-3); }

.cash-right-foot .now{ font-family:var(--mono); color:var(--ink-1); font-weight:600; }

/* arqueo multi-medio */
.arq-cap{ font-size:11.5px; color:var(--ink-3); margin:-8px 0 15px; line-height:1.35; }

.recon-methods{ display:flex; flex-direction:column; gap:11px; }

.rm{ padding:11px 13px; border-radius:13px; background:rgba(255,255,255,0.48); border:1px solid rgba(255,255,255,0.7); }

.rm-top{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }

.rm-name{ display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; color:var(--ink-1); }

.rm-dot{ width:9px; height:9px; border-radius:3px; flex:0 0 auto; }

.rm-exp{ font-size:11px; color:var(--ink-3); }

.rm-exp b{ color:var(--ink-2); font-weight:600; font-family:var(--mono); }

.rm-bot{ display:flex; align-items:center; gap:10px; }

.rm-inp{ position:relative; display:flex; align-items:center; flex:1; }

.rm-inp > span{ position:absolute; left:11px; font-family:var(--mono); font-size:13px; color:var(--ink-3); pointer-events:none; }

.rm-input{ width:100%; text-align:right; font-family:var(--mono); font-size:14px; font-weight:500; color:var(--ink-0); padding:8px 11px 8px 24px; border-radius:9px; border:1px solid rgba(107,95,255,0.28); background:rgba(255,255,255,0.85); outline:none; }

.rm-input:focus{ border-color:var(--purple); box-shadow:0 0 0 3px rgba(107,95,255,0.10); }

.rm-diff{ font-family:var(--mono); font-size:14px; font-weight:700; min-width:66px; text-align:right; }

.diff-box{ margin-top:14px; }

/* modal arqueo por denominación */
.denom-btn{ display:inline-flex; align-items:center; gap:7px; margin-top:9px; font-size:11.5px; font-weight:600; color:var(--purple); background:none; border:none; cursor:pointer; padding:2px; }

.denom-btn:hover{ opacity:0.75; }

.modal-ov{ position:fixed; inset:0; z-index:100; background:rgba(13,20,36,0.34); backdrop-filter:blur(3px); display:none; align-items:center; justify-content:center; padding:20px; }

.modal-ov.open{ display:flex; }

.modal-card{ width:470px; max-width:100%; max-height:90vh; overflow-y:auto; padding:22px 24px; }

.modal-head{ display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px; }

.modal-title{ font-size:15px; font-weight:700; color:var(--ink-0); display:flex; align-items:center; gap:9px; }

.modal-sub{ font-size:11.5px; color:var(--ink-3); margin-top:4px; padding-left:27px; }

.modal-x{ width:30px; height:30px; border-radius:9px; background:rgba(13,20,36,0.05); color:var(--ink-2); font-size:18px; line-height:1; cursor:pointer; border:none; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }

.modal-x:hover{ background:rgba(13,20,36,0.10); }

.denom-grid{ display:flex; flex-direction:column; }

.denom-hd{ display:grid; grid-template-columns:1fr 92px 110px; gap:10px; font-size:9.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.06em; font-family:var(--mono); padding:0 2px 9px; }

.denom-hd span:nth-child(2){ text-align:center; }

.denom-hd span:nth-child(3){ text-align:right; }

.denom-row{ display:grid; grid-template-columns:1fr 92px 110px; gap:10px; align-items:center; padding:6px 2px; border-top:1px solid rgba(13,20,36,0.05); }

.denom-row:first-of-type{ border-top:none; }

.dv{ font-family:var(--mono); font-size:13.5px; font-weight:600; color:var(--ink-1); }

.dq{ height:34px; text-align:center; font-family:var(--mono); font-size:13.5px; font-weight:500; color:var(--ink-0); border-radius:9px; border:1px solid rgba(107,95,255,0.25); background:rgba(255,255,255,0.85); outline:none; }

.dq:focus{ border-color:var(--purple); box-shadow:0 0 0 3px rgba(107,95,255,0.10); }

.ds{ font-family:var(--mono); font-size:13px; font-weight:500; color:var(--ink-2); text-align:right; }

.denom-foot{ display:flex; align-items:center; justify-content:space-between; margin-top:14px; padding:13px 16px; border-radius:13px; background:rgba(52,199,125,0.11); border:1px solid rgba(52,199,125,0.24); }

.denom-foot > span:first-child{ font-size:13px; font-weight:700; color:#1a8e5a; }

.denom-total{ font-family:var(--mono); font-size:19px; font-weight:700; color:#177a4a; }

.modal-actions{ display:flex; gap:10px; margin-top:16px; }

.modal-actions .btn{ flex:1; }

/* Lectura X — reporte de control (read-only, no cierra la caja) */
.lx-badge{ margin-left:9px; font-family:var(--mono); font-size:11px; font-weight:700; color:var(--purple); background:rgba(107,95,255,0.13); padding:2px 9px; border-radius:999px; }

.lx-body{ display:flex; flex-direction:column; gap:16px; }

.lx-meta{ display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; padding:13px 15px; border-radius:13px; background:rgba(255,255,255,0.5); border:1px solid rgba(255,255,255,0.8); }

.lx-meta .k{ font-size:9px; text-transform:uppercase; letter-spacing:0.07em; font-family:var(--mono); color:var(--ink-3); }

.lx-meta .v{ font-size:12.5px; font-weight:650; color:var(--ink-1); margin-top:2px; }

.lx-sec-h{ font-size:9.5px; text-transform:uppercase; letter-spacing:0.08em; font-family:var(--mono); color:var(--ink-3); font-weight:600; margin-bottom:8px; }

.lx-line{ display:flex; align-items:center; justify-content:space-between; padding:5px 0; font-size:13px; color:var(--ink-1); }

.lx-line.sub{ font-size:12px; color:var(--ink-2); padding:3px 0; }

.lx-pago{ display:flex; align-items:center; gap:10px; padding:4px 0; font-size:12.5px; color:var(--ink-1); }

.lx-pago .d{ width:8px; height:8px; border-radius:3px; flex:0 0 auto; }

.lx-pago .nm{ flex:1; }

.lx-pago .tk{ font-size:11px; color:var(--ink-3); margin-right:10px; }

.lx-pago .am{ font-weight:650; }

.lx-note{ font-size:11px; line-height:1.55; color:var(--ink-2); background:rgba(107,95,255,0.06); border:1px solid rgba(107,95,255,0.15); border-radius:12px; padding:11px 13px; }

.lx-note b{ color:var(--purple); }

/* alivios de caja */
/* Medido contra caja-editorial.html (estilos computados, 2026-11-18): la
   maqueta usa el interlineado del navegador (normal) y el checkbox conserva
   el margen nativo, que dentro de .ali-check (18px) lo deja en 13px. La app
   hereda line-height 1,5 y el reset le saca el margen: filas 6px más altas
   y checkbox de 17px. Se replica lo de la maqueta. */
.ali-card{ line-height:normal; }
.ali-check input{ margin:3px 3px 3px 4px; }
/* Oscuro: las tres primeras son de caja-editorial.html; el avatar y el botón
   llevan texto blanco sobre --purple, que en oscuro se aclara (2026-11-18). */
html[data-theme="dark"] .alivio{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .alivio.pend:hover{ background:rgba(255,255,255,0.09); }
html[data-theme="dark"] .ali-sum, html[data-theme="dark"] .ali-chip.pend{ color:#ffb87a; }
html[data-theme="dark"] .ali-chip.done{ color:#55dd9b; }
html[data-theme="dark"] .ali-ok{ stroke:#55dd9b; }
html[data-theme="dark"] .alivio-av{ background:linear-gradient(135deg,#5f53f5,#4f7bff); }
html[data-theme="dark"] .alivio-btn{ background:#5f53f5; }

.ali-add{ display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; color:var(--purple); background:none; border:none; cursor:pointer; }

.ali-add:hover{ opacity:0.75; }

.ali-bar{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; font-size:11.5px; color:var(--ink-3); margin:-8px 0 14px; }

.ali-real{ font-weight:600; color:var(--ink-2); }

.ali-real b{ font-family:var(--mono); color:#1a8e5a; }

.ali-real .falt{ color:#c93545; font-weight:700; }

.ali-sum{ font-weight:700; color:#b96c1a; }

.alivios{ display:flex; flex-direction:column; gap:9px; }

.alivio{ display:flex; align-items:center; gap:11px; padding:10px 12px; border-radius:13px; background:rgba(255,255,255,0.5); border:1px solid rgba(255,255,255,0.7); transition:all 150ms; }

.alivio.pend{ cursor:pointer; }

.alivio.pend:hover{ background:rgba(255,255,255,0.72); }

.alivio.done{ opacity:0.85; }

.ali-check{ width:18px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; }

.ali-check input{ width:17px; height:17px; accent-color:var(--purple); cursor:pointer; }

.alivio-av{ width:30px; height:30px; border-radius:50%; background:linear-gradient(135deg,var(--purple),var(--blue)); color:#fff; font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }

.alivio-tx{ flex:1; min-width:0; }

.alivio-name{ font-size:13px; font-weight:600; color:var(--ink-1); }

.alivio-sub{ font-size:11px; color:var(--ink-3); margin-top:1px; }

.alivio-monto{ font-family:var(--mono); font-size:13.5px; font-weight:700; color:var(--ink-0); flex:0 0 auto; }

.ali-chip{ font-size:10px; font-weight:700; padding:4px 9px; border-radius:7px; flex:0 0 auto; white-space:nowrap; }

.ali-chip.pend{ background:rgba(247,152,74,0.16); color:#b96c1a; }

.ali-chip.done{ background:rgba(52,199,125,0.14); color:#1a8e5a; }

.alivio-btn{ width:100%; margin-top:14px; padding:12px; border-radius:13px; background:var(--purple); color:#fff; font-size:13.5px; font-weight:700; border:none; cursor:pointer; box-shadow:0 5px 14px rgba(107,95,255,0.32); transition:all 160ms; }

.alivio-btn:hover:not(:disabled){ transform:translateY(-1px); box-shadow:0 8px 20px rgba(107,95,255,0.42); }

.alivio-btn:disabled{ opacity:0.45; box-shadow:none; cursor:not-allowed; }

/* Alivio: ajuste recibido menos / falta */
.ali-chip.parcial{ background:rgba(247,152,74,0.18); color:#b96c1a; }

.ali-chip.falta{ background:rgba(239,93,106,0.16); color:#c93545; }

.ali-chip.ok2{ background:rgba(52,199,125,0.14); color:#1a8e5a; }

.ali-adj-bar{ display:flex; align-items:center; gap:9px; margin:-4px 0 4px 30px; padding:8px 11px; border-radius:11px; background:rgba(247,152,74,0.08); border:1px dashed rgba(247,152,74,0.32); font-size:11.5px; color:var(--ink-2); animation:aliAdjIn 200ms ease; }

.ali-adj-k{ font-size:9.5px; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-3); font-weight:700; flex:0 0 auto; }

.ali-rin{ display:inline-flex; align-items:center; gap:2px; font-family:var(--mono); font-weight:600; padding:4px 9px; border-radius:8px; background:rgba(255,255,255,0.82); border:1px solid rgba(255,255,255,0.9); }

.ali-recibido{ width:62px; font-family:var(--mono); font-weight:600; background:none; border:none; outline:none; color:var(--ink); text-align:right; }

.ali-adj-exp{ color:var(--ink-3); flex:0 0 auto; }

.ali-falta-btn{ margin-left:auto; font-size:10.5px; font-weight:700; padding:5px 11px; border-radius:8px; background:rgba(239,93,106,0.1); color:#c93545; border:1px solid rgba(239,93,106,0.24); cursor:pointer; transition:all 140ms; flex:0 0 auto; }

.ali-falta-btn:hover{ background:rgba(239,93,106,0.16); }

.ali-falta-btn.on{ background:var(--red); color:#fff; border-color:var(--red); }

/* Caja fuerte + historial de alivios */
.ali-safe-v{ font-family:var(--mono); color:var(--ink-1); font-weight:700; }

.ali-hist-toggle{ font-size:11px; font-weight:700; color:var(--purple); padding:4px 11px; border-radius:8px; background:rgba(107,95,255,0.09); border:1px solid rgba(107,95,255,0.18); cursor:pointer; transition:all 140ms; }

.ali-hist-toggle:hover, .ali-hist-toggle.on{ background:rgba(107,95,255,0.16); }

.ali-auth{ display:flex; align-items:center; gap:7px; margin-top:12px; font-size:11px; color:var(--ink-3); }

.ali-auth svg{ width:13px; height:13px; flex:0 0 auto; color:var(--ink-4); }

.ali-hist{ margin-top:14px; padding-top:13px; border-top:1px solid rgba(13,20,36,0.07); }

.ali-hist-head{ font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); margin-bottom:6px; }

.ali-hist-row{ display:flex; align-items:center; gap:11px; padding:8px 0; border-top:1px solid rgba(13,20,36,0.04); font-size:12.5px; }

.ali-hist-row:first-child{ border-top:none; }

/* Variante oscura (2026-11-18): texto blanco sobre el degradado de --purple, que en
   oscuro se aclara. Lo destapó tema-oscuro-pantallas al dejar de revisar una regla
   sí y una no. Mismo violeta que .cta / .btn-primary. */
html[data-theme="dark"] .ali-hist-av{ background:linear-gradient(135deg,#5f53f5,#4f7bff); }
.ali-hist-av{ width:28px; height:28px; border-radius:50%; background:linear-gradient(135deg,var(--purple),var(--blue)); color:#fff; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }

.ali-hist-tx{ flex:1; min-width:0; }

.ali-hist-name{ font-weight:600; color:var(--ink-1); }

.ali-hist-sub{ font-size:10.5px; color:var(--ink-3); margin-top:1px; }

.ali-hist-amt{ font-family:var(--mono); font-weight:700; color:var(--ink-1); flex:0 0 auto; }

.ali-hist-amt .falt{ color:#c93545; font-weight:700; font-size:10.5px; margin-left:6px; }

.alivio-num{ font-family:var(--mono); font-size:10px; font-weight:600; color:var(--ink-3); background:rgba(13,20,36,0.05); padding:1px 6px; border-radius:5px; margin-left:6px; }

/* historial de cierres */
.cl-cajero{ display:inline-flex; align-items:center; gap:8px; }

/* Variante oscura (2026-11-18): texto blanco sobre el degradado de --purple, que en
   oscuro se aclara. Lo destapó tema-oscuro-pantallas al dejar de revisar una regla
   sí y una no. Mismo violeta que .cta / .btn-primary. */
html[data-theme="dark"] .cl-ava{ background:linear-gradient(135deg,#5f53f5,#4f7bff); }
.cl-ava{ width:22px; height:22px; border-radius:50%; background:linear-gradient(135deg,var(--purple),var(--blue)); color:#fff; font-size:9px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; }

.cl-amber{ color:#b96c1a; }

.cl-chip{ display:inline-flex; font-size:10.5px; font-weight:700; padding:4px 9px; border-radius:7px; white-space:nowrap; }

.cl-chip.ok{ background:rgba(52,199,125,0.14); color:#1a8e5a; }

.cl-chip.err{ background:rgba(239,93,106,0.14); color:#c93545; }

.cl-chip.warn{ background:rgba(247,152,74,0.16); color:#b96c1a; }

.cl-actions{ display:inline-flex; gap:2px; justify-content:flex-end; }

.cl-ic{ width:28px; height:28px; border-radius:8px; color:var(--ink-3); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; background:none; border:none; transition:all 150ms; }

.cl-ic:hover{ background:rgba(13,20,36,0.05); color:var(--ink-1); }

.cl-ic svg{ width:15px; height:15px; }

` + OSCURO_NUCLEO + `
/* ════════════════ MODO OSCURO · lo propio de Caja ════════════════ */

/* (1) LOS TOKENS QUE EL NUCLEO NO CONOCE.
   Caja los define en su :root con nombres viejos (drift entre maquetas). Sin
   esto, el borde blanco y la sombra clara siguen puestos por token y la
   pantalla se ve clara aunque el fondo sea noche. */
html[data-theme="dark"]{
  --ink-0:#eef2ff;
  --blue:#6fa8ff; --blue-2:#9dbcff;
  --glass-border:rgba(255,255,255,0.12);
  --glass-shadow:inset 0 1px 0 rgba(255,255,255,0.07), 0 8px 32px rgba(3,7,20,0.42), 0 2px 8px rgba(3,7,20,0.28);
}

/* (2) Superficies y bordes que estaban a mano, no por token.
   SOLO clases que la pantalla usa de verdad: la maqueta trae mucho CSS muerto
   (.alivio, .ali-*, .rs-*, .cl-*, .arq-row, .more-btn no existen en
   CajaClient). Medido con scripts/reglas-claras-en-uso.sh — pintar a ciegas
   daba un bloque el doble de largo donde la mitad no se ve nunca. */
html[data-theme="dark"] .sg-div{ background:rgba(255,255,255,0.1); }
html[data-theme="dark"] .btn{ box-shadow:inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 6px rgba(3,7,20,0.3); }
html[data-theme="dark"] .modal-x{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .modal-x:hover{ background:rgba(255,255,255,0.13); }
html[data-theme="dark"] .mov-cols > div:first-child,
html[data-theme="dark"] .res-cell:nth-child(odd){ border-right-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .cash-right{ border-left-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .mov-item,
html[data-theme="dark"] .tbl td,
html[data-theme="dark"] .denom-row,
html[data-theme="dark"] .res-cell:nth-child(n+3){ border-top-color:rgba(255,255,255,0.07); }
html[data-theme="dark"] .tbl th{ border-bottom-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .modal-ov{ background:rgba(3,7,20,0.55); }

/* Cajas de superficie clara (metadatos de Lectura X, conciliación, chips). */
html[data-theme="dark"] .lx-meta,
html[data-theme="dark"] .rm,
html[data-theme="dark"] .reasign-opt,
html[data-theme="dark"] .mov-fchip{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .mov-fchip[aria-pressed="true"] .fsw{ box-shadow:0 0 0 2.5px rgba(255,255,255,0.25); }

/* Campos donde se escribe plata: el blanco al 85% encandila sobre noche. */
html[data-theme="dark"] .dq,
html[data-theme="dark"] .rm-input,
html[data-theme="dark"] .arq-input,
html[data-theme="dark"] .motivo-input{ background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.16); color:var(--ink); }

/* (3) Textos de acento. En claro son verdes OSCUROS (#1a8e5a, #177a4a),
   pensados para fondo blanco: sobre azul noche quedan casi negros. Se pasan a
   los mismos brillantes que ya usan las otras pantallas. */
html[data-theme="dark"] .c-green,
html[data-theme="dark"] .mov-ic.ing,
html[data-theme="dark"] .pill-open,
html[data-theme="dark"] .denom-foot > span:first-child,
html[data-theme="dark"] .denom-total{ color:#55dd9b; }
html[data-theme="dark"] .pill-closed{ background:rgba(255,255,255,0.1); }
`;
