// CSS del Panel — COPIA COMPLETA Y VERBATIM de los dos <style> de
// public/panel.html, la maqueta que el owner aprobo.
//
// Se copia ENTERO por la misma razon que Clientes, Productos y Contador:
// filtrar las reglas cuyo selector ya existe en shellCss deja la pantalla
// pintada con los valores del POS, que son OTROS aunque el selector se llame
// igual. La maqueta es la autoridad y este <style> se monta despues del shell,
// asi que gana donde difieran.
//
// GENERADO, no escrito a mano: son 41.000 caracteres y copiarlos a mano es como
// se pierde una regla. Regenerar con scripts/extraer-css-panel.py si la maqueta
// cambia.
//
// OJO: es UN TEMPLATE LITERAL. Los backticks y las interpolaciones del CSS
// original vienen escapados por el generador.
import { RESET_CARD_POS } from '../_css/reset-card-pos';

export const PANEL_CSS = `
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
.grid2cal{ display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:16px; align-items:start; }

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

/* ════════════════ MODO OSCURO · cielo nocturno (Claude Design) ════════════════ */
html[data-theme="dark"]{
  --ink:#eef2ff; --ink-1:#cdd6f0; --ink-2:#9aa6cc; --ink-3:#7581a8; --ink-4:#525e85;
  --purple:#8da2ff; --purple-2:#bcc8ff; --blue:#6fa8ff; --green:#3fd68b; --orange:#ffb87a; --pink:#f48fb5; --red:#ff8b96; --yellow:#f4c948; --teal:#5fc8ff;
  --glass-bg:rgba(24,31,58,0.55); --glass-bg-2:rgba(29,37,66,0.66);
  --glass-bd:1px solid rgba(255,255,255,0.12);
  --glass-hi:inset 0 1px 0 rgba(255,255,255,0.07);
  --glass-sh:0 8px 32px rgba(3,7,20,0.42), 0 2px 8px rgba(3,7,20,0.28);
}
html[data-theme="dark"] body{ color:var(--ink); }
html[data-theme="dark"] .bg .base{ background:linear-gradient(180deg,#030615 0%,#05091e 35%,#08102b 72%,#0b1535 100%); }
html[data-theme="dark"] .bg .glow{ background:
  radial-gradient(ellipse 60% 50% at 14% 92%, rgba(244,115,168,0.16) 0%, transparent 60%),
  radial-gradient(ellipse 55% 45% at 84% 12%, rgba(120,190,255,0.12) 0%, transparent 60%),
  radial-gradient(ellipse 60% 45% at 78% 82%, rgba(96,150,255,0.13) 0%, transparent 60%),
  radial-gradient(ellipse 50% 40% at 22% 32%, rgba(86,124,238,0.16) 0%, transparent 60%); }
html[data-theme="dark"] .bg::after{ content:''; position:absolute; inset:0; pointer-events:none; background:
  radial-gradient(2.2px 2.2px at 15% 12%, rgba(255,255,255,0.95) 40%, transparent 100%),
  radial-gradient(2px 2px at 68% 7%, rgba(190,228,255,0.9) 40%, transparent 100%),
  radial-gradient(2.2px 2.2px at 88% 26%, rgba(255,205,225,0.8) 40%, transparent 100%),
  radial-gradient(1.4px 1.4px at 12% 14%, rgba(255,255,255,0.7) 50%, transparent 100%),
  radial-gradient(1.6px 1.6px at 38% 22%, rgba(255,255,255,0.55) 50%, transparent 100%),
  radial-gradient(1.5px 1.5px at 61% 16%, rgba(255,255,255,0.6) 50%, transparent 100%),
  radial-gradient(1.4px 1.4px at 84% 19%, rgba(255,255,255,0.55) 50%, transparent 100%),
  radial-gradient(1.2px 1.2px at 18% 34%, rgba(180,222,255,0.36) 50%, transparent 100%),
  radial-gradient(1.3px 1.3px at 55% 38%, rgba(255,255,255,0.3) 50%, transparent 100%),
  radial-gradient(1.2px 1.2px at 80% 42%, rgba(255,214,230,0.3) 50%, transparent 100%),
  radial-gradient(1.2px 1.2px at 8% 52%, rgba(180,222,255,0.26) 50%, transparent 100%),
  radial-gradient(1.3px 1.3px at 64% 58%, rgba(180,222,255,0.22) 50%, transparent 100%),
  radial-gradient(1.2px 1.2px at 33% 68%, rgba(255,255,255,0.2) 50%, transparent 100%),
  radial-gradient(1.2px 1.2px at 22% 84%, rgba(255,255,255,0.18) 50%, transparent 100%),
  radial-gradient(1.3px 1.3px at 76% 90%, rgba(255,214,230,0.18) 50%, transparent 100%);
  animation:twinkle 6.5s ease-in-out infinite; z-index:0; }
@keyframes twinkle{ 0%,100%{opacity:0.82;} 50%{opacity:1;} }
@media (prefers-reduced-motion:reduce){ html[data-theme="dark"] .bg::after{ animation:none; } }
html[data-theme="dark"] ::-webkit-scrollbar-thumb{ background:rgba(255,255,255,0.16); }
html[data-theme="dark"] .main::-webkit-scrollbar-thumb{ background:rgba(255,255,255,0.16); }

/* sidebar + topbar */
html[data-theme="dark"] .logo-text{ background:linear-gradient(135deg,#eef2ff 0%,#aebde8 100%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
html[data-theme="dark"] .nav-item:hover{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .nav-item.active{ background:rgba(255,255,255,0.12); box-shadow:inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 12px rgba(3,7,20,0.3); }
html[data-theme="dark"] .afip{ background:rgba(52,199,125,0.1); border-color:rgba(52,199,125,0.22); }
html[data-theme="dark"] .afip-name{ color:#55dd9b; }
html[data-theme="dark"] .afip-sub{ color:#7fb79b; }
html[data-theme="dark"] .cashier{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); box-shadow:inset 0 1px 0 rgba(255,255,255,0.07); }
html[data-theme="dark"] .seg button.on{ background:rgba(238,242,255,0.94); color:#0d1424; }
html[data-theme="dark"] .iconbtn .ndot{ border-color:rgba(11,17,42,0.9); }

/* hero + floating cards */
html[data-theme="dark"] .hero-hi{ color:var(--ink-2); }
html[data-theme="dark"] .hero-live{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .hero-art .halo{ background:radial-gradient(circle, rgba(141,162,255,0.4) 0%, rgba(120,190,255,0.18) 40%, transparent 70%); }
html[data-theme="dark"] .float-card{ background:rgba(33,40,70,0.82); border-color:rgba(255,255,255,0.14); box-shadow:0 12px 32px rgba(3,7,20,0.5), 0 4px 12px rgba(3,7,20,0.35); }
html[data-theme="dark"] .delta.up{ background:rgba(52,199,125,0.16); color:#55dd9b; }
html[data-theme="dark"] .delta.down{ background:rgba(239,93,106,0.16); color:#ff8b96; }

/* charts + tooltips */
html[data-theme="dark"] .chart-tip{ background:#0b1430; }
html[data-theme="dark"] .chart-tip::after{ background:#0b1430; }

/* listas / tx / widgets col derecha */
html[data-theme="dark"] .tx-row{ border-top-color:rgba(255,255,255,0.06); }
html[data-theme="dark"] .divider{ background:rgba(255,255,255,0.08); }
html[data-theme="dark"] .caja-state{ color:#55dd9b; }
html[data-theme="dark"] .afipbar .cell{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .stock-row{ border-top-color:rgba(255,255,255,0.06); }
html[data-theme="dark"] .stock-thumb{ background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .stock-q{ background:rgba(239,93,106,0.16); color:#ff8b96; }
html[data-theme="dark"] .quick{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .quick:hover{ box-shadow:inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(3,7,20,0.5); }

/* calendario */
html[data-theme="dark"] .cd-ic.ret{ color:#e79ad0; }
html[data-theme="dark"] .cd-ic.note{ color:#ffb87a; }

/* pendientes / todos */
html[data-theme="dark"] .todo-item:hover{ background:rgba(255,255,255,0.05); }
html[data-theme="dark"] .todo-check{ border-color:rgba(255,255,255,0.24); }
html[data-theme="dark"] .todo-add{ border-top-color:rgba(255,255,255,0.07); }
html[data-theme="dark"] .todo-add .plus{ border-color:rgba(255,255,255,0.24); }
html[data-theme="dark"] .todo-group.over{ color:#ff8b96; }
html[data-theme="dark"] .streak{ color:#ffcf6b; background:rgba(244,201,72,0.18); }
html[data-theme="dark"] .tf-btn{ background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .tf-btn:hover{ background:rgba(255,255,255,0.1); }
html[data-theme="dark"] .tf-menu{ background:rgba(20,26,46,0.9); border-color:rgba(255,255,255,0.12); box-shadow:0 12px 34px rgba(3,7,20,0.5); }
html[data-theme="dark"] .tf-menu button:hover{ background:rgba(141,162,255,0.12); }

/* quick-add */

/* cuentas corrientes */
html[data-theme="dark"] .cc-col2{ border-left-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .cc-tot.cobrar{ color:#55dd9b; }
html[data-theme="dark"] .cc-tot.pagar{ color:#ff8b96; }
html[data-theme="dark"] .cc-row{ border-top-color:rgba(255,255,255,0.06); }
html[data-theme="dark"] .ring-pct{ color:var(--ink); }

/* botón toggle de tema */
#themeBtn svg{ transition:transform 400ms cubic-bezier(.2,.7,.2,1); }
#themeBtn:hover svg{ transform:rotate(20deg); }

            .ev .pay{ background:var(--red); } .ev .col{ background:var(--green); } .ev .tax{ background:var(--orange); }
            .todo-list{ display:flex; flex-direction:column; gap:1px; flex:1; min-height:0; overflow-y:auto; padding-right:5px; }
            .todo-item{ display:flex; align-items:flex-start; gap:11px; padding:9px 7px; border-radius:10px; cursor:pointer; transition:background 150ms; }
            .todo-item:hover{ background:rgba(255,255,255,0.5); }
            .todo-check{ width:19px; height:19px; border-radius:6px; border:2px solid rgba(13,20,36,0.18); flex:0 0 auto; margin-top:1px; display:flex; align-items:center; justify-content:center; transition:all 150ms; }
            .todo-check svg{ width:12px; height:12px; color:#fff; opacity:0; transition:opacity 150ms; }
            .todo-item.done .todo-check{ background:var(--green); border-color:var(--green); }
            .todo-item.done .todo-check svg{ opacity:1; }
            .todo-tx{ flex:1; min-width:0; }
            .todo-n{ font-size:13px; font-weight:500; color:var(--ink-1); transition:color 150ms; }
            .todo-item.done .todo-n{ color:var(--ink-3); text-decoration:line-through; }
            .todo-s{ font-size:10.5px; color:var(--ink-3); margin-top:2px; }
            .todo-tag{ font-size:9.5px; font-weight:700; padding:2px 8px; border-radius:6px; flex:0 0 auto; margin-top:1px; white-space:nowrap; }
            .todo-add{ display:flex; align-items:center; gap:11px; padding:11px 7px 2px; margin-top:7px; border-top:1px solid rgba(13,20,36,0.06); }
            .todo-add .plus{ width:19px;height:19px;border-radius:6px;border:2px dashed rgba(13,20,36,0.22);flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:var(--ink-3);font-size:13px;line-height:1; }
            .todo-add input{ flex:1; font-size:12.5px; color:var(--ink-1); background:none; border:none; outline:none; }
            .todo-add input::placeholder{ color:var(--ink-3); }
            .cc-grid{ display:grid; grid-template-columns:1fr 1fr; gap:22px; }
            .cc-col2{ border-left:1px solid rgba(13,20,36,0.07); padding-left:22px; }
            .cc-col-h{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:10px; }
            .cc-lbl{ font-size:10.5px; text-transform:uppercase; letter-spacing:0.06em; font-family:var(--mono); color:var(--ink-3); font-weight:600; display:inline-flex; align-items:center; gap:6px; }
            .cc-lbl i{ width:7px; height:7px; border-radius:50%; }
            .cc-tot{ font-family:var(--mono); font-size:21px; font-weight:700; letter-spacing:-0.02em; }
            .cc-tot.cobrar{ color:#1a8e5a; } .cc-tot.pagar{ color:#c93545; }
            .cc-row{ display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid rgba(13,20,36,0.05); }
            .cc-av{ width:30px;height:30px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10.5px;font-weight:700; }
            .cc-tx{ flex:1; min-width:0; } .cc-n{ font-size:12.5px; font-weight:500; color:var(--ink-1); } .cc-s{ font-size:10.5px; color:var(--ink-3); margin-top:1px; }
            .cc-m{ font-family:var(--mono); font-size:12.5px; font-weight:700; color:var(--ink-1); flex:0 0 auto; }
            .ring-wrap{ position:relative; width:78px; height:78px; flex:0 0 auto; }
            .ring-ctr{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
            .ring-pct{ font-size:17px; font-weight:700; color:var(--ink); font-family:var(--mono); letter-spacing:-0.02em; }
            .streak{ display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:700; color:#b9791a; background:rgba(244,201,72,0.20); padding:4px 10px; border-radius:999px; }
            .todo-group{ font-size:10px; text-transform:uppercase; letter-spacing:0.07em; font-family:var(--mono); font-weight:600; color:var(--ink-3); margin:12px 6px 2px; display:flex; align-items:center; gap:6px; }
            .todo-group.over{ color:#c93545; }
            .todo-recur{ font-size:10px; color:var(--ink-3); display:inline-flex; align-items:center; gap:4px; }
            .todo-item.done .todo-check svg{ animation:checkpop 360ms cubic-bezier(.34,1.56,.64,1); }
            @keyframes checkpop{ 0%{transform:scale(0)} 55%{transform:scale(1.35)} 100%{transform:scale(1)} }
            .todo-filter{ position:relative; }
            .tf-btn{ display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; color:var(--ink-2); background:rgba(255,255,255,0.6); border:1px solid rgba(255,255,255,0.85); padding:5px 9px; border-radius:9px; cursor:pointer; transition:background 150ms; }
            .tf-btn:hover{ background:rgba(255,255,255,0.9); }
            .tf-chev{ transition:transform 180ms; opacity:0.6; }
            .todo-filter.open .tf-chev{ transform:rotate(180deg); }
            .tf-menu{ position:absolute; top:calc(100% + 6px); right:0; z-index:30; min-width:172px; background:rgba(255,255,255,0.82); backdrop-filter:blur(20px) saturate(140%); -webkit-backdrop-filter:blur(20px) saturate(140%); border:1px solid rgba(255,255,255,0.9); border-radius:13px; box-shadow:0 12px 34px rgba(13,20,36,0.16); padding:6px; display:none; flex-direction:column; gap:1px; }
            .todo-filter.open .tf-menu{ display:flex; }
            .tf-menu button{ display:flex; align-items:center; gap:9px; font-size:12.5px; font-weight:500; color:var(--ink-1); background:transparent; border:none; padding:8px 10px; border-radius:8px; cursor:pointer; text-align:left; transition:background 120ms; }
            .tf-menu button:hover{ background:rgba(107,95,255,0.08); }
            .tf-menu button.on{ background:rgba(107,95,255,0.12); color:var(--ink); font-weight:600; }
            .tf-dot{ width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
            .ev .ret{ background:#d65db1; } .ev .note{ background:#f7984a; } .ev .ret.over{ background:var(--red); }
            .cal-sec-label{ font-size:10px; text-transform:uppercase; letter-spacing:0.07em; font-family:var(--mono); font-weight:600; color:var(--ink-3); margin-bottom:10px; }
            .cal-detail-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:11px; }
            .cal-addnote{ display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; color:var(--purple); background:rgba(107,95,255,0.1); border:none; padding:5px 10px; border-radius:8px; cursor:pointer; transition:background 150ms; }
            .cal-addnote:hover{ background:rgba(107,95,255,0.18); }
            .cal-addnote svg{ width:12px; height:12px; }
            .cal-detail-body{ display:flex; flex-direction:column; gap:10px; }
            .cd-row{ display:flex; align-items:center; gap:11px; }
            .cd-ic{ width:30px; height:30px; border-radius:9px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; }
            .cd-ic svg{ width:15px; height:15px; }
            .cd-ic.ret{ background:rgba(214,93,177,0.14); color:#b0388f; }
            .cd-ic.ret.over{ background:rgba(239,93,106,0.15); color:#c93545; }
            .cd-ic.note{ background:rgba(247,152,74,0.16); color:#b96c1a; }
            .cd-tx{ flex:1; min-width:0; } .cd-n{ font-size:12.5px; font-weight:500; color:var(--ink-1); } .cd-s{ font-size:10.5px; color:var(--ink-3); margin-top:1px; }
            .cd-amt{ font-family:var(--mono); font-size:12.5px; font-weight:700; flex:0 0 auto; }
            .cd-empty{ font-size:12px; color:var(--ink-3); padding:4px 0; }
            .pdv-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
            .pdv-head span{ font-size:11px; text-transform:uppercase; letter-spacing:0.06em; font-family:var(--mono); font-weight:600; color:var(--ink-2); }
            .pdv-back{ font-size:11px; font-weight:600; color:var(--purple); background:rgba(107,95,255,0.1); border:none; padding:4px 10px; border-radius:8px; cursor:pointer; transition:background 150ms; }
            .pdv-back:hover{ background:rgba(107,95,255,0.18); }
            .just-added{ animation:qaIn 400ms ease; }
            @keyframes qaIn{ from{ opacity:0; transform:translateY(-6px); } to{ opacity:1; transform:none; } }
/* ═══════════ INGRESOS VS GASTOS — barras pareadas por mes ═══════════
   La maqueta dibujaba este bloque con un SVG fijo, porque los gastos no
   existian: era la unica forma de mostrarlo. Ahora las dos series salen de la
   base y la altura de cada barra es el dato.
   Barras pareadas y no dos lineas: con 6 meses dos lineas se cruzan y no se
   lee cual es cual; asi se compara mes a mes de un vistazo. */
.ig-grid{ display:grid; grid-auto-flow:column; grid-auto-columns:1fr; gap:14px; height:132px; margin-top:10px; align-items:end; }
.ig-mes{ display:flex; flex-direction:column; align-items:center; gap:7px; height:100%; justify-content:flex-end; }
.ig-barras{ display:flex; align-items:flex-end; justify-content:center; gap:5px; width:100%; height:100%; }
.ig-b{ width:42%; max-width:26px; min-height:2px; border-radius:5px 5px 2px 2px;
       animation:grow 900ms cubic-bezier(.2,.7,.2,1) backwards; transform-origin:bottom; }
.ig-b.ing{ background:linear-gradient(180deg,var(--purple),rgba(107,95,255,0.55)); }
.ig-b.gas{ background:linear-gradient(180deg,var(--orange),rgba(247,152,74,0.5)); }
/* Mes sin gastos cargados: se reserva el LUGAR pero no se pinta nada, para que
   la barra de ingresos no se corra de columna y el hueco se lea como hueco. */
.ig-b.vacia{ background:none; animation:none; min-height:0; }
.ig-rot{ font-size:10.5px; color:var(--ink-3); font-family:var(--mono); }

/* ═══ FACTURACION DEL MES — las dos barras comparativas ═══
   Hacen visible de donde sale el porcentaje de arriba. Antes estaba el
   "+22,3%" pelado y habia que creerle. */
.cmp{ margin-top:14px; }
.cmp-fila{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:5px; }
.cmp-rot{ font-size:11.5px; color:var(--ink-3); }
.cmp-val{ font-size:12.5px; font-weight:700; color:var(--ink-2); }
.cmp-pista{ height:8px; border-radius:999px; background:rgba(13,20,36,0.06); overflow:hidden; }
.cmp-barra{ height:100%; border-radius:999px; animation:crecerAncho 800ms cubic-bezier(.2,.7,.2,1) backwards; }
.cmp-barra.ant{ background:rgba(122,130,155,0.45); }
.cmp-barra.act{ background:linear-gradient(90deg,var(--purple),var(--purple-2)); }
@keyframes crecerAncho{ from{ width:0 !important; } }
html[data-theme="dark"] .cmp-pista{ background:rgba(255,255,255,0.08); }

/* ═══════════════ EVOLUCION DE VENTAS ═══════════════ */
.ev-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.ev-head h3{ font-size:14px; font-weight:600; color:var(--ink); display:flex; align-items:center; gap:8px; }
.ev-head .ic{ width:24px; height:24px; border-radius:7px; display:flex; align-items:center; justify-content:center; }

/* El toggle. Mismo lenguaje que .seg de la topbar, mas chico. */
.ev-seg{ display:inline-flex; padding:4px; gap:2px; border-radius:999px; background:rgba(13,20,36,0.05); }
.ev-seg button{ padding:6px 15px; border-radius:999px; font-size:12px; font-weight:600; color:var(--ink-3);
                font-family:inherit; border:none; background:none; cursor:pointer; transition:all 180ms; }
.ev-seg button:hover{ color:var(--ink-1); }
.ev-seg button.on{ background:#fff; color:var(--ink); box-shadow:0 1px 3px rgba(54,70,120,0.14); }
.ev-seg button:focus-visible{ outline:2px solid var(--purple); outline-offset:1px; }
html[data-theme="dark"] .ev-seg{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .ev-seg button.on{ background:rgba(255,255,255,0.14); }

.ev-caja{ position:relative; margin-top:10px; }
.ev-svg{ width:100%; height:190px; display:block; overflow:visible; cursor:crosshair; }
.ev-guia{ stroke:rgba(13,20,36,0.06); stroke-width:1; }
.ev-linea{ stroke:var(--purple); stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round;
           filter:drop-shadow(0 4px 10px rgba(107,95,255,0.28)); }
.ev-vertical{ stroke:rgba(13,20,36,0.22); stroke-width:1; stroke-dasharray:3 4; }
.ev-punto{ fill:var(--purple); stroke:#fff; stroke-width:2.5; }
html[data-theme="dark"] .ev-guia{ stroke:rgba(255,255,255,0.07); }
html[data-theme="dark"] .ev-vertical{ stroke:rgba(255,255,255,0.24); }
html[data-theme="dark"] .ev-punto{ stroke:#141c33; }

/* El tooltip es HTML: el SVG estira todo lo que tenga adentro, tipografia
   incluida, porque usa preserveAspectRatio="none". */
.ev-tip{ position:absolute; transform:translate(-50%,-125%); pointer-events:none; z-index:3;
         background:var(--ink); color:#fff; border-radius:10px; padding:7px 11px; white-space:nowrap;
         box-shadow:0 10px 24px rgba(13,20,36,0.30); }
.ev-tip::after{ content:''; position:absolute; left:50%; bottom:-4px; width:9px; height:9px;
                transform:translateX(-50%) rotate(45deg); background:var(--ink); }
.ev-tip-h{ font-family:var(--mono); font-size:10.5px; opacity:0.62; }
.ev-tip-v{ font-family:var(--mono); font-size:14px; font-weight:700; margin-top:1px; }
html[data-theme="dark"] .ev-tip{ background:#0a1024; }
html[data-theme="dark"] .ev-tip::after{ background:#0a1024; }

.ev-eje{ position:relative; height:16px; margin-top:2px; }
.ev-eje-t{ position:absolute; transform:translateX(-50%); font-size:10.5px; color:var(--ink-3);
           font-family:var(--mono); white-space:nowrap; }

.ev-pie{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-top:16px;
         padding-top:12px; border-top:1px solid rgba(13,20,36,0.06); font-size:12.5px; color:var(--ink-2); }
.ev-pie b{ color:var(--ink); font-weight:700; }
.ev-nota{ font-size:11.5px; color:var(--ink-3); }
.ev-vacio{ padding:36px 8px; text-align:center; font-size:12.5px; color:var(--ink-3); }
html[data-theme="dark"] .ev-pie{ border-top-color:rgba(255,255,255,0.08); }

/* ═══ MAS VENDIDOS ═══ */
.mv-row{ display:flex; align-items:center; gap:11px; padding:9px 0; border-top:1px solid rgba(13,20,36,0.05); }
.mv-row:first-of-type{ border-top:none; }
.mv-pos{ width:20px; height:20px; flex:0 0 auto; border-radius:6px; display:flex; align-items:center;
         justify-content:center; font-size:10.5px; font-weight:700; font-family:var(--mono);
         background:rgba(107,95,255,0.11); color:var(--purple); }
.mv-cuerpo{ flex:1; min-width:0; }
.mv-top{ display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:5px; }
.mv-nombre{ font-size:12.5px; font-weight:500; color:var(--ink-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mv-u{ font-size:10.5px; color:var(--ink-3); flex:0 0 auto; }
.mv-pista{ height:6px; border-radius:999px; background:rgba(13,20,36,0.05); overflow:hidden; }
.mv-barra{ height:100%; border-radius:999px; background:linear-gradient(90deg,var(--purple),var(--purple-2));
           animation:crecerAncho 800ms cubic-bezier(.2,.7,.2,1) backwards; }
.mv-monto{ font-size:12.5px; font-weight:700; color:var(--ink); flex:0 0 auto; width:88px; text-align:right; }
html[data-theme="dark"] .mv-row{ border-top-color:rgba(255,255,255,0.06); }
html[data-theme="dark"] .mv-pista{ background:rgba(255,255,255,0.07); }

/* ═══ RESULTADO DEL MES (ingresos - gastos) ═══ */
.ig-res{ display:flex; align-items:baseline; justify-content:space-between; margin-top:14px;
         padding-top:12px; border-top:1px solid rgba(13,20,36,0.06); }
.ig-res-v{ font-family:var(--mono); font-size:16px; font-weight:700; letter-spacing:-0.02em; }
.ig-res-v.pos{ color:#116b40; } .ig-res-v.neg{ color:#a72c3a; }
html[data-theme="dark"] .ig-res{ border-top-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .ig-res-v.pos{ color:#7fe0ae; }
html[data-theme="dark"] .ig-res-v.neg{ color:#ff9aa4; }

/* Monto + porcentaje en la leyenda del donut: el monto es el dato, el
   porcentaje el contexto, asi que el porcentaje va mas chico y apagado. */
.legend .pct{ font-size:10.5px; color:var(--ink-3); font-family:var(--mono); width:34px; text-align:right; }
.kv .v.neg{ color:#a72c3a; }
html[data-theme="dark"] .kv .v.neg{ color:#ff9aa4; }

/* Chip de estado de AFIP. Ambar y no rojo: que falte el certificado no es un
   error del sistema, es un paso que todavia no se dio. */
.afip-pend{ font-size:10.5px; font-weight:700; padding:4px 9px; border-radius:999px;
            background:rgba(247,152,74,0.16); color:#8a520c; }
html[data-theme="dark"] .afip-pend{ color:#ffc79a; }

/* La columna derecha scrollea con la pagina; sin esto la ultima tarjeta queda
   pegada al borde de abajo. */
.col-side{ padding-bottom:18px; }

/* ═══════ PROPORCIONES: lo que el shell agrega y la maqueta no ═══════
   Medido comparando la pantalla contra su maqueta en el mismo navegador. Son
   las mismas dos de Clientes:
     1. line-height. La maqueta no declara ninguno (o sea 'normal'); Tailwind
        Preflight le pone 1.5 al <html>, y eso engorda todo lo que mide por su
        contenido.
     2. gap. La maqueta separa los bloques con el margin-bottom de cada uno; el
        shell ADEMAS pone gap en .main, y los dos se suman.
   Va acotado a .main: la barra lateral la pinta shellCss y tiene que seguir
   viendose igual en todas las pantallas. */
.main{ line-height:normal; gap:0; }
/* ═══════════ FECHA DEL DIA ═══════════
   Va en el hero, pegada al saludo. La fecha la calcula el SERVIDOR en la zona
   del comercio y llega como string: 'new Date()' en el cliente da la fecha del
   NAVEGADOR, que a las 21h de Ushuaia ya es el dia siguiente en otra maquina,
   y ademas React marcaria hydration mismatch si el servidor y el cliente
   cayeran en dias distintos. */
.hero-fecha{ font-size:11.5px; font-weight:600; color:var(--ink-2); margin-top:5px;
             letter-spacing:0.005em; }
.hero-fecha::first-letter{ text-transform:uppercase; }

/* ═══════════ ACCIONES RAPIDAS ═══════════
   Botones y no una lista de links: son el atajo para arrancar, no navegacion.
   Cada uno lleva icono Y texto — un icono solo obliga a adivinar, y el cajero
   novato tiene que entender sin entrenamiento (CLAUDE.md §14.13). */
.qa{ display:grid; grid-template-columns:repeat(4,1fr); gap:9px; margin-top:16px; }
.qa-b{ display:flex; align-items:center; gap:9px; padding:12px 13px; border-radius:14px;
       background:rgba(255,255,255,0.5); border:1px solid rgba(255,255,255,0.8);
       box-shadow:inset 0 1px 0 rgba(255,255,255,0.85);
       font-size:12.5px; font-weight:600; color:var(--ink-1); text-decoration:none;
       transition:transform 180ms cubic-bezier(.4,0,.2,1), box-shadow 180ms, background 180ms; }
.qa-b:hover{ transform:translateY(-2px); background:rgba(255,255,255,0.72);
             box-shadow:0 6px 18px rgba(54,70,120,0.13); }
.qa-b:active{ transform:translateY(0); }
/* En modo oscuro el fondo NO puede ser blanco translucido: compuesto sobre el
   cielo nocturno da un gris medio, y el texto (que ahi es claro) quedaba en
   contraste 2.38 — ilegible. Medido sobre los pixeles pintados, no sobre el
   CSS declarado, que dice "blanco" y engana. Mismo error que las pildoras de
   /gastos. */
html[data-theme="dark"] .qa-b{ background:rgba(255,255,255,0.055);
                               border-color:rgba(255,255,255,0.10);
                               box-shadow:inset 0 1px 0 rgba(255,255,255,0.06); }
html[data-theme="dark"] .qa-b:hover{ background:rgba(255,255,255,0.10);
                                     box-shadow:0 6px 18px rgba(0,0,0,0.28); }
.qa-ic{ width:26px; height:26px; border-radius:9px; display:grid; place-items:center; flex-shrink:0; }
.qa-b svg{ width:14px; height:14px; }
@media (max-width:1100px){ .qa{ grid-template-columns:repeat(2,1fr); } }

/* ═══════════ ABRIR CAJA DESDE EL PANEL ═══════════
   Se abre desde aca porque abrir es declarar un fondo inicial y nada mas. NO
   se cierra desde aca: cerrar exige el arqueo por denominacion que vive en
   /caja, y un boton de "cerrar" en el panel seria una forma de cerrar sin
   contar. */
.qa-caja{ display:flex; gap:7px; margin-top:9px; }
.qa-caja input{ flex:1; min-width:0; padding:8px 10px; border-radius:10px;
                background:rgba(255,255,255,0.62); border:1px solid rgba(255,255,255,0.9);
                font-family:var(--mono); font-size:12.5px; text-align:right; }
.qa-caja input:focus{ border-color:var(--purple); box-shadow:0 0 0 3px rgba(107,95,255,0.14); }
.qa-caja button{ padding:8px 13px; border-radius:10px; background:var(--purple); color:#fff;
                 font-size:12px; font-weight:700; white-space:nowrap;
                 transition:filter 160ms, opacity 160ms; }
.qa-caja button:hover:not(:disabled){ filter:brightness(1.08); }
.qa-caja button:disabled{ opacity:0.55; cursor:default; }
.qa-err{ font-size:11px; color:#a72c3a; margin-top:6px; }
html[data-theme="dark"] .qa-err{ color:#ff9aa4; }

/* ═══════════ VENTAS POR RUBRO ═══════════
   Barras horizontales apiladas por rubro. Escala al MAYOR, no cada una a su
   ancho: si cada barra llenara la fila, el rubro que factura el 60% se veria
   igual que el que factura el 11% y el bloque no diria nada. */
.rub{ display:flex; flex-direction:column; gap:11px; margin-top:4px; }
.rub-r{ display:grid; grid-template-columns:1fr auto; gap:3px 10px; align-items:baseline; }
.rub-n{ font-size:12.5px; font-weight:600; color:var(--ink-1); }
.rub-v{ font-size:12.5px; font-weight:700; font-family:var(--mono); color:var(--ink); }
.rub-bar{ grid-column:1 / -1; height:7px; border-radius:999px;
          background:rgba(13,20,36,0.07); overflow:hidden; }
.rub-fill{ height:100%; border-radius:999px; transition:width 420ms cubic-bezier(.4,0,.2,1); }
.rub-sub{ grid-column:1 / -1; display:flex; justify-content:space-between;
          font-size:10.5px; color:var(--ink-2); }
.rub-sub .pctm{ font-family:var(--mono); font-weight:600; }
html[data-theme="dark"] .rub-bar{ background:rgba(255,255,255,0.10); }

/* ═══════════ CLIENTES DEL MES ═══════════ */
.cli-g{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:2px; }
.cli-c{ padding:10px 11px; border-radius:12px; background:rgba(255,255,255,0.42);
        border:1px solid rgba(255,255,255,0.7); }
.cli-n{ font-size:20px; font-weight:700; font-family:var(--mono); letter-spacing:-0.02em; }
/* Estas tres palabras —compraron / nuevos / volvieron— son lo UNICO que dice
   que significa cada numero grande. No son decorativas. */
.cli-l{ font-size:10.5px; color:var(--ink-2); margin-top:2px; font-weight:500; }
html[data-theme="dark"] .cli-c{ background:rgba(255,255,255,0.055); border-color:rgba(255,255,255,0.10); }

/* La barra identificado / consumidor final. Es el numero que decide algo, y
   por eso se dibuja: sin la parte gris, un "31%" se lee como una perdida. */
.cli-split{ margin-top:13px; }
.cli-sb{ height:9px; border-radius:999px; overflow:hidden; display:flex;
         background:rgba(13,20,36,0.07); }
html[data-theme="dark"] .cli-sb{ background:rgba(255,255,255,0.10); }
.cli-sb i{ display:block; height:100%; }
.cli-leg{ display:flex; justify-content:space-between; margin-top:7px; font-size:10.5px;
          color:var(--ink-2); gap:10px; }
.cli-leg b{ color:var(--ink-1); font-weight:600; }

/* Eco del monto ya interpretado, antes de confirmar la apertura. */
.qa-eco{ font-size:11px; color:var(--ink-2); margin-top:6px; }
.qa-eco b{ font-family:var(--mono); font-weight:700; color:var(--ink); }

/* ═══════════════ CALENDARIO ═══════════════
   Tomado de la maqueta (public/panel.html, bloque #calCard). Cambios respecto
   de ella, todos por la misma razon — la maqueta pintaba dias inventados:
     - la intensidad sale de la venta REAL del dia, calculada contra el maximo
       del mes que se esta viendo;
     - hay un estado "sin datos" que la maqueta no necesitaba tener, porque
       ella siempre tenia numeros. */
.cal-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:13px; }
/* En castellano los meses van en minúscula, y acá encima va después de un
   "·", en medio de la frase. "capitalize" daba "Calendario · Septiembre 2026",
   el mismo error que la fecha del hero. */
.cal-mes{ font-weight:600; }
.cal-nav{ display:flex; gap:6px; align-items:center; }
.cal-nav button{ height:26px; min-width:26px; padding:0 8px; border-radius:8px;
                 display:flex; align-items:center; justify-content:center;
                 color:var(--ink-2); background:rgba(255,255,255,0.55);
                 border:1px solid rgba(255,255,255,0.85); font-size:14px; line-height:1;
                 transition:background 160ms, color 160ms; }
.cal-nav button:hover{ background:rgba(255,255,255,0.85); color:var(--ink); }
.cal-hoy-btn{ font-size:11px !important; font-weight:600; }
html[data-theme="dark"] .cal-nav button{ background:rgba(255,255,255,0.06);
                                         border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .cal-nav button:hover{ background:rgba(255,255,255,0.13); }

.cal-grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:5px; }
.cal-dow{ font-size:9px; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-2);
          text-align:center; font-family:var(--mono); font-weight:600; padding-bottom:3px; }

/* El dia es un <button>: se puede tabular y activar con Enter. Un dia que se
   clickea tiene que ser alcanzable sin mouse. */
/* "aspect-ratio:1" a ancho completo daba celdas enormes: la tarjeta medía
   ~890px de alto y se comía el panel. El tope de alto las deja rectangulares y
   baja la grilla a ~340px. */
.cal-day{ aspect-ratio:1; max-height:52px; border-radius:9px; display:flex; align-items:center;
          justify-content:center; font-size:11.5px; font-weight:500; color:var(--ink-1);
          position:relative; border:1px solid rgba(255,255,255,0.45);
          background:rgba(255,255,255,0.30); cursor:pointer;
          transition:transform 140ms cubic-bezier(.4,0,.2,1), box-shadow 140ms; }
.cal-day:hover{ transform:scale(1.07); box-shadow:0 3px 10px rgba(54,70,120,0.16); z-index:1; }
.cal-day:focus-visible{ outline:2px solid var(--purple); outline-offset:1px; }
.cal-day.empty{ background:transparent !important; border:none; cursor:default; }
.cal-day.empty:hover{ transform:none; box-shadow:none; }

/* "Sin datos" NO se dibuja igual que "cero ventas": rayado y apagado. Sin esta
   distincion el calendario afirmaria que el comercio estuvo cerrado los meses
   anteriores a existir. */
.cal-day.sindato{ background:repeating-linear-gradient(45deg,
                    rgba(13,20,36,0.030) 0 4px, transparent 4px 8px) !important;
                  color:var(--ink-4); border-style:dashed; }
html[data-theme="dark"] .cal-day{ background:rgba(255,255,255,0.045);
                                  border-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .cal-day.sindato{ background:repeating-linear-gradient(45deg,
                    rgba(255,255,255,0.05) 0 4px, transparent 4px 8px) !important; }

/* El futuro: apagado y liso. Sin trama, porque no falta ningún dato — ese día
   simplemente no pasó todavía. */
.cal-day.futuro{ background:rgba(13,20,36,0.022); color:var(--ink-4); }
html[data-theme="dark"] .cal-day.futuro{ background:rgba(255,255,255,0.02); }

.cal-day.today{ box-shadow:0 0 0 2px var(--purple); color:var(--ink); font-weight:700; }
.cal-day.sel{ box-shadow:0 0 0 2px var(--ink-2); }
.cal-day.today.sel{ box-shadow:0 0 0 2px var(--purple), 0 0 0 4px rgba(107,95,255,0.28); }

/* Feriado nacional y asueto provincial se ven DISTINTO a proposito: el segundo
   no obliga al comercio, y pintarlos igual seria decir que esta cerrado. */
/* El feriado se marca con el BORDE y el numero en color, NO con el fondo: el
   fondo lo usa el heatmap y taparlo borraria cuanto se vendio ese dia. Borde y
   no box-shadow porque el box-shadow ya lo usa .today, y un feriado que cae hoy
   los pisaria. */
.cal-day.feriado.nac{ color:#2b6cb0; font-weight:700; border-color:#5b9bd5; }
.cal-day.feriado.prov{ color:#0e7c88; font-weight:700; border-color:#2bb3c0; }
html[data-theme="dark"] .cal-day.feriado.nac{ color:#9ec5ff; }
html[data-theme="dark"] .cal-day.feriado.prov{ color:#6fd8e4; }

.cal-day .ev{ position:absolute; bottom:4px; left:50%; transform:translateX(-50%);
              display:flex; gap:2px; }
.cal-day .ev i{ width:4.5px; height:4.5px; border-radius:50%; }
.cal-day .ev i.nac{ background:#2b6cb0; }
.cal-day .ev i.prov{ background:#0e8f9e; }

.cal-legend{ display:flex; gap:13px; margin-top:13px; flex-wrap:wrap; }
.cal-legend span{ font-size:10.5px; color:var(--ink-2); display:inline-flex;
                  align-items:center; gap:5px; }
.cal-legend i{ width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.cal-legend .lg-cero{ background:rgba(255,255,255,0.30); border:1px solid rgba(13,20,36,0.14); }
.cal-legend .lg-sindato{ background:repeating-linear-gradient(45deg,
                          rgba(13,20,36,0.16) 0 2px, transparent 2px 4px);
                         border:1px dashed rgba(13,20,36,0.28); }
.cal-legend .lg-futuro{ background:rgba(13,20,36,0.05); border:1px solid rgba(13,20,36,0.10); }
html[data-theme="dark"] .cal-legend .lg-futuro{ background:rgba(255,255,255,0.04);
                                                border-color:rgba(255,255,255,0.10); }
.cal-legend .lg-nac{ background:transparent; border:2px solid #5b9bd5; }
.cal-legend .lg-prov{ background:transparent; border:2px solid #2bb3c0; }
.cal-legend .lg-hoy{ background:transparent; box-shadow:0 0 0 2px var(--purple); }
html[data-theme="dark"] .cal-legend .lg-cero{ background:rgba(255,255,255,0.06);
                                              border-color:rgba(255,255,255,0.18); }

.cal-detail{ margin-top:14px; padding-top:13px; border-top:1px solid rgba(13,20,36,0.06); }
html[data-theme="dark"] .cal-detail{ border-top-color:rgba(255,255,255,0.07); }
.cal-detail-day{ font-size:12.5px; font-weight:700; color:var(--ink); }
.cal-detail-kv{ display:flex; gap:18px; margin-top:7px; font-size:11.5px; color:var(--ink-2); }
.cal-detail-kv b{ color:var(--ink); font-size:14px; }
.cal-fer{ margin-top:7px; font-size:11.5px; color:var(--ink-1); }
.cal-fer b{ color:#2b6cb0; }
html[data-theme="dark"] .cal-fer b{ color:#9ec5ff; }
.cal-fer-nota{ display:block; font-size:10.5px; color:var(--ink-2); margin-top:2px; line-height:1.4; }

/* Lo que el calendario NO tiene cargado. Ambar y no rojo: que falte el
   calendario del anio no es un error, es un paso que no se dio. */
.cal-aviso{ margin-top:13px; padding:9px 11px; border-radius:10px; font-size:10.5px;
            line-height:1.45; background:rgba(247,152,74,0.13); color:#7a4708; }
html[data-theme="dark"] .cal-aviso{ background:rgba(247,152,74,0.15); color:#ffc79a; }

/* ── Pendientes ────────────────────────────────────────────────────────────
   Lo visual de la lista sale de las reglas .todo-* de la maqueta. Aca va solo
   lo que la maqueta no tenia. */
.pend-count{ font-family:var(--mono); font-size:11px; font-weight:700;
             color:var(--ink-2); background:rgba(13,20,36,0.06);
             padding:2px 7px; border-radius:7px; margin-left:6px; }
.pend-alerta{ font-size:11px; font-weight:700; color:#a72c3a;
              background:rgba(201,53,69,0.12); padding:3px 9px; border-radius:8px; }

/* El derivado se ve DISTINTO de una tarea a proposito: no tiene casilla porque
   no se resuelve tachandolo. Si se pareciera a una tarea, alguien iba a buscar
   la casilla y no encontrarla. */
.pend-derivado{ display:flex; align-items:center; gap:11px; padding:11px 12px;
                margin-bottom:9px; border-radius:12px;
                background:rgba(247,152,74,0.11);
                border:1px solid rgba(247,152,74,0.28); }
.pend-derivado-ic{ width:26px; height:26px; border-radius:9px; flex:0 0 auto;
                   display:grid; place-items:center; color:#8a520c;
                   background:rgba(247,152,74,0.22); }
.pend-derivado-ic svg{ width:15px; height:15px; }
.pend-accion{ flex:0 0 auto; font-size:11.5px; font-weight:700; color:#8a520c;
              background:rgba(247,152,74,0.2); padding:6px 11px; border-radius:9px;
              text-decoration:none; transition:background 150ms; }
.pend-accion:hover{ background:rgba(247,152,74,0.34); }

.pend-group-n{ font-family:var(--mono); font-size:9.5px; font-weight:700;
               color:var(--ink-3); }
.todo-group.over .pend-group-n{ color:#c93545; }

.pend-vacio{ font-size:12.5px; color:var(--ink-2); padding:16px 6px; line-height:1.6; }
.pend-vacio span{ display:block; font-size:11px; color:var(--ink-3); margin-top:3px; }

.pend-borrar{ flex:0 0 auto; width:22px; height:22px; border-radius:7px;
              font-size:15px; line-height:1; color:var(--ink-4);
              background:transparent; cursor:pointer; opacity:0;
              transition:opacity 150ms, background 150ms, color 150ms; }
.todo-item:hover .pend-borrar, .pend-borrar:focus-visible{ opacity:1; }
.pend-borrar:hover{ background:rgba(201,53,69,0.12); color:#a72c3a; }

/* La casilla es un <button> y no un <div> como en la maqueta: se tiene que
   poder tachar con el teclado. El reset de arriba le saca el borde a todos los
   button, asi que .todo-check se lo devuelve por especificidad de clase. */
.todo-check{ cursor:pointer; background:transparent; }
.todo-check:hover{ border-color:var(--purple); }
.todo-check:focus-visible{ outline:2px solid var(--purple); outline-offset:2px; }

.pend-abrir{ width:100%; margin-top:11px; display:flex; align-items:center; gap:8px;
             font-size:12.5px; font-weight:600; color:var(--purple);
             background:rgba(107,95,255,0.08);
             border:1px dashed rgba(107,95,255,0.4); padding:10px 13px;
             border-radius:12px; cursor:pointer; transition:background 150ms; }
.pend-abrir:hover{ background:rgba(107,95,255,0.15); }
.pend-abrir-plus{ font-size:16px; font-weight:400; line-height:1; }

.pend-alta{ margin-top:11px; display:flex; flex-direction:column; gap:9px;
            background:rgba(255,255,255,0.65); border:1px solid rgba(255,255,255,0.9);
            border-radius:13px; padding:12px; box-shadow:0 4px 16px rgba(54,70,120,0.08); }
.pend-alta-row{ display:flex; gap:6px; flex-wrap:wrap; }
.pend-alta-bottom{ align-items:center; }
.pend-alta-acciones{ margin-left:auto; display:flex; gap:6px; align-items:center; }
.pend-input{ width:100%; font-size:13.5px; color:var(--ink); background:#fff;
             border:1px solid rgba(13,20,36,0.12); border-radius:9px; padding:9px 11px;
             transition:border-color 150ms; }
.pend-input:focus{ border-color:var(--purple); }
.pend-tipo{ font-size:11.5px; font-weight:600; color:var(--ink-2);
            background:rgba(13,20,36,0.05); padding:5px 11px; border-radius:8px;
            cursor:pointer; transition:background 150ms, color 150ms; }
.pend-tipo:hover{ background:rgba(13,20,36,0.1); }
.pend-tipo.on{ background:var(--purple); color:#fff; }
.pend-fecha{ font-family:var(--mono); font-size:11.5px; color:var(--ink-1);
             background:#fff; border:1px solid rgba(13,20,36,0.12);
             border-radius:8px; padding:5px 8px; cursor:pointer; }
.pend-cancelar{ font-size:12px; font-weight:600; color:var(--ink-3);
                background:transparent; padding:7px 9px; cursor:pointer; }
.pend-guardar{ font-size:12.5px; font-weight:700; color:#fff; background:var(--purple);
               padding:7px 15px; border-radius:9px; cursor:pointer;
               transition:filter 150ms; }
.pend-guardar:hover:not(:disabled){ filter:brightness(1.08); }
.pend-guardar:disabled{ opacity:0.5; cursor:default; }
.pend-err{ font-size:11px; color:#a72c3a; margin-top:7px; }

html[data-theme="dark"] .pend-count{ background:rgba(255,255,255,0.08); }
html[data-theme="dark"] .pend-alerta{ background:rgba(201,53,69,0.2); color:#ff9aa4; }
html[data-theme="dark"] .pend-derivado{ background:rgba(247,152,74,0.13);
                                        border-color:rgba(247,152,74,0.3); }
html[data-theme="dark"] .pend-derivado-ic{ background:rgba(247,152,74,0.2); color:#ffc79a; }
html[data-theme="dark"] .pend-accion{ background:rgba(247,152,74,0.18); color:#ffc79a; }
html[data-theme="dark"] .pend-accion:hover{ background:rgba(247,152,74,0.3); }
html[data-theme="dark"] .pend-alta{ background:rgba(255,255,255,0.05);
                                    border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .pend-input,
html[data-theme="dark"] .pend-fecha{ background:rgba(255,255,255,0.06);
                                     border-color:rgba(255,255,255,0.14);
                                     color:var(--ink); }
html[data-theme="dark"] .pend-tipo{ background:rgba(255,255,255,0.06); }
html[data-theme="dark"] .pend-tipo:hover{ background:rgba(255,255,255,0.11); }
html[data-theme="dark"] .pend-tipo.on{ background:var(--purple); color:#fff; }
html[data-theme="dark"] .pend-err{ color:#ff9aa4; }

/* El filtro de tipo va al lado del aviso de vencidos, no debajo: si no, el
   cabezal crece y se come una fila de la lista. */
.pend-head-der{ display:flex; align-items:center; gap:8px; }
.todo-filter .tf-btn{ white-space:nowrap; }
.pdv-head{ margin-bottom:10px; }

/* Reprogramar. Aparece con el hover como el borrar, pero al reves que el
   borrar NO se esconde cuando la tarea esta vencida: ahi es justo lo que uno
   quiere hacer. */
.pend-mover{ flex:0 0 auto; width:26px; opacity:0; cursor:pointer;
             background:transparent; color:var(--ink-3);
             transition:opacity 150ms, width 150ms; }
.todo-item:hover .pend-mover, .pend-mover:focus-visible{ opacity:1; width:34px; }
.todo-group.over + .todo-item .pend-mover{ opacity:0.75; width:34px; }
.pend-mover::-webkit-calendar-picker-indicator{ cursor:pointer; opacity:0.75; }
html[data-theme="dark"] .pend-mover{ color-scheme:dark; }

` + RESET_CARD_POS;
