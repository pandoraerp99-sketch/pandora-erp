// CSS de Productos — COPIA COMPLETA Y VERBATIM del <style> de
// pos-preview/productos-v3.html. NO se filtra nada.
//
// POR QUE NO SE FILTRA (2026-09-07): la version anterior descartaba las reglas
// cuyo selector ya existia en shellCss.ts. Eso estaba MAL, y es el mismo error
// que se corrigio en Clientes: shellCss trae el CSS del POS, y los MISMOS
// selectores tienen VALORES DISTINTOS en cada maqueta. Filtrarlas hacia que
// Productos se pintara con los estilos del POS. Medido contra la maqueta:
// su .seg tenia radio 11px donde la maqueta dice 999px, fuente 13px donde dice
// 12.5, y la topbar se quedaba sin su margen de abajo.
//
// La maqueta es la autoridad: se copia entera y, como este <style> se monta
// despues del shell, gana donde difieran.
//
// Verificar con: node scripts/comparar-con-maqueta.mjs /productos <maqueta>
//
// OJO: esto es UN TEMPLATE LITERAL. Nada de backticks aca adentro, ni siquiera
// en comentarios — cierran el string y rompen toda la app con un error que
// apunta al CSS y no al culpable.
export const PRODUCTOS_CSS = `
/* ============================================================
   Pandora · Panel — adaptado del app.jsx (mismo sistema glass)
   ============================================================ */
:root{
  --ink:#0d1424; --ink-1:#1f2a44; --ink-2:#4a5570; --ink-3:#7681a0; --ink-4:#a8b0c5;
  --purple:#6b5fff; --purple-2:#9088ff; --blue:#5b8cff; --green:#34c77d; --orange:#f7984a; --pink:#ee6a8e; --red:#ef5d6a; --yellow:#f4c948; --teal:#0e8f9e;
  --glass-bg:rgba(255,255,255,0.58); --glass-bg-2:rgba(255,255,255,0.72);
  --glass-bd:1px solid rgba(255,255,255,0.85);
  --glass-hi:inset 0 1px 0 rgba(255,255,255,0.9);
  --glass-sh:0 8px 32px rgba(54,70,120,0.10), 0 2px 8px rgba(54,70,120,0.06);
  --mono:'JetBrains Mono',ui-monospace,monospace;
}
*,*::before,*::after{ box-sizing:border-box; margin:0; padding:0; }
button,input{ font:inherit; color:inherit; border:none; outline:none; background:none; cursor:pointer; }
html,body{ height:100%; }
body{ font-family:'Inter',ui-sans-serif,system-ui,sans-serif; -webkit-font-smoothing:antialiased; letter-spacing:-0.011em; color:var(--ink); height:100dvh; overflow:hidden; position:relative; }
.bg{ position:fixed; inset:0; z-index:-10; }
.bg .base{ position:absolute; inset:0; background:linear-gradient(175deg,#b5c6e8 0%,#c8d4ea 28%,#ddd0e0 62%,#eed6d0 100%); }
.bg .glow{ position:absolute; inset:0; background:
  radial-gradient(ellipse 70% 60% at 10% 95%, rgba(238,200,220,0.55) 0%, transparent 60%),
  radial-gradient(ellipse 60% 50% at 88% 82%, rgba(240,210,175,0.40) 0%, transparent 60%),
  radial-gradient(ellipse 55% 42% at 55% 22%, rgba(255,255,255,0.60) 0%, transparent 52%),
  radial-gradient(ellipse 58% 48% at 10% 22%, rgba(195,215,248,0.65) 0%, transparent 62%); }
::-webkit-scrollbar{ width:7px; height:7px; }
::-webkit-scrollbar-track{ background:transparent; }
::-webkit-scrollbar-thumb{ background:rgba(13,20,36,0.14); border-radius:5px; border:2px solid transparent; background-clip:padding-box; }

.glass{ background:var(--glass-bg); backdrop-filter:blur(28px) saturate(140%); -webkit-backdrop-filter:blur(28px) saturate(140%); border:var(--glass-bd); border-radius:20px; box-shadow:var(--glass-hi), var(--glass-sh); }
.glass-strong{ background:var(--glass-bg-2); backdrop-filter:blur(32px) saturate(150%); -webkit-backdrop-filter:blur(32px) saturate(150%); border:var(--glass-bd); border-radius:20px; box-shadow:var(--glass-hi), var(--glass-sh); }
.tnum{ font-variant-numeric:tabular-nums; }
.mono{ font-family:var(--mono); }

/* ════ SHELL ════ */
.shell{ height:100dvh; padding:10px; display:grid; grid-template-columns:210px 1fr; gap:8px; }

/* ════ SIDEBAR (idéntica al POS / dashboard) ════ */
.sidebar{ display:flex; flex-direction:column; border-radius:20px; padding:22px 14px 18px; overflow:hidden; }
.logo-row{ display:flex; align-items:center; gap:10px; padding:0 8px 22px; }
.logo-mark{ width:26px; height:26px; flex-shrink:0; } .logo-mark svg{ width:100%; height:100%; display:block; }
.logo-text{ font-size:19px; font-weight:700; letter-spacing:-0.025em; background:linear-gradient(135deg,#2a3454 0%,#4a5878 100%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.nav-item{ display:flex; align-items:center; gap:11px; padding:10px 11px; border-radius:12px; color:var(--ink-2); font-size:13.5px; font-weight:500; cursor:pointer; transition:all 200ms cubic-bezier(.4,0,.2,1); }
.nav-item:hover{ color:var(--ink); background:rgba(255,255,255,0.4); }
.nav-item.active{ background:rgba(255,255,255,0.92); color:var(--ink); box-shadow:0 1px 2px rgba(54,70,120,0.06), 0 4px 12px rgba(54,70,120,0.08); }
.nav-item.active .nav-icon-box{ background:var(--purple); color:#fff; box-shadow:0 4px 10px rgba(107,95,255,0.4); }
.nav-icon-box{ width:26px; height:26px; display:flex; align-items:center; justify-content:center; border-radius:7px; color:var(--ink-2); transition:all 200ms; flex-shrink:0; }
.side-foot{ margin-top:auto; padding-top:12px; display:flex; flex-direction:column; gap:9px; }
.afip{ padding:10px 11px; border-radius:13px; background:rgba(52,199,125,0.08); border:1px solid rgba(52,199,125,0.20); }
.afip-top{ display:flex; align-items:center; gap:7px; }
.afip-dot{ width:7px; height:7px; border-radius:50%; background:var(--green); flex:0 0 auto; animation:pg 2.4s ease-in-out infinite; }
.afip-name{ font-size:11.5px; font-weight:700; color:#177a4a; }
.afip-live{ margin-left:auto; font-size:8.5px; font-weight:800; letter-spacing:0.06em; color:var(--green); }
.afip-sub{ font-size:10px; color:#5a9b78; padding-left:14px; margin-top:2px; }
@keyframes pg{ 0%,100%{box-shadow:0 0 0 2px rgba(52,199,125,0.22)} 50%{box-shadow:0 0 0 5px rgba(52,199,125,0)} }
.cashier{ display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:13px; background:rgba(255,255,255,0.66); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); }
.cashier-av{ width:32px; height:32px; flex:0 0 auto; border-radius:50%; background:linear-gradient(135deg,var(--purple),var(--blue)); display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px; font-weight:700; }
.avatar-ring{ padding:2px; border-radius:50%; flex:0 0 auto; display:flex; background:conic-gradient(from 0deg,#6b5fff,#5b8cff,#34c77d,#f7984a,#ee6a8e,#6b5fff); animation:spinRing 6s linear infinite; }
.avatar-ring > .cashier-av{ animation:spinRing 6s linear infinite reverse; border:2px solid rgba(255,255,255,0.9); }
@keyframes spinRing{ to{ transform:rotate(360deg); } }
.cashier-name{ font-size:12px; font-weight:600; line-height:1.2; }
.cashier-role{ font-size:10px; color:var(--ink-3); }
.cashier-live{ width:7px; height:7px; border-radius:50%; background:var(--green); margin-left:auto; flex:0 0 auto; animation:pg 2.4s ease-in-out infinite; }

/* ════ MAIN ════ */
.main{ min-width:0; min-height:0; overflow-y:auto; padding:4px 6px 18px 2px; }
.topbar{ display:flex; align-items:center; gap:12px; margin-bottom:16px; }
.search{ position:relative; flex:1; max-width:380px; display:flex; align-items:center; height:42px; border-radius:14px; padding:0 14px 0 40px; }
.search svg{ position:absolute; left:13px; width:16px; height:16px; color:var(--ink-3); }
.search input{ width:100%; font-size:13px; } .search input::placeholder{ color:var(--ink-3); }
.seg{ display:inline-flex; padding:5px; gap:2px; border-radius:999px; }
.seg button{ padding:7px 16px; border-radius:999px; font-size:12.5px; font-weight:500; color:var(--ink-2); transition:all 200ms; }
.seg button.on{ background:var(--ink); color:#fff; box-shadow:0 4px 12px rgba(13,20,36,0.25); }
.top-tools{ display:flex; align-items:center; gap:8px; margin-left:auto; }
.iconbtn{ width:40px; height:40px; display:flex; align-items:center; justify-content:center; border-radius:12px; color:var(--ink-1); position:relative; }
.iconbtn svg{ width:18px; height:18px; }
.iconbtn .ndot{ position:absolute; top:7px; right:7px; min-width:15px; height:15px; border-radius:999px; background:var(--pink); color:#fff; font-size:9px; font-weight:700; display:flex; align-items:center; justify-content:center; border:2px solid rgba(255,255,255,0.9); }
.user-chip{ display:flex; align-items:center; gap:9px; padding:5px 13px 5px 5px; border-radius:999px; }
.user-name{ font-size:12.5px; font-weight:600; line-height:1.25; } .user-role{ font-size:10.5px; color:var(--ink-3); }

.content{ display:flex; gap:16px; }
.col-main{ flex:1; min-width:0; display:flex; flex-direction:column; gap:16px; }
.col-side{ width:324px; flex-shrink:0; display:flex; flex-direction:column; gap:16px; }

.card{ border-radius:20px; padding:22px; }
.chart-box{ position:relative; }
.chart-tip{ position:absolute; background:var(--ink); color:#fff; padding:5px 9px; border-radius:9px; font-family:var(--mono); font-size:11px; font-weight:600; box-shadow:0 8px 20px rgba(13,20,36,0.28); transform:translate(-50%,-115%); white-space:nowrap; }
.chart-tip::after{ content:''; position:absolute; left:50%; bottom:-4px; transform:translateX(-50%) rotate(45deg); width:8px; height:8px; background:var(--ink); }
.card-title{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.card-title h3{ font-size:14px; font-weight:600; color:var(--ink); display:flex; align-items:center; gap:8px; white-space:nowrap; }
.card-title .ic{ width:24px; height:24px; border-radius:7px; display:flex; align-items:center; justify-content:center; }
.more-btn{ color:var(--ink-3); padding:4px; border-radius:6px; display:flex; } .more-btn svg{ width:16px; height:16px; }
.label-sm{ color:var(--ink-3); font-size:12px; font-weight:500; }
.upper-mini{ font-size:10.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.08em; font-family:var(--mono); font-weight:500; }
.delta{ display:inline-flex; align-items:center; gap:3px; padding:3px 8px; border-radius:999px; font-size:11.5px; font-weight:600; line-height:1; }
.delta svg{ width:11px; height:11px; }
.delta.up{ background:rgba(52,199,125,0.14); color:#1a8e5a; }
.delta.down{ background:rgba(239,93,106,0.14); color:#c93545; }
.bignum{ font-size:33px; font-weight:700; letter-spacing:-0.03em; }

/* hero */
.hero{ position:relative; overflow:hidden; padding:30px 32px 32px; min-height:272px; }
.hero-hi{ font-size:15px; font-weight:500; color:var(--ink-2); display:flex; align-items:center; gap:8px; }
.hero-h1{ margin:6px 0 0; font-size:54px; line-height:1.02; font-weight:700; letter-spacing:-0.04em; max-width:560px; }
.wave{ display:inline-block; animation:wave 2.4s ease-in-out 1s 2; transform-origin:70% 70%; }
@keyframes wave{ 0%,60%,100%{transform:rotate(0)} 10%{transform:rotate(14deg)} 20%{transform:rotate(-8deg)} 30%{transform:rotate(14deg)} 40%{transform:rotate(-4deg)} 50%{transform:rotate(10deg)} }
.hero-live{ margin-top:20px; display:flex; align-items:center; gap:14px; padding:14px 18px; background:rgba(255,255,255,0.55); border-radius:16px; border:1px solid rgba(255,255,255,0.85); max-width:430px; backdrop-filter:blur(20px); }
.live-dot{ width:8px; height:8px; border-radius:999px; background:var(--green); position:relative; flex:0 0 auto; }
.live-dot::after{ content:''; position:absolute; inset:-4px; border-radius:999px; background:var(--green); opacity:0.4; animation:liveRing 1.8s cubic-bezier(.2,.7,.2,1) infinite; }
@keyframes liveRing{ 0%{transform:scale(0.8);opacity:0.6} 100%{transform:scale(2.2);opacity:0} }
/* hero art (chips flotantes) */
.hero-art{ position:absolute; top:22px; right:26px; bottom:22px; width:340px; pointer-events:none; }
.hero-art .halo{ position:absolute; top:-10px; right:10px; width:300px; height:300px; border-radius:50%; background:radial-gradient(circle, rgba(255,210,180,0.5) 0%, rgba(255,180,200,0.22) 40%, transparent 70%); filter:blur(20px); }
.float-card{ position:absolute; background:rgba(255,255,255,0.85); backdrop-filter:blur(20px) saturate(160%); border:1px solid rgba(255,255,255,0.9); border-radius:14px; box-shadow:0 12px 32px rgba(54,70,120,0.14), 0 4px 12px rgba(54,70,120,0.08); will-change:transform; }
.f1{ animation:fl1 6s ease-in-out infinite; } .f2{ animation:fl2 7s ease-in-out infinite -1.5s; } .f3{ animation:fl3 8s ease-in-out infinite -3s; }
@keyframes fl1{ 0%,100%{transform:translateY(0) rotate(3deg)} 50%{transform:translateY(-10px) rotate(2deg)} }
@keyframes fl2{ 0%,100%{transform:translateY(0) rotate(-2deg)} 50%{transform:translateY(-9px) rotate(-1deg)} }
@keyframes fl3{ 0%,100%{transform:translateY(0) rotate(-2deg)} 50%{transform:translateY(-8px) rotate(-1deg)} }

.grid3{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
.grid2{ display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,1fr); gap:16px; }

/* charts */
.spark{ width:100%; height:74px; margin-top:14px; display:block; }
.bars{ display:flex; align-items:flex-end; gap:6px; height:74px; margin-top:14px; }
.bars .b{ flex:1; border-radius:5px 5px 3px 3px; background:rgba(107,95,255,0.28); animation:grow 900ms cubic-bezier(.2,.7,.2,1) backwards; transform-origin:bottom; }
.bars .b.hi{ background:var(--purple); box-shadow:0 4px 12px rgba(107,95,255,0.4); }
@keyframes grow{ from{ transform:scaleY(0); } }
.donut-wrap{ display:flex; align-items:center; gap:16px; }
.donut{ width:128px; height:128px; border-radius:50%; flex:0 0 auto; position:relative; }
.donut::after{ content:''; position:absolute; inset:20px; border-radius:50%; background:var(--glass-bg-2); backdrop-filter:blur(10px); }
.donut .ctr{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:1; }
.legend{ flex:1; display:flex; flex-direction:column; gap:9px; }
.legend .row{ display:flex; align-items:center; gap:9px; font-size:12.5px; color:var(--ink-2); }
.legend .dot{ width:10px; height:10px; border-radius:3px; flex:0 0 auto; }
.legend .val{ margin-left:auto; font-family:var(--mono); font-weight:600; color:var(--ink); }

/* listas */
.tx-row{ display:grid; grid-template-columns:34px 1fr auto auto; align-items:center; gap:12px; padding:10px 0; border-top:1px solid rgba(13,20,36,0.05); font-size:13px; }
.tx-row:first-child{ border-top:none; }
.tx-ic{ width:34px; height:34px; border-radius:9px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:13px; }
.tx-ic svg{ width:16px; height:16px; }
.tx-name{ font-weight:500; } .tx-sub{ font-size:11px; color:var(--ink-3); margin-top:1px; }
.pay-pill{ font-size:10px; font-weight:700; padding:3px 8px; border-radius:7px; letter-spacing:0.02em; }
.tx-amount{ font-family:var(--mono); font-weight:600; }

/* widgets col derecha */
.kv{ display:flex; align-items:center; justify-content:space-between; padding:8px 0; }
.kv .k{ font-size:12.5px; color:var(--ink-2); } .kv .v{ font-family:var(--mono); font-weight:600; font-size:13px; }
.divider{ height:1px; background:rgba(13,20,36,0.06); margin:6px 0; }
.caja-state{ display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:700; padding:4px 9px; border-radius:999px; background:rgba(52,199,125,0.14); color:#1a8e5a; }
.afipbar{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:4px; }
.afipbar .cell{ text-align:center; padding:9px 4px; border-radius:11px; background:rgba(255,255,255,0.6); border:1px solid rgba(255,255,255,0.8); }
.afipbar .n{ font-family:var(--mono); font-size:18px; font-weight:700; } .afipbar .t{ font-size:9.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.05em; margin-top:1px; }
.stock-row{ display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid rgba(13,20,36,0.05); font-size:12.5px; }
.stock-row:first-child{ border-top:none; }
.stock-thumb{ width:30px; height:30px; border-radius:8px; overflow:hidden; background:#fff; border:1px solid rgba(13,20,36,0.05); flex:0 0 auto; display:flex; align-items:center; justify-content:center; font-size:15px; }
.stock-name{ flex:1; font-weight:500; }
.stock-q{ font-family:var(--mono); font-weight:700; font-size:12px; padding:2px 8px; border-radius:7px; background:rgba(239,93,106,0.12); color:#c0384a; }
.quick-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.quick{ display:flex; flex-direction:column; gap:9px; padding:15px 13px; border-radius:15px; text-align:left; background:rgba(255,255,255,0.7); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); transition:all 180ms; }
.quick:hover{ transform:translateY(-2px); box-shadow:var(--glass-hi), 0 8px 18px rgba(54,70,120,0.12); }
.quick .qi{ width:38px; height:38px; border-radius:11px; display:flex; align-items:center; justify-content:center; } .quick .qi svg{ width:18px; height:18px; }
.quick .ql{ font-size:13px; font-weight:600; }
.cta{ width:100%; display:flex; align-items:center; justify-content:center; gap:9px; padding:14px; border-radius:14px; background:linear-gradient(140deg,var(--purple),var(--purple-2)); color:#fff; font-size:14.5px; font-weight:800; letter-spacing:-0.02em; box-shadow:0 7px 20px rgba(107,95,255,0.42); transition:all 170ms; }
.cta:hover{ transform:translateY(-1px); box-shadow:0 10px 26px rgba(107,95,255,0.52); }
.cta svg{ width:18px; height:18px; }
@media (prefers-reduced-motion:reduce){ *{ animation:none !important; } }

/* ===== PRODUCTOS (gestión, lenguaje dashboard — gemelo de Clientes v6) ===== */
.cli-head{ display:flex; align-items:flex-end; justify-content:space-between; margin-bottom:15px; }
.cli-title{ font-size:25px; font-weight:700; letter-spacing:-0.03em; color:var(--ink); margin:0; }
.cli-sub{ font-size:12.5px; color:var(--ink-3); margin-top:4px; }
.cli-actions{ display:flex; gap:9px; }
.hbtn{ display:inline-flex; align-items:center; gap:7px; padding:9px 14px; border-radius:12px; font-size:12.5px; font-weight:600; color:var(--ink-1); background:rgba(255,255,255,0.72); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); cursor:pointer; transition:all 160ms; } .hbtn svg{ width:15px; height:15px; } .hbtn:hover{ transform:translateY(-1px); }
.hbtn.primary{ background:linear-gradient(140deg,var(--purple),var(--purple-2)); color:#fff; border:none; box-shadow:0 5px 14px rgba(107,95,255,0.34); }
.kpi-strip{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin-bottom:15px; }
.kpi{ padding:15px 17px !important; }
.cli-grid{ display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:15px; align-items:start; }
.cl-colhead{ display:flex; align-items:center; gap:12px; padding:0 16px 8px; }
.cl-colhead span{ font-size:9.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.06em; font-family:var(--mono); }
.cl-list{ display:flex; flex-direction:column; }
.prow{ display:flex; align-items:center; gap:12px; width:100%; text-align:left; padding:9px 16px; border:none; border-top:1px solid rgba(13,20,36,0.05); background:none; cursor:pointer; transition:background 130ms; }
.prow:hover{ background:rgba(255,255,255,0.5); }
.prow.sel{ background:rgba(107,95,255,0.07); box-shadow:inset 3px 0 0 var(--purple); }
.pthumbwrap{ width:50px; flex:0 0 auto; display:flex; }
.pthumb{ width:42px; height:42px; border-radius:11px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:16px; overflow:hidden; flex:0 0 auto; }
.pthumb.img{ background:#fff; border:1px solid rgba(13,20,36,0.07); padding:3px; }
.pthumb.img img{ width:100%; height:100%; object-fit:contain; }
.clmain{ flex:1; min-width:0; } .clname{ font-size:13px; font-weight:600; color:var(--ink); display:flex; align-items:center; gap:7px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .clid{ font-size:11px; color:var(--ink-3); font-family:var(--mono); margin-top:2px; }
.mvtag{ color:#b96c1a; font-size:11px; flex:0 0 auto; } .mvtag.big{ font-size:10px; font-weight:700; background:rgba(247,152,74,0.16); padding:4px 9px; border-radius:7px; }
.pill{ font-size:10.5px; font-weight:700; padding:4px 10px; border-radius:7px; width:104px; box-sizing:border-box; text-align:center; flex:0 0 auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pprecio{ width:80px; text-align:right; font-family:var(--mono); font-weight:700; font-size:13px; color:var(--ink); flex:0 0 auto; }
.pmargen{ width:56px; text-align:right; font-family:var(--mono); font-size:12px; font-weight:600; color:#1a8e5a; flex:0 0 auto; }
.pstock{ width:74px; text-align:right; font-family:var(--mono); font-weight:700; font-size:13px; color:var(--ink); flex:0 0 auto; } .pstock i{ font-style:normal; font-weight:500; font-size:11px; color:var(--ink-3); }
.estado{ width:96px; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; gap:6px; font-size:10.5px; font-weight:700; padding:5px 0; border-radius:999px; flex:0 0 auto; } .estado .d{ width:6px; height:6px; border-radius:50%; }
.estado.ok{ background:rgba(52,199,125,0.13); color:#1a8e5a; } .estado.ok .d{ background:var(--green); }
.estado.warn{ background:rgba(247,152,74,0.16); color:#b96c1a; } .estado.warn .d{ background:var(--orange); }
.estado.err{ background:rgba(239,93,106,0.12); color:#c0384a; } .estado.err .d{ background:var(--red); }
.clgo{ color:var(--ink-4); flex:0 0 auto; }
/* detalle producto */
.cdetail{ padding:20px; }
.pd-photo{ width:100%; height:148px; border-radius:15px; background:#fff; border:1px solid rgba(13,20,36,0.07); display:flex; align-items:center; justify-content:center; overflow:hidden; padding:12px; margin-bottom:13px; }
.pd-photo .pthumb{ width:100%; height:100%; border:none; padding:0; background:transparent; border-radius:0; } .pd-photo .pthumb.img{ border:none; }
.pd-photo img{ max-width:100%; max-height:100%; object-fit:contain; }
.cd-name{ font-size:16px; font-weight:700; color:var(--ink); letter-spacing:-0.01em; } .cd-id{ font-size:11.5px; color:var(--ink-3); font-family:var(--mono); margin-top:2px; }
.cd-stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:16px 0 14px; }
.cd-sv{ font-size:15px; font-weight:700; color:var(--ink); margin-top:3px; }
.pd-stockbox{ padding:13px 15px; border-radius:13px; background:rgba(255,255,255,0.45); border:1px solid rgba(255,255,255,0.8); }
.pd-stock-top{ display:flex; align-items:center; justify-content:space-between; }
.pd-bar{ height:8px; border-radius:999px; background:rgba(13,20,36,0.07); overflow:hidden; margin:8px 0 5px; } .pd-bar i{ display:block; height:100%; border-radius:999px; }
.pd-min{ font-size:11px; color:var(--ink-3); font-family:var(--mono); }
.cd-btns{ display:flex; gap:9px; margin-top:15px; } .cd-btns .cta{ box-shadow:0 5px 14px rgba(107,95,255,0.34); }
.rthumb{ width:32px; height:32px; border-radius:9px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; overflow:hidden; flex:0 0 auto; }
.rthumb.img{ background:#fff; border:1px solid rgba(13,20,36,0.07); padding:2px; } .rthumb.img img{ width:100%; height:100%; object-fit:contain; }
.repoped{ font-size:11px; font-weight:700; color:var(--purple); background:rgba(107,95,255,0.10); padding:5px 10px; border-radius:8px; white-space:nowrap; }

/* ===== encabezado B + chips (eyebrow + título + chips glass + hairline) ===== */
.cli-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:0; }
.cli-title{ font-size:27px; font-weight:700; letter-spacing:-0.035em; line-height:1; color:var(--ink); margin:0; }
.hd-eye{ font-family:var(--mono); font-size:10.5px; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; color:var(--purple); margin-bottom:8px; display:flex; align-items:center; gap:7px; }
.hd-eye::before{ content:''; width:16px; height:2px; border-radius:2px; background:var(--purple); }
.hd-chips{ display:flex; gap:7px; margin-top:11px; flex-wrap:wrap; }
.chip{ display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:500; color:var(--ink-2); background:rgba(255,255,255,0.55); border:1px solid rgba(255,255,255,0.7); padding:4px 11px; border-radius:999px; box-shadow:var(--glass-hi); }
.chip .dot{ width:6px; height:6px; border-radius:50%; }
.chip b{ color:var(--ink); font-weight:700; font-family:var(--mono); }
.hd-rule{ height:1px; margin:16px 0 18px; background:linear-gradient(90deg,rgba(107,95,255,0.35),rgba(91,140,255,0.18) 30%,rgba(13,20,36,0.06) 60%,transparent); }

/* ===== encabezado minimal (content-first, como el dashboard) ===== */
.cli-head{ display:flex; align-items:center; justify-content:space-between; margin:2px 0 16px; }
.cli-title{ font-size:21px; font-weight:700; letter-spacing:-0.03em; line-height:1; color:var(--ink); margin:0; }
.hd-eye, .hd-chips, .hd-rule{ display:none !important; }

/* ===== barra de encabezado glass (estilo barra de sesión de Caja) ===== */
.hdr-bar{ display:flex; align-items:center; gap:24px; padding:15px 22px; margin-bottom:18px; border-radius:20px; }
.hdr-id{ flex:0 0 auto; }
.hdr-title{ font-size:23px; font-weight:700; letter-spacing:-0.03em; color:var(--ink); line-height:1; }
.hdr-sub{ font-size:12px; color:var(--ink-3); margin-top:4px; }
.hdr-glance{ margin:0 auto; display:flex; align-items:center; gap:22px; }
.hdr-bar .sg{ display:flex; flex-direction:column; gap:3px; }
.hdr-bar .sg-k{ font-size:9.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.07em; font-family:var(--mono); font-weight:500; }
.hdr-bar .sg-v{ font-size:16px; font-weight:700; color:var(--ink); font-family:var(--mono); letter-spacing:-0.01em; }
.hdr-bar .sg-div{ width:1px; height:28px; background:rgba(13,20,36,0.08); }
.hdr-act{ display:flex; gap:9px; align-items:center; flex:0 0 auto; }
.hdr-status{ margin:0 auto; display:inline-flex; align-items:center; gap:7px; padding:7px 13px; border-radius:999px; background:rgba(52,199,125,0.13); color:#1a8e5a; font-size:12.5px; font-weight:600; }
.hdr-dot{ width:7px; height:7px; border-radius:50%; background:#34c77d; }
.fac-head .ptabs, .hdr-bar .ptabs{ flex:0 0 auto; align-self:center; }

/* ===================== DECK · encabezado premium ===================== */
.deck{ position:relative; display:flex; align-items:center; gap:0; padding:17px 20px 17px 18px; border-radius:24px; overflow:hidden; margin-bottom:18px;
 background:linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0.56) 100%);
 -webkit-backdrop-filter:blur(32px) saturate(155%); backdrop-filter:blur(32px) saturate(155%); border:1px solid rgba(255,255,255,0.75);
 box-shadow:inset 0 1.4px 0 rgba(255,255,255,0.95), inset 0 0 0 1px rgba(255,255,255,0.22), 0 1px 2px rgba(54,70,120,0.05), 0 16px 40px -8px rgba(54,70,120,0.20), 0 30px 60px -20px rgba(54,70,120,0.14);
 animation:deckIn 520ms cubic-bezier(.2,.7,.2,1) both; }
@keyframes deckIn{ from{ opacity:0; transform:translateY(-8px); } to{ opacity:1; transform:translateY(0); } }
.deck::before{content:'';position:absolute;left:-50px;top:-70px;width:300px;height:240px;background:radial-gradient(circle at 35% 45%, rgba(107,95,255,0.20), transparent 62%);pointer-events:none;}
.deck::after{content:'';position:absolute;right:-60px;bottom:-70px;width:340px;height:240px;background:radial-gradient(circle at 60% 50%, rgba(255,196,166,0.20), transparent 64%);pointer-events:none;}
.deck .grain{position:absolute;inset:0;pointer-events:none;opacity:0.4;mix-blend-mode:soft-light;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:160px;}
.deck-id{display:flex;align-items:center;gap:15px;position:relative;z-index:2;}
.tile{width:54px;height:54px;border-radius:17px;flex:0 0 auto;position:relative;overflow:hidden;background:linear-gradient(145deg, #8479ff 0%, #6b5fff 42%, #5b8cff 100%);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 10px 22px -4px rgba(107,95,255,0.55), inset 0 1.5px 0 rgba(255,255,255,0.55), inset 0 -3px 8px rgba(40,30,120,0.3);}
.tile::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 32% 22%, rgba(255,255,255,0.5), transparent 52%);}
.tile::after{content:'';position:absolute;left:0;right:0;bottom:0;height:42%;background:linear-gradient(180deg,transparent,rgba(40,30,120,0.18));}
.tile svg{position:relative;z-index:1;filter:drop-shadow(0 1px 1px rgba(30,20,90,0.3));}
.deck-tt{display:flex;flex-direction:column;}
.deck-eye{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:var(--purple);opacity:0.85;margin-bottom:4px;}
.deck-title{font-size:23px;font-weight:700;letter-spacing:-0.04em;color:var(--ink);line-height:0.98;}
.deck-sub{font-size:12px;color:var(--ink-3);margin-top:5px;display:flex;align-items:center;gap:8px;}
.deck-sub .live{display:inline-flex;align-items:center;gap:5px;color:#1a8e5a;font-weight:600;}
.deck-sub .live .d{width:6px;height:6px;border-radius:50%;background:#34c77d;box-shadow:0 0 0 3px rgba(52,199,125,0.16);}
.deck .sep{width:1px;height:50px;margin:0 26px;flex:0 0 auto;background:linear-gradient(180deg, transparent, rgba(13,20,36,0.12) 28%, rgba(13,20,36,0.12) 72%, transparent);}
.deck-stats{display:flex;align-items:center;gap:30px;position:relative;z-index:2;}
.deck-stats .stat{display:flex;flex-direction:column;gap:6px;animation:statIn 460ms cubic-bezier(.2,.7,.2,1) backwards;}
.deck-stats .stat:nth-child(1){animation-delay:.14s;} .deck-stats .stat:nth-child(2){animation-delay:.2s;} .deck-stats .stat:nth-child(3){animation-delay:.26s;}
@keyframes statIn{ from{ opacity:0; transform:translateY(6px); } to{ opacity:1; transform:translateY(0); } }
.deck-stats .stat-k{font-size:9px;color:var(--ink-3);text-transform:uppercase;letter-spacing:0.09em;font-family:var(--mono);font-weight:500;display:flex;align-items:center;gap:6px;}
.deck-stats .stat-k .d{width:6px;height:6px;border-radius:50%;}
.deck-stats .stat-v{font-size:19px;font-weight:700;color:var(--ink);font-family:var(--mono);letter-spacing:-0.025em;line-height:1;}
.deck-stats .stat.hero{gap:7px;} .deck-stats .stat-row{display:flex;align-items:flex-end;gap:9px;} .deck-stats .spark{display:block;}
.deck-stats .stat-warn .stat-v{color:#b9701c;} .deck-stats .stat-bad .stat-v{color:#cf3340;}
.deck-actions{margin-left:auto;display:flex;gap:10px;position:relative;z-index:2;padding-left:24px;align-items:center;}
.deck .hbtn{display:inline-flex;align-items:center;gap:7px;padding:10px 15px;border-radius:13px;font-size:12.5px;font-weight:600;color:var(--ink-1);cursor:pointer;background:rgba(255,255,255,0.66);border:1px solid rgba(255,255,255,0.9);box-shadow:inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 6px rgba(54,70,120,0.08);transition:all 180ms cubic-bezier(.2,.7,.2,1);}
.deck .hbtn svg{width:15px;height:15px;}
.deck .hbtn:hover{transform:translateY(-1px);background:rgba(255,255,255,0.82);}
.deck .hbtn.primary{color:#fff;border:none;position:relative;overflow:hidden;background:linear-gradient(140deg, #7d72ff, #6b5fff 55%, #5f6cff);box-shadow:0 6px 16px -2px rgba(107,95,255,0.5), inset 0 1px 0 rgba(255,255,255,0.4);}
.deck .hbtn.primary::after{content:'';position:absolute;top:0;left:0;right:0;height:50%;background:linear-gradient(180deg,rgba(255,255,255,0.25),transparent);}
.deck .hbtn.primary:hover{transform:translateY(-1px);box-shadow:0 9px 22px -2px rgba(107,95,255,0.6), inset 0 1px 0 rgba(255,255,255,0.45);}

/* ============ TOOLBAR + KPIs (Apple-restraint) ============ */
.bar{ display:flex; align-items:center; gap:16px; padding:17px 20px; border-radius:20px; margin-bottom:16px;
 background:rgba(255,255,255,0.52); -webkit-backdrop-filter:blur(40px) saturate(180%); backdrop-filter:blur(40px) saturate(180%);
 border:1px solid rgba(255,255,255,0.6); box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 1px rgba(54,70,120,0.04), 0 10px 30px -14px rgba(54,70,120,0.3); }
.bar-id{ display:flex; align-items:center; gap:14px; }
.bar-icon{ width:42px; height:42px; border-radius:13px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; color:var(--purple);
 background:linear-gradient(150deg, rgba(107,95,255,0.16), rgba(91,140,255,0.10)); border:1px solid rgba(255,255,255,0.7); box-shadow: inset 0 1px 0 rgba(255,255,255,0.8); }
.bar-title{ font-size:22px; font-weight:700; letter-spacing:-0.035em; color:var(--ink); line-height:1.05; }
.bar-sub{ font-size:12.5px; color:var(--ink-3); margin-top:3px; } .bar-sub b{ color:var(--ink-2); font-weight:600; }
.bar-actions{ margin-left:auto; display:flex; gap:10px; }
.bar .b{ display:inline-flex; align-items:center; gap:7px; padding:10px 16px; border-radius:12px; font-size:13px; font-weight:600; cursor:pointer; transition:all 180ms cubic-bezier(.2,.7,.2,1); }
.bar .b svg{ width:15px; height:15px; }
.bar .b.ghost{ color:var(--ink-1); background:rgba(255,255,255,0.55); border:1px solid rgba(255,255,255,0.8); box-shadow:inset 0 1px 0 rgba(255,255,255,0.8); }
.bar .b.ghost:hover{ background:rgba(255,255,255,0.78); }
.bar .b.primary{ color:#fff; border:none; background:linear-gradient(135deg, #7a6fff, #6b5fff); box-shadow:0 4px 14px -2px rgba(107,95,255,0.5), inset 0 1px 0 rgba(255,255,255,0.35); }
.bar .b.primary:hover{ transform:translateY(-1px); box-shadow:0 8px 20px -2px rgba(107,95,255,0.6), inset 0 1px 0 rgba(255,255,255,0.4); }
.kpis{ display:grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap:14px; margin-bottom:16px; }
.kpis .k{ position:relative; padding:18px 20px; border-radius:18px; overflow:hidden; background:rgba(255,255,255,0.5);
 -webkit-backdrop-filter:blur(30px) saturate(150%); backdrop-filter:blur(30px) saturate(150%); border:1px solid rgba(255,255,255,0.62);
 box-shadow: inset 0 1px 0 rgba(255,255,255,0.85), 0 8px 24px -14px rgba(54,70,120,0.26); }
.kpis .k-k{ font-size:10px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.08em; font-family:var(--mono); font-weight:500; display:flex; align-items:center; gap:7px; }
.kpis .k-k .d{ width:6px; height:6px; border-radius:50%; }
.kpis .k-v{ font-family:var(--mono); font-weight:700; letter-spacing:-0.03em; color:var(--ink); margin-top:10px; line-height:1; font-size:24px; }
.kpis .k.lead .k-v{ font-size:30px; }
.kpis .k-f{ font-size:11.5px; color:var(--ink-3); margin-top:9px; display:flex; align-items:center; gap:6px; }
.kpis .up{ display:inline-flex; align-items:center; gap:3px; color:#1a8e5a; font-weight:600; }
.kpis .k.lead::after{ content:''; position:absolute; right:-30px; top:-40px; width:160px; height:140px; background:radial-gradient(circle, rgba(107,95,255,0.10), transparent 65%); pointer-events:none; }
.kpis .k.warn .k-v{ color:#b9701c; } .kpis .k.bad .k-v{ color:#cf3340; }
.kpis .k-spark{ position:absolute; right:16px; bottom:16px; }
.kpis .tag{ font-size:10.5px; font-weight:700; padding:3px 9px; border-radius:7px; }
.kpis .tag.warn{ background:rgba(247,152,74,0.16); color:#b9701c; } .kpis .tag.bad{ background:rgba(239,93,106,0.13); color:#cf3340; }
/* ===== MODAL Nuevo/Editar producto (costo → margen → guard Ofertas) ===== */
.pmov{ position:fixed; inset:0; z-index:100; background:rgba(20,26,44,0.42); -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px); display:none; align-items:center; justify-content:center; padding:24px; }
.pmov.open{ display:flex; }
.pmod{ width:100%; max-width:500px; max-height:92vh; overflow-y:auto; background:var(--glass-bg-2); -webkit-backdrop-filter:blur(32px) saturate(150%); backdrop-filter:blur(32px) saturate(150%); border:var(--glass-bd); border-radius:22px; box-shadow:0 24px 70px rgba(20,26,44,0.35); padding:24px; animation:pmIn 220ms cubic-bezier(.16,1,.3,1); }
@keyframes pmIn{ from{ opacity:0; transform:translateY(16px) scale(.98); } }
.pm-head{ display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:18px; }
.pm-title{ font-size:19px; font-weight:700; letter-spacing:-0.02em; }
.pm-sub{ font-size:12.5px; color:var(--ink-3); margin-top:2px; }
.pm-x{ width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; color:var(--ink-2); background:rgba(13,20,36,0.05); flex:0 0 auto; cursor:pointer; }
.pm-x svg{ width:16px; height:16px; }
.pm-fld{ margin-bottom:14px; } .pm-fld label{ display:block; font-size:11.5px; font-weight:600; color:var(--ink-2); margin-bottom:6px; }
.pm-fld input, .pm-fld select{ width:100%; font-size:13.5px; background:#fff; border:1px solid rgba(13,20,36,0.12); border-radius:10px; padding:10px 12px; outline:none; font-family:inherit; box-sizing:border-box; }
.pm-fld input:focus, .pm-fld select:focus{ border-color:var(--purple); }
.pm-row{ display:flex; gap:10px; } .pm-row .pm-fld{ flex:1; }
.pm-warn{ display:none; align-items:center; gap:9px; padding:11px 13px; border-radius:11px; background:rgba(239,93,106,0.10); border:1px solid rgba(239,93,106,0.32); color:#c93545; font-size:12px; font-weight:600; margin:4px 0 14px; line-height:1.4; }
.pm-warn.show{ display:flex; } .pm-warn svg{ width:17px; height:17px; flex:0 0 auto; }
.pm-prev{ display:flex; gap:14px; padding:14px; border-radius:12px; background:rgba(255,255,255,0.62); border:1px solid rgba(255,255,255,0.85); margin:4px 0 12px; }
.pm-prev .pc{ flex:1; } .pm-prev .pk{ font-size:10.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.05em; } .pm-prev .pv{ font-size:17px; font-weight:700; margin-top:3px; font-variant-numeric:tabular-nums; }
.pm-prev .pv.mgok{ color:#1a8e5a; } .pm-prev .pv.mgtight{ color:#9a7a10; } .pm-prev .pv.mgbad{ color:#c93545; }
.pm-note{ font-size:11px; color:var(--ink-3); margin:0 0 16px; line-height:1.45; } .pm-note b{ color:var(--purple); }
.pm-acts{ display:flex; gap:10px; justify-content:flex-end; }
.pm-btn{ font-size:13px; font-weight:600; padding:10px 17px; border-radius:11px; cursor:pointer; }
.pm-btn.ghost{ color:var(--ink-2); background:rgba(13,20,36,0.05); }
.pm-btn.primary{ color:#fff; background:linear-gradient(140deg,var(--purple),#9088ff); box-shadow:0 6px 16px rgba(107,95,255,0.4); }
.pm-photo{ position:relative; height:118px; border-radius:12px; border:1.5px dashed rgba(107,95,255,0.35); background:rgba(107,95,255,0.04); display:flex; align-items:center; justify-content:center; cursor:pointer; overflow:hidden; transition:all 140ms; }
.pm-photo:hover{ background:rgba(107,95,255,0.07); border-color:rgba(107,95,255,0.55); }
.pm-photo img{ display:none; width:100%; height:100%; object-fit:contain; background:#fff; }
.pm-photo.has img{ display:block; } .pm-photo.has .pm-photo-empty{ display:none; }
.pm-photo-empty{ display:flex; align-items:center; gap:11px; color:var(--ink-3); padding:0 16px; }
.pm-photo-empty svg{ width:26px; height:26px; color:var(--purple); opacity:.85; flex:0 0 auto; }
.pm-photo-empty b{ font-size:12.5px; font-weight:600; color:var(--ink-2); display:block; }
.pm-photo-empty small{ font-size:10.5px; font-weight:400; color:var(--ink-3); }
.pm-photo-x{ position:absolute; top:7px; right:7px; width:24px; height:24px; border-radius:8px; background:rgba(13,20,36,0.55); color:#fff; display:none; align-items:center; justify-content:center; cursor:pointer; }
.pm-photo.has .pm-photo-x{ display:flex; } .pm-photo-x svg{ width:12px; height:12px; }

/* barra de scroll del contenido principal — consistente y siempre visible */
.main{ overflow-y:scroll; }
.main::-webkit-scrollbar{ width:7px; }
.main::-webkit-scrollbar-track{ background:transparent; }
.main::-webkit-scrollbar-thumb{ background:rgba(13,20,36,0.14); border-radius:5px; border:2px solid transparent; background-clip:padding-box; }

/* Zona de foto apagada: el flujo de subida a Storage no existe todavia, y un
   recuadro que no hace nada seria peor que decirlo. Mismo criterio que la fila
   de QR en el cobro del POS. */
.pm-photo[data-off="1"]{ opacity:0.55; cursor:not-allowed; border-style:dashed; }
.pm-photo[data-off="1"] small{ display:block; font-size:10.5px; margin-top:2px; }
/* BORRADO (2026-09-06): habia aca un .pm-backdrop propio + un override de
   .pmod que lo reposicionaba a mano. Los tres estaban mal:
     - el backdrop era mas claro y con menos blur que el de la maqueta
       (rgba .34 / blur 2px contra el rgba .42 / blur 6px de .pmov)
     - el override pedia 660px donde la maqueta dice 500
     - y su transform:translate(-50%,-50%) chocaba con @keyframes pmIn, que
       tambien anima transform: el modal entraba desde el lugar equivocado
   Ahora el markup usa .pmov, como la maqueta, que ademas centra solo porque
   es flex: no hay nada que reposicionar. */
.pm-acts{ display:flex; gap:10px; justify-content:flex-end; margin-top:6px; }
.pm-check{ display:flex; align-items:center; gap:9px; font-size:12.5px; color:var(--ink-2); margin:2px 0 16px; cursor:pointer; }
.pm-check i{ color:var(--ink-3); font-style:normal; }
/* Boton base. OJO: en la maqueta la clase .b esta DUPLICADA — se usa para los
   botones y tambien para las barras de un grafico (flex:1; border-radius:5px).
   Gana la ultima por orden de carga, o sea que es una colision real del
   mockup. Aca se define con ALCANCE ACOTADO a los contenedores de botones
   para no heredar ese bug si algun dia entra un grafico con barras .b. */
.bar-actions .b, .pm-acts .b, .cd-btns .b{
  display:inline-flex; align-items:center; justify-content:center; gap:7px;
  padding:10px 16px; border-radius:12px; font-size:13px; font-weight:600;
  cursor:pointer; border:none; transition:all 180ms cubic-bezier(.2,.7,.2,1);
}
.bar-actions .b:disabled, .pm-acts .b:disabled, .cd-btns .b:disabled{
  opacity:0.5; cursor:not-allowed;
}
.bar-actions .b.primary:hover:not(:disabled),
.pm-acts .b.primary:hover:not(:disabled){ transform:translateY(-1px); }
/* Variantes con el MISMO alcance acotado que la base, para que ganen sin
   depender del orden de carga contra las .b sueltas de la maqueta. Valores
   copiados de .b.primary / .b.ghost del mockup. */
.bar-actions .b.primary, .pm-acts .b.primary, .cd-btns .b.primary{
  color:#fff; border:none;
  background:linear-gradient(135deg, #7a6fff, #6b5fff);
  box-shadow:0 4px 14px -2px rgba(107,95,255,0.5), inset 0 1px 0 rgba(255,255,255,0.35);
}
.bar-actions .b.ghost, .pm-acts .b.ghost, .cd-btns .b.ghost{
  color:var(--ink-1); background:rgba(255,255,255,0.55);
  border:1px solid rgba(255,255,255,0.8);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.8);
}
/* Clase base de .quick — no habia quedado en la extraccion y sin ella el
   boton renderiza con los estilos por defecto del navegador. */
.quick{ display:flex; flex-direction:column; gap:9px; padding:15px 13px; border-radius:15px; text-align:left; background:rgba(255,255,255,0.7); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); transition:all 180ms; }
.quick:disabled{ cursor:not-allowed; color:var(--ink-3); }
.quick:disabled:hover{ transform:none; box-shadow:none; }

/* Las filas de reposicion son <button> para poder tocarlas. Sin este reset
   arrastran el padding, el borde y el fondo por defecto del navegador, y la
   fila queda mucho mas alta y con un fondo gris que la maqueta no tiene. */
/* Reset acotado de los botones del modal. font-FAMILY, no font: el reset
   global de la maqueta usa font:inherit y aca, al final del archivo, le
   ganaria por orden al font-size que define cada clase. */
button.pm-x, button.pm-btn{ font-family:inherit; border:none; outline:none; }
button.pm-btn[disabled]{ opacity:0.5; cursor:not-allowed; box-shadow:none; }
button.stock-row{ width:100%; text-align:left; background:none; border:none; border-top:1px solid rgba(13,20,36,0.05); font-family:inherit; font-size:12.5px; color:inherit; cursor:pointer; }
button.stock-row:first-of-type{ border-top:none; }
button.stock-row:hover{ background:rgba(107,95,255,0.04); }
/* COLISION ENTRE MAQUETAS: el selector .card significa cosas distintas.
   En el POS (shellCss) es la TARJETA DE PRODUCTO de la grilla — sin padding,
   con :hover que la levanta y :active que la encoge. En Productos es un PANEL
   (padding 22px, quieto). El filtro de duplicados de la extraccion se quedo
   con la del POS y descarto esta, asi que los paneles quedaban sin padding y
   ademas saltaban al pasar el mouse.
   Se define con alcance acotado a los contenedores de esta pantalla. */
.cli-grid > .card, .col-side .card{ padding:22px; display:block; }
.cli-grid > .card:hover, .col-side .card:hover{ transform:none; box-shadow:var(--glass-hi); border-color:rgba(255,255,255,0.92); }
.cli-grid > .card:active, .col-side .card:active{ transform:none; }
/* El texto de la tarjeta de reposicion es chico, como la maqueta. */
.col-side .stock-name{ font-size:12.5px; font-weight:600; }
.col-side .quick{ font-size:13px; }
.col-side .pm-note{ font-size:11px; }

/* ===== PROPORCIONES: dos cosas que el shell agrega y la maqueta no =====
   (medido 2026-09-06 comparando la pantalla contra su maqueta en el mismo
   navegador y al mismo ancho)

   1. line-height. La maqueta no declara ninguno, o sea 'normal'. Tailwind
      Preflight le pone 1.5 a <html> = 24px, y eso engorda TODO lo que mide por
      su contenido: los botones del filtro pasaban de 29px a 33, la barra de
      titulo de 78 a 81 y las tarjetas de KPI de 114 a 119.
   2. gap. La maqueta separa los bloques con el margin-bottom de cada uno; el
      shell ADEMAS pone gap:9px en .main, y los dos se suman: 25px de
      separacion donde la maqueta tiene 16.

   Va acotado a .main a proposito: la barra lateral la pinta shellCss con los
   valores del POS y tiene que seguir viendose igual en todas las pantallas. */
.main{ line-height:normal; gap:0; }
`;
