// CSS del panel de la contadora — COPIA COMPLETA Y VERBATIM del <style> de
// pos-preview/contador-v2.html. NO se filtra nada.
//
// Se copia ENTERO por la misma razon que Clientes y Productos: filtrar las
// reglas cuyo selector ya existe en shellCss deja la pantalla pintada con los
// valores del POS, que son OTROS aunque el selector se llame igual.
//
// Verificar con: node scripts/comparar-con-maqueta.mjs /contador <maqueta>
//
// OJO: esto es UN TEMPLATE LITERAL. Nada de backticks aca adentro.
import { RESET_CARD_POS } from '../_css/reset-card-pos';
import { OSCURO_GESTION, OSCURO_NUCLEO } from '../_css/tema-oscuro';

export const CONTADOR_CSS = `
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

/* PANEL CONTADOR */
.rep-head{ display:flex; align-items:flex-end; justify-content:space-between; margin-bottom:16px; }
.rep-title{ font-size:30px; font-weight:700; letter-spacing:-0.03em; color:var(--ink); margin:0; }
.rep-sub{ font-size:13px; color:var(--ink-3); margin-top:4px; }
.rep-export{ display:flex; gap:9px; }
.rx{ display:inline-flex; align-items:center; gap:7px; padding:10px 15px; border-radius:12px; font-size:12.5px; font-weight:600; color:var(--ink-1); background:rgba(255,255,255,0.72); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); cursor:pointer; transition:all 160ms; }
.rx:hover{ transform:translateY(-1px); } .rx svg{ width:15px; height:15px; }
.rx.full{ width:100%; justify-content:center; margin-top:16px; background:linear-gradient(140deg,var(--purple),var(--purple-2)); color:#fff; border:none; box-shadow:0 5px 14px rgba(107,95,255,0.34); }
.rep-body{ display:flex; flex-direction:column; gap:16px; } .g2{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; }
.emp-bar{ display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
.emp-lbl{ font-size:12px; color:var(--ink-3); font-weight:600; }
.emp-chip{ padding:9px 15px; border-radius:12px; font-size:12.5px; font-weight:600; color:var(--ink-2); background:rgba(255,255,255,0.62); border:1px solid rgba(255,255,255,0.85); cursor:pointer; transition:all 150ms; }
.emp-chip:hover{ color:var(--ink); } .emp-chip.on{ background:var(--purple); color:#fff; border-color:transparent; box-shadow:0 4px 14px rgba(107,95,255,0.34); } .emp-chip.more{ color:var(--ink-3); font-weight:500; }
.sec-h2{ display:flex; align-items:center; gap:9px; font-size:14px; font-weight:700; color:var(--ink); margin:4px 0 -4px; }
.venc-grid{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; }
.vcard{ padding:16px 18px; } .vc-top{ display:flex; align-items:flex-start; justify-content:space-between; }
.vc-imp{ font-size:13.5px; font-weight:700; color:var(--ink); } .vc-sub{ font-size:11px; color:var(--ink-3); margin-top:2px; }
.vc-chip{ font-size:9.5px; font-weight:700; padding:4px 8px; border-radius:7px; } .vc-chip.warn{ background:rgba(247,152,74,0.16); color:#b96c1a; } .vc-chip.ok{ background:rgba(52,199,125,0.14); color:#1a8e5a; }
.vc-monto{ font-family:var(--mono); font-size:20px; font-weight:700; color:var(--ink); margin:12px 0 6px; }
.vc-fecha{ display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--ink-2); }
.kv{ display:flex; align-items:center; justify-content:space-between; padding:8px 0; } .kv .k{ font-size:12.5px; color:var(--ink-2); } .kv .v{ font-family:var(--mono); font-weight:600; font-size:13px; color:var(--ink); }
.divider{ height:1px; background:rgba(13,20,36,0.07); margin:6px 0; }
.iva-pos{ display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:12px; background:rgba(247,152,74,0.10); border:1px solid rgba(247,152,74,0.24); margin-top:6px; }
.iva-pos > span:first-child{ font-size:13px; font-weight:700; color:#b96c1a; } .iva-amt{ font-family:var(--mono); font-size:19px; font-weight:700; color:#b96c1a; }
.iva-pos.ok{ background:rgba(52,199,125,0.10); border-color:rgba(52,199,125,0.24); } .iva-pos.ok > span:first-child{ color:#1a8e5a; } .c-green2{ color:#1a8e5a !important; }
/* asientos */
.axtable{ display:flex; flex-direction:column; }
.ax-line{ display:grid; grid-template-columns:230px 1fr 110px 110px 96px; align-items:center; padding:7px 0; gap:8px; }
.ax-line.ax-head{ font-size:9.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.06em; font-family:var(--mono); padding-bottom:10px; border-bottom:1px solid rgba(13,20,36,0.08); }
.ax-line.ax-first{ border-top:1px solid rgba(13,20,36,0.07); padding-top:11px; }
.ax-meta{ display:flex; flex-direction:column; } .ax-fecha{ font-family:var(--mono); font-size:11px; color:var(--ink-3); } .ax-desc{ font-size:12.5px; font-weight:600; color:var(--ink-1); margin-top:1px; }
.ax-cta{ font-size:12.5px; color:var(--ink-2); } .ax-imp{ font-family:var(--mono); font-size:12.5px; font-weight:500; color:var(--ink-1); text-align:right; }
.ax-head .ax-imp{ text-align:right; } .ax-head .ax-org{ text-align:left; }
.ax-org{ text-align:left; } .ax-chip{ font-size:10px; font-weight:700; padding:3px 9px; border-radius:7px; background:rgba(107,95,255,0.10); color:var(--purple); }
/* libros */
.libros-grid{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; }
.libro{ display:flex; align-items:center; gap:12px; padding:15px 16px; border-radius:16px; background:rgba(255,255,255,0.6); border:1px solid rgba(255,255,255,0.85); box-shadow:var(--glass-hi); cursor:pointer; transition:all 170ms; }
.libro:hover{ transform:translateY(-2px); box-shadow:var(--glass-hi), 0 8px 18px rgba(54,70,120,0.12); }
.lb-ic{ width:38px; height:38px; border-radius:11px; background:rgba(107,95,255,0.10); color:var(--purple); display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
.lb-tx{ flex:1; min-width:0; } .lb-name{ font-size:13px; font-weight:600; color:var(--ink); } .lb-sub{ font-size:11px; color:var(--ink-3); margin-top:1px; } .lb-go{ color:var(--ink-3); flex:0 0 auto; }
/* exportar */
.exp-grid{ display:flex; flex-wrap:wrap; gap:9px; }
.exp-btn{ display:inline-flex; align-items:center; gap:8px; padding:10px 15px; border-radius:12px; font-size:12.5px; font-weight:600; color:var(--ink-1); background:rgba(255,255,255,0.7); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); cursor:pointer; transition:all 150ms; }
.exp-btn:hover{ transform:translateY(-1px); color:var(--ink); border-color:rgba(107,95,255,0.4); }
.exp-dot{ width:8px; height:8px; border-radius:50%; background:linear-gradient(135deg,var(--purple),var(--blue)); }

/* contador v2 - gaps */
.c-red2{ color:#c93545 !important; }
.conc-btn{ font-size:12px; font-weight:600; color:var(--purple); background:rgba(107,95,255,0.10); border:none; padding:7px 13px; border-radius:10px; cursor:pointer; }
.conc-btn:hover{ background:rgba(107,95,255,0.18); }
.conc-stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:4px 0 12px; }
.suel-stats{ display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin:4px 0 14px; }
.cs-k{ font-size:10.5px; color:var(--ink-3); } .cs-v{ font-family:var(--mono); font-size:15px; font-weight:600; color:var(--ink); margin-top:3px; }
.conc-diff{ font-size:11.5px; padding:8px 12px; border-radius:10px; margin-bottom:10px; }
.conc-diff.warn{ background:rgba(247,152,74,0.12); color:#b96c1a; }
.conc-list{ display:flex; flex-direction:column; }
.conc-row{ display:flex; align-items:center; gap:11px; padding:8px 0; border-top:1px solid rgba(13,20,36,0.05); }
.conc-row:first-child{ border-top:none; }
.conc-x{ width:8px; height:8px; border-radius:50%; flex:0 0 auto; } .conc-x.ok{ background:var(--green); } .conc-x.pend{ background:var(--orange); }
.conc-tx{ flex:1; min-width:0; } .conc-n{ font-size:12.5px; font-weight:500; color:var(--ink-1); } .conc-sub{ font-size:11px; color:var(--ink-3); margin-top:1px; }
.conc-m{ font-family:var(--mono); font-size:13px; font-weight:600; color:var(--ink); }
.ctbl{ width:100%; border-collapse:collapse; }
.ctbl th{ text-align:left; font-size:9.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.06em; font-family:var(--mono); font-weight:500; padding:0 0 11px; border-bottom:1px solid rgba(13,20,36,0.07); }
.ctbl th.r, .ctbl td.r{ text-align:right; } .ctbl td{ padding:11px 0; border-top:1px solid rgba(13,20,36,0.05); vertical-align:middle; font-size:13px; }
.ctbl .mono{ font-family:var(--mono); font-size:12.5px; }
.cj-cell{ display:inline-flex; align-items:center; gap:9px; } .cj-av{ width:26px; height:26px; border-radius:50%; background:linear-gradient(135deg,var(--purple),var(--blue)); color:#fff; font-size:9.5px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; }
.cc-cargo{ color:var(--ink-3); font-size:12px; }
.recat-bar{ height:9px; border-radius:999px; background:rgba(13,20,36,0.06); overflow:hidden; margin:10px 0 10px; } .recat-bar i{ display:block; height:100%; border-radius:999px; background:linear-gradient(90deg,var(--orange),#ec5d6a); }
.recat-note{ font-size:11.5px; line-height:1.4; padding:9px 12px; border-radius:10px; } .recat-note.warn{ background:rgba(247,152,74,0.12); color:#b96c1a; }
.cc-2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:10px; }
.cc-box{ padding:13px 15px; border-radius:13px; background:rgba(255,255,255,0.55); border:1px solid rgba(255,255,255,0.8); }
.cc-bk{ font-size:11px; color:var(--ink-3); } .cc-bv{ font-family:var(--mono); font-size:18px; font-weight:700; margin-top:4px; }
.cc-list{ display:flex; flex-direction:column; }
.cc-row{ display:flex; align-items:center; gap:11px; padding:9px 0; border-top:1px solid rgba(13,20,36,0.05); } .cc-row:first-child{ border-top:none; }
.cc-av{ width:28px; height:28px; border-radius:50%; background:linear-gradient(135deg,var(--purple),var(--blue)); color:#fff; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
.cc-m{ font-family:var(--mono); font-size:13px; font-weight:700; color:var(--ink); }

/* modelo legal (borrador -> contador aprueba/presenta) */
.per-status{ font-size:11px; font-weight:700; color:#b96c1a; background:rgba(247,152,74,0.16); padding:3px 9px; border-radius:7px; margin-left:8px; white-space:nowrap; }
.rx.aprobar{ background:linear-gradient(140deg,#34c77d,#22a866); color:#fff; border:none; box-shadow:0 5px 14px rgba(52,199,125,0.32); }
.legal-note{ display:flex; align-items:flex-start; gap:11px; padding:14px 17px; border-radius:14px; background:rgba(255,255,255,0.5); border:1px solid rgba(255,255,255,0.8); font-size:11.5px; color:var(--ink-3); line-height:1.5; }
.legal-note svg{ color:var(--purple); flex:0 0 auto; margin-top:1px; }
.legal-note b{ color:var(--ink-1); font-weight:600; }

/* ============ TOOLBAR (Apple-restraint) ============ */
.bar{ display:flex; align-items:center; gap:16px; padding:17px 20px; border-radius:20px; margin-bottom:16px;
 background:rgba(255,255,255,0.52); -webkit-backdrop-filter:blur(40px) saturate(180%); backdrop-filter:blur(40px) saturate(180%);
 border:1px solid rgba(255,255,255,0.6); box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 1px rgba(54,70,120,0.04), 0 10px 30px -14px rgba(54,70,120,0.3); }
.bar-id{ display:flex; align-items:center; gap:14px; }
.bar-icon{ width:42px; height:42px; border-radius:13px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; color:var(--purple);
 background:linear-gradient(150deg, rgba(107,95,255,0.16), rgba(91,140,255,0.10)); border:1px solid rgba(255,255,255,0.7); box-shadow: inset 0 1px 0 rgba(255,255,255,0.8); }
.bar-title{ font-size:22px; font-weight:700; letter-spacing:-0.035em; color:var(--ink); line-height:1.05; }
.bar-sub{ font-size:12.5px; color:var(--ink-3); margin-top:3px; display:flex; align-items:center; gap:8px; }
.bar-actions{ margin-left:auto; display:flex; gap:10px; align-items:center; }
.bar .b{ display:inline-flex; align-items:center; gap:7px; padding:10px 16px; border-radius:12px; font-size:13px; font-weight:600; cursor:pointer; transition:all 180ms cubic-bezier(.2,.7,.2,1); }
.bar .b svg{ width:15px; height:15px; }
.bar .b.ghost{ color:var(--ink-1); background:rgba(255,255,255,0.55); border:1px solid rgba(255,255,255,0.8); box-shadow:inset 0 1px 0 rgba(255,255,255,0.8); }
.bar .b.ghost:hover{ background:rgba(255,255,255,0.78); }
.bar .b.primary{ color:#fff; border:none; background:linear-gradient(135deg, #7a6fff, #6b5fff); box-shadow:0 4px 14px -2px rgba(107,95,255,0.5), inset 0 1px 0 rgba(255,255,255,0.35); }
.bar .b.approve{ color:#fff; border:none; background:linear-gradient(135deg, #3ace86, #22b06a); box-shadow:0 4px 14px -2px rgba(52,199,125,0.5), inset 0 1px 0 rgba(255,255,255,0.35); }
.bar .b.approve:hover, .bar .b.primary:hover{ transform:translateY(-1px); }
.bar .per-status{ font-size:11px; font-weight:700; color:#b96c1a; background:rgba(247,152,74,0.16); padding:3px 9px; border-radius:7px; }

/* barra de scroll del contenido principal — consistente y siempre visible */
.main{ overflow-y:scroll; }
.main::-webkit-scrollbar{ width:7px; }
.main::-webkit-scrollbar-track{ background:transparent; }
.main::-webkit-scrollbar-thumb{ background:rgba(13,20,36,0.14); border-radius:5px; border:2px solid transparent; background-clip:padding-box; }

/* ── Agregado propio: mismas dos correcciones que el resto de las pantallas ──
   line-height (Tailwind Preflight pone 1.5 en <html>; la maqueta usa normal) y
   el gap:9px que shellCss agrega a .main y se SUMA a los margenes de la
   maqueta. Acotado a .main para no tocar la barra lateral. */
.main{ line-height:normal; gap:0; }

/* Los chips de empresa y las filas son <button> de verdad; reset acotado, con
   font-FAMILY y no font, para no pisar los font-size de cada clase. */
button.emp-chip{ font-family:inherit; border:none; outline:none; cursor:pointer; }

/* ── INVENTARIO VALORIZADO (item 8) ──────────────────────────────────────
   Tabla compacta: son pocas filas y lo que importa es poder leer una columna
   de numeros de un saque contra la de al lado. */
.inv-tab{ margin:14px 0 12px; border:1px solid rgba(13,20,36,0.09); border-radius:12px; overflow:hidden; }
.inv-th{ display:flex; gap:10px; align-items:center; padding:8px 12px;
  font-size:10.5px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase;
  color:var(--ink-3); background:rgba(13,20,36,0.04); }
.inv-tr{ display:flex; gap:10px; align-items:center; padding:9px 12px;
  font-size:12.5px; color:var(--ink-1); border-top:1px solid rgba(13,20,36,0.06); }
.inv-fecha{ display:block; font-style:normal; font-size:10.5px; color:var(--ink-3); margin-top:2px; }
/* Por CLASE y no por style inline: un hex inline no puede tener variante de
   tema, y en este proyecto eso ya rompio el modo oscuro dos veces. */
.inv-falta{ color:var(--red); font-weight:600; font-size:11.5px; }
.label-sm.alerta{ color:var(--red); }

/* ── Lo que antes era style inline en ContadorClient ──────────────────────
   Mismos valores que tenia inline: en claro la pantalla no cambia. */
.emp-chip.invitar{ border:1.5px dashed rgba(107,95,255,0.45); color:var(--purple); background:rgba(107,95,255,0.06); font-weight:600; }
.periodo-ic{ width:42px; height:42px; border-radius:13px; flex:0 0 auto; display:flex; align-items:center; justify-content:center;
  background:linear-gradient(150deg,rgba(52,199,125,0.18),rgba(107,95,255,0.12)); color:#1a8e5a; }
.label-sm.err{ color:#c0384a; }
.label-sm.aviso{ color:#b96c1a; }
.cc-bv.debe{ color:#c0384a; }
` + RESET_CARD_POS + OSCURO_NUCLEO + OSCURO_GESTION + `
/* ════════════════ MODO OSCURO · lo propio de /contador ════════════════
   Va DESPUES de RESET_CARD_POS para ganarle al .card:hover claro.
   Los tonos son los mismos que usan Clientes y Gastos para cada rol
   (verde #55dd9b, ambar #ffb87a, rojo #ff8b96). */
html[data-theme="dark"] .card:hover{ border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .divider{ background:rgba(255,255,255,0.08); }

/* chips de empresa: .on era violeta lleno con texto blanco; con el violeta
   claro del tema oscuro el blanco no se lee. Se hace como .cchip.on de Clientes. */
html[data-theme="dark"] .emp-chip{ background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .emp-chip.on{ background:rgba(141,162,255,0.18); color:var(--purple); border-color:rgba(141,162,255,0.4); box-shadow:none; }
html[data-theme="dark"] .emp-chip.invitar{ border-color:rgba(141,162,255,0.45); background:rgba(141,162,255,0.06); }
html[data-theme="dark"] .periodo-ic{ color:#55dd9b; border:1px solid rgba(255,255,255,0.10); }

/* posicion de IVA + estados */
html[data-theme="dark"] .iva-pos{ background:rgba(247,152,74,0.10); border-color:rgba(247,152,74,0.28); }
html[data-theme="dark"] .iva-pos > span:first-child,
html[data-theme="dark"] .iva-amt{ color:#ffb87a; }
html[data-theme="dark"] .iva-pos.ok{ background:rgba(52,199,125,0.10); border-color:rgba(52,199,125,0.26); }
html[data-theme="dark"] .iva-pos.ok > span:first-child{ color:#55dd9b; }
html[data-theme="dark"] .c-green2{ color:#55dd9b !important; }
html[data-theme="dark"] .c-red2{ color:#ff8b96 !important; }
html[data-theme="dark"] .label-sm.aviso,
html[data-theme="dark"] .per-status,
html[data-theme="dark"] .bar .per-status{ color:#ffb87a; }
html[data-theme="dark"] .conc-diff.warn{ background:rgba(247,152,74,0.14); color:#ffb87a; }
html[data-theme="dark"] .label-sm.err,
html[data-theme="dark"] .cc-bv.debe,
html[data-theme="dark"] .inv-falta,
html[data-theme="dark"] .label-sm.alerta{ color:#ff8b96; }

/* superficies claras de la maqueta */
html[data-theme="dark"] .rx,
html[data-theme="dark"] .exp-btn{ background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.12); box-shadow:inset 0 1px 0 rgba(255,255,255,0.08); }
html[data-theme="dark"] .exp-btn:hover{ border-color:rgba(141,162,255,0.45); }
html[data-theme="dark"] .cc-box{ background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .legal-note{ background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .cc-row,
html[data-theme="dark"] .conc-row{ border-top-color:rgba(255,255,255,0.06); }

/* inventario valorizado */
html[data-theme="dark"] .inv-tab{ border-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .inv-th{ background:rgba(255,255,255,0.05); }
html[data-theme="dark"] .inv-tr{ border-top-color:rgba(255,255,255,0.07); }

/* comprobantes adjuntos del período — ítem 12, slice 4 */
.adj-bloque{ margin-top:14px; padding-top:14px; border-top:1px solid rgba(15,23,42,0.08); display:flex; flex-direction:column; gap:10px; align-items:flex-start; }
.adj-lista{ list-style:none; margin:0; padding:0; width:100%; display:flex; flex-direction:column; }
.adj-lista li{ display:flex; align-items:center; gap:12px; padding:9px 2px; border-top:1px solid rgba(15,23,42,0.06); font-size:12.5px; }
.adj-lista li:first-child{ border-top:none; }
/* --ink-2 y no --ink-3, elegido ANTES de medir: --ink-3 sobre vidrio ya dio
   3,87:1 en oscuro en otra pantalla de esta app. Eso no es una medición de
   ESTA lista — es el motivo por el que no se arranco con --ink-3. */
.adj-fecha{ color:var(--ink-2); flex:0 0 78px; font-weight:600; }
.adj-quien{ color:var(--ink); font-weight:600; flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.adj-nro{ color:var(--ink-2); font-weight:500; }
.adj-importe{ color:var(--ink); font-weight:700; flex:0 0 auto; }
.adj-bajar{ padding:6px 12px; font-size:12px; flex:0 0 auto; }
/* MEDIDO sobre píxeles (2026-11-09): con el --ink-3 de .label-sm, el pie de
   esta lista daba 3,31:1 en claro y 4,63 en oscuro. Es 12px —texto normal
   para WCAG— y dice cuántos comprobantes hay y por qué no salen los
   contratos: no es decoración. Se sube a --ink-2 SÓLO acá; el --ink-3 de toda
   la app es deuda declarada aparte y cambiarlo de contrabando movería
   pantallas que nadie volvió a medir. */
.adj-bloque .label-sm{ color:var(--ink-2); }

html[data-theme="dark"] .adj-bloque{ border-top-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .adj-lista li{ border-top-color:rgba(255,255,255,0.07); }
`;
