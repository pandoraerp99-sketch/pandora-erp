// CSS del shell extraido VERBATIM de pos-preview/checkpoint-v19-top-tools.html
// (maqueta = autoridad visual). NO editar a mano: re-extraer del mockup.
export const SHELL_CSS = `
/* ============================================================
   Pandora POS — fiel al código fuente (App.tsx + index.css)
   Fondo dawn cálido EXACTO · layout 180/1fr/280 · glass real.
   ============================================================ */
:root{
  --ink:#0d1424; --ink-1:#1f2a44; --ink-2:#4a5570; --ink-3:#7681a0; --ink-4:#a8b0c5;
  --purple:#6b5fff; --purple-2:#9088ff; --green:#34c77d; --red:#ef5d6a; --yellow:#f4c948;
  --tdf:#0e8f9e;
  /* receta glass EXACTA del dashboard (Pandora Dashboard.html) */
  --glass-bg:rgba(255,255,255,0.58);
  --glass-bg-2:rgba(255,255,255,0.72);
  --glass-bd:1px solid rgba(255,255,255,0.85);
  --glass-hi:inset 0 1px 0 rgba(255,255,255,0.9);
  --glass-sh:0 8px 32px rgba(54,70,120,0.10), 0 2px 8px rgba(54,70,120,0.06);
}
*,*::before,*::after{ box-sizing:border-box; margin:0; padding:0; }
button,input{ font:inherit; color:inherit; border:none; outline:none; background:none; cursor:pointer; }
html,body{ height:100%; }
body{
  font-family:'Inter',ui-sans-serif,system-ui,sans-serif; -webkit-font-smoothing:antialiased;
  letter-spacing:-0.011em; color:var(--ink); height:100dvh; overflow:hidden; position:relative;
}
/* ── Fondo dawn EXACTO (App.tsx Background) ── */
.bg{ position:fixed; inset:0; z-index:-10; }
.bg .base{ position:absolute; inset:0; background:linear-gradient(175deg,#b5c6e8 0%,#c8d4ea 28%,#ddd0e0 62%,#eed6d0 100%); }
.bg .glow{ position:absolute; inset:0; background:
  radial-gradient(ellipse 70% 60% at 10% 95%, rgba(238,200,220,0.55) 0%, transparent 60%),
  radial-gradient(ellipse 60% 50% at 88% 82%, rgba(240,210,175,0.40) 0%, transparent 60%),
  radial-gradient(ellipse 55% 42% at 55% 22%, rgba(255,255,255,0.60) 0%, transparent 52%),
  radial-gradient(ellipse 58% 48% at 10% 22%, rgba(195,215,248,0.65) 0%, transparent 62%); }

::-webkit-scrollbar{ width:4px; height:4px; }
::-webkit-scrollbar-track{ background:transparent; }
::-webkit-scrollbar-thumb{ background:rgba(13,20,36,0.12); border-radius:4px; }
::-webkit-scrollbar-thumb:hover{ background:rgba(13,20,36,0.2); }

.glass{ background:var(--glass-bg); backdrop-filter:blur(28px) saturate(140%); -webkit-backdrop-filter:blur(28px) saturate(140%);
  border:var(--glass-bd); box-shadow:var(--glass-hi), var(--glass-sh); }
.glass-strong{ background:var(--glass-bg-2); backdrop-filter:blur(32px) saturate(150%); -webkit-backdrop-filter:blur(32px) saturate(150%);
  border:var(--glass-bd); box-shadow:var(--glass-hi), var(--glass-sh); }

/* ── Store pill (en topbar, al lado de Online) ── */
.store-pill{ display:flex; align-items:center; gap:6px; height:38px; padding:0 13px; flex:0 0 auto;
  border-radius:11px; font-size:11.5px; font-weight:500; color:var(--ink-2);
  background:rgba(255,255,255,0.68); border:1px solid rgba(255,255,255,0.88); box-shadow:var(--glass-hi); }
.store-pill svg{ width:13px; height:13px; color:var(--ink-4); }

/* ── Shell: 180 / 1fr / 280 (App.tsx) ── */
.shell{ height:100dvh; padding:10px; display:grid; grid-template-columns:210px 1fr 280px; gap:8px; }

/* ════ SIDEBAR ════ */
.sidebar{ display:flex; flex-direction:column; border-radius:20px; padding:22px 14px 18px; }
.logo-row{ display:flex; align-items:center; gap:10px; padding:0 8px 22px; }
.logo-mark{ width:26px; height:26px; flex-shrink:0; }
.logo-mark svg{ width:100%; height:100%; display:block; }
.logo-text{ font-size:19px; font-weight:700; letter-spacing:-0.025em;
  background:linear-gradient(135deg,#2a3454 0%,#4a5878 100%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.nav-item{ display:flex; align-items:center; gap:11px; padding:10px 11px; border-radius:12px; color:var(--ink-2);
  font-size:13.5px; font-weight:500; cursor:pointer; transition:all 200ms cubic-bezier(.4,0,.2,1); position:relative; }
.nav-item:hover{ color:var(--ink); background:rgba(255,255,255,0.4); }
.nav-item.active{ background:rgba(255,255,255,0.92); color:var(--ink); box-shadow:0 1px 2px rgba(54,70,120,0.06), 0 4px 12px rgba(54,70,120,0.08); }
.nav-item.active .nav-icon-box{ background:var(--purple); color:#fff; box-shadow:0 4px 10px rgba(107,95,255,0.4); }
.nav-icon-box{ width:26px; height:26px; display:flex; align-items:center; justify-content:center; border-radius:7px; background:transparent; color:var(--ink-2); transition:all 200ms; flex-shrink:0; }
.upgrade{ margin-top:auto; padding:16px 14px; border-radius:16px; background:linear-gradient(180deg,rgba(255,255,255,0.85),rgba(255,255,255,0.55)); border:1px solid rgba(255,255,255,0.9); box-shadow:0 4px 12px rgba(54,70,120,0.08); }
.upgrade-title{ font-size:14px; font-weight:600; color:var(--ink); margin-bottom:6px; letter-spacing:-0.01em; }
.upgrade-sub{ font-size:11.5px; color:var(--ink-3); line-height:1.45; margin-bottom:12px; }
.btn-primary{ width:100%; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:9px 12px;
  background:linear-gradient(135deg,var(--purple) 0%,var(--purple-2) 100%); color:#fff; font-weight:500; font-size:13px; border:none; border-radius:10px; cursor:pointer;
  box-shadow:0 4px 10px rgba(107,95,255,0.35), 0 1px 2px rgba(107,95,255,0.2); transition:transform 180ms, box-shadow 180ms; }
.btn-primary:hover{ transform:translateY(-1px); box-shadow:0 6px 14px rgba(107,95,255,0.45); }
@keyframes pg{ 0%,100%{box-shadow:0 0 0 2px rgba(52,199,125,0.22)} 50%{box-shadow:0 0 0 5px rgba(52,199,125,0)} }
/* ── Pie de sidebar POS: chip AFIP + cajero (en lugar de "Mejorá a Pro") ── */
.side-foot{ margin-top:auto; padding-top:12px; display:flex; flex-direction:column; gap:9px; }
.afip{ padding:10px 11px; border-radius:13px; background:rgba(52,199,125,0.08); border:1px solid rgba(52,199,125,0.20); }
.afip-top{ display:flex; align-items:center; gap:7px; }
.afip-dot{ width:7px; height:7px; border-radius:50%; background:var(--green); flex:0 0 auto; animation:pg 2.4s ease-in-out infinite; }
.afip-name{ font-size:11.5px; font-weight:700; color:#177a4a; }
.afip-live{ margin-left:auto; font-size:8.5px; font-weight:800; letter-spacing:0.06em; color:var(--green); }
.afip-sub{ font-size:10px; color:#5a9b78; padding-left:14px; margin-top:2px; }
.cashier{ display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:13px; background:rgba(255,255,255,0.66); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); }
.cashier-av{ width:32px; height:32px; flex:0 0 auto; border-radius:50%; background:linear-gradient(135deg,var(--purple),#5b8cff); display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px; font-weight:700; }
.avatar-ring{ padding:2px; border-radius:50%; flex:0 0 auto; display:flex; background:conic-gradient(from 0deg,#6b5fff,#5b8cff,#34c77d,#f7984a,#ee6a8e,#6b5fff); animation:spinRing 6s linear infinite; }
.avatar-ring > .cashier-av{ animation:spinRing 6s linear infinite reverse; border:2px solid rgba(255,255,255,0.9); }
@keyframes spinRing{ to{ transform:rotate(360deg); } }
.cashier-name{ font-size:12px; font-weight:600; line-height:1.2; }
.cashier-role{ font-size:10px; color:var(--ink-3); }
.cashier-live{ width:7px; height:7px; border-radius:50%; background:var(--green); margin-left:auto; flex:0 0 auto; animation:pg 2.4s ease-in-out infinite; }

/* ════ CATÁLOGO ════ */
.main{ display:flex; flex-direction:column; gap:9px; min-height:0; min-width:0; }
.topbar{ display:flex; align-items:center; gap:8px; flex:0 0 auto; }
.search{ flex:1; position:relative; display:flex; align-items:center; height:42px; border-radius:14px; padding:0 100px 0 40px; transition:border-color 200ms, box-shadow 200ms; }
.search:focus-within{ border-color:rgba(107,95,255,0.45); box-shadow:var(--glass-hi), 0 0 0 4px rgba(107,95,255,0.10); }
.search svg.lead{ position:absolute; left:13px; width:16px; height:16px; color:var(--ink-4); }
.search input{ width:100%; height:100%; font-size:13px; }
.search input::placeholder{ color:var(--ink-4); }
.search-right{ position:absolute; right:10px; display:flex; align-items:center; gap:6px; }
.barcode{ display:flex; align-items:center; gap:5px; padding:4px 8px; border-radius:7px; font-size:9px; font-weight:800; letter-spacing:0.04em; color:var(--purple); background:rgba(107,95,255,0.10); border:1px solid rgba(107,95,255,0.22); }
.barcode svg{ width:11px; height:11px; }
.kbd{ font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:500; padding:3px 7px; border-radius:5px; color:var(--ink-3); background:rgba(13,20,36,0.06); border:1px solid rgba(13,20,36,0.06); }
.online{ display:flex; align-items:center; gap:6px; height:38px; padding:0 13px; border-radius:11px; font-size:11.5px; font-weight:600;
  background:rgba(255,255,255,0.68); border:1px solid rgba(255,255,255,0.88); box-shadow:var(--glass-hi); flex:0 0 auto; }
.online .gd{ width:6px; height:6px; border-radius:50%; background:var(--green); }

.cats{ display:flex; align-items:center; gap:6px; flex:0 0 auto; }
.cat{ display:flex; align-items:center; gap:6px; padding:7px 13px; border-radius:20px; font-size:11.5px; font-weight:500; white-space:nowrap;
  color:var(--ink-2); background:rgba(255,255,255,0.55); border:1px solid rgba(255,255,255,0.82); box-shadow:var(--glass-hi); transition:all 150ms; flex:0 0 auto; }
.cat svg{ width:13px; height:13px; opacity:0.8; }
.cat:hover{ color:var(--ink); background:rgba(255,255,255,0.8); }
.cat.active{ color:#fff; background:var(--purple); border-color:var(--purple); box-shadow:0 3px 10px rgba(107,95,255,0.35); }
.cat.active svg{ opacity:1; }

.catalog{ flex:1; min-height:0; border-radius:20px; overflow:hidden; display:flex; flex-direction:column; }
.grid{ flex:1; overflow-y:auto; padding:14px; display:grid; grid-template-columns:repeat(auto-fill,minmax(186px,1fr)); gap:12px; align-content:start; }
.card{ position:relative; display:flex; flex-direction:column; background:rgba(255,255,255,0.82); border:1px solid rgba(255,255,255,0.92);
  border-radius:14px; overflow:hidden; cursor:pointer; box-shadow:var(--glass-hi), 0 2px 8px rgba(54,70,120,0.07);
  transition:transform 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms, border-color 180ms; }
.card:hover{ transform:translateY(-2px); box-shadow:var(--glass-hi), 0 10px 22px rgba(54,70,120,0.14); border-color:rgba(107,95,255,0.24); }
.card:active{ transform:scale(0.98); }
.card-img{ height:120px; position:relative; background:linear-gradient(180deg,#fbfcfe,#f2f4f8); display:flex; align-items:center; justify-content:center; padding:12px; }
.card-img img{ max-width:100%; max-height:100%; object-fit:contain; mix-blend-mode:multiply; }
.fav{ position:absolute; top:8px; right:9px; color:var(--yellow); font-size:13px; }
.tag-low{ position:absolute; top:8px; left:8px; padding:3px 8px; border-radius:7px; font-size:8px; font-weight:800; letter-spacing:0.03em;
  color:#b53246; background:rgba(255,255,255,0.92); border:1px solid rgba(224,85,106,0.3); box-shadow:0 2px 6px rgba(54,70,120,0.1); }
.tag-tdf{ position:absolute; top:8px; left:8px; display:flex; align-items:center; gap:4px; padding:3px 7px; border-radius:7px; font-size:8px; font-weight:800; letter-spacing:0.02em;
  color:var(--tdf); background:rgba(255,255,255,0.9); border:1px solid rgba(14,143,158,0.22); box-shadow:0 2px 6px rgba(54,70,120,0.1); }
.tag-tdf .d{ width:5px; height:5px; border-radius:50%; background:var(--tdf); }
.card-body{ padding:10px 11px 11px; display:flex; flex-direction:column; gap:2px; flex:1; }
.card-name{ font-size:12.5px; font-weight:600; line-height:1.25; }
.card-sku{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--ink-4); }
.card-foot{ display:flex; align-items:baseline; justify-content:space-between; margin-top:auto; padding-top:6px; gap:6px; }
.card-price{ font-family:'JetBrains Mono',monospace; font-size:14.5px; font-weight:600; font-variant-numeric:tabular-nums; letter-spacing:-0.01em; }
.card-stock{ font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--ink-4); font-variant-numeric:tabular-nums; }
.card-stock.low{ color:#c0384a; }

.cat-foot{ flex:0 0 auto; padding:9px 14px; display:flex; align-items:center; gap:14px; border-top:1px solid rgba(13,20,36,0.05); }
.cat-count{ font-size:10.5px; color:var(--ink-4); }
.pager{ display:flex; align-items:center; gap:5px; margin-left:auto; }
.pg{ min-width:26px; height:26px; padding:0 6px; border-radius:7px; font-size:11.5px; font-weight:600; display:flex; align-items:center; justify-content:center; color:var(--ink-2);
  background:rgba(255,255,255,0.66); border:1px solid rgba(255,255,255,0.85); transition:all 150ms; }
.pg.active{ color:#fff; background:var(--purple); border-color:var(--purple); }
.pg svg{ width:12px; height:12px; }

/* ════ CARRITO ════ */
.cart{ display:flex; flex-direction:column; border-radius:20px; overflow:hidden; position:relative; }
/* ── Sheet de método de pago dentro del carrito ── */
.paysheet-backdrop{ position:absolute; inset:0; z-index:5; background:rgba(13,20,36,0.20); opacity:0; pointer-events:none; transition:opacity 220ms; }
.cart.sheet-open .paysheet-backdrop{ opacity:1; pointer-events:auto; }
.paysheet{ position:absolute; left:0; right:0; bottom:0; z-index:6; padding:14px 13px 15px; border-radius:22px 22px 18px 18px;
  background:rgba(255,255,255,0.9); backdrop-filter:blur(34px) saturate(150%); -webkit-backdrop-filter:blur(34px) saturate(150%);
  border-top:1px solid rgba(255,255,255,0.95); box-shadow:0 -12px 44px rgba(54,70,120,0.20);
  transform:translateY(105%); transition:transform 300ms cubic-bezier(.2,.8,.2,1); }
.cart.sheet-open .paysheet{ transform:translateY(0); }
.paysheet-grip{ width:34px; height:4px; border-radius:99px; background:rgba(13,20,36,0.12); margin:0 auto 10px; }
.paysheet-head{ display:flex; align-items:center; margin-bottom:11px; padding:0 2px; }
.paysheet-head .t{ font-size:13px; font-weight:700; flex:1; }
.paysheet-close{ width:26px; height:26px; border-radius:8px; display:flex; align-items:center; justify-content:center; color:var(--ink-3); background:rgba(13,20,36,0.05); transition:all 140ms; }
.paysheet-close:hover{ color:var(--ink); background:rgba(13,20,36,0.09); }
.paysheet-close svg{ width:15px; height:15px; }
.paysheet-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.psm{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:15px 8px; border-radius:14px; cursor:pointer;
  background:rgba(255,255,255,0.8); border:2px solid rgba(255,255,255,0.92); box-shadow:var(--glass-hi); transition:all 160ms cubic-bezier(.2,.8,.2,1); }
.psm:hover{ transform:translateY(-1px); background:#fff; }
.psm.on{ border-color:var(--purple); background:rgba(107,95,255,0.08); }
.psm .i{ width:38px; height:38px; border-radius:11px; display:flex; align-items:center; justify-content:center; color:var(--purple); background:rgba(107,95,255,0.10); transition:all 160ms; }
.psm.on .i{ background:var(--purple); color:#fff; }
.psm .i svg{ width:19px; height:19px; }
.psm .n{ font-size:11.5px; font-weight:600; text-align:center; line-height:1.2; }
.paysheet{ max-height:calc(100% - 6px); overflow-y:auto; }
.paysheet[data-m]{ }

/* ── Cobro: efectivo (monto + vuelto + numpad) y alternativas ── */
.tender{ display:block; margin-top:13px; }
.alt{ display:none; }
.paysheet:not([data-m="efectivo"]) .vuelto{ display:none; }
.tender-amt-flash{ animation:amtFlash 360ms cubic-bezier(.2,.8,.2,1); }
@keyframes amtFlash{ 0%{ background:rgba(107,95,255,0.22); } 100%{ background:rgba(107,95,255,0.06); } }
.tender-total{ display:flex; justify-content:space-between; align-items:center; padding:4px 4px 10px; border-bottom:1px solid rgba(13,20,36,0.06); }
.tender-total .l{ font-size:12px; color:var(--ink-3); }
.tender-total .v{ font-family:'JetBrains Mono',monospace; font-weight:600; font-size:14px; font-variant-numeric:tabular-nums; }
.tender-pay{ margin:11px 0 9px; padding:11px 14px; border-radius:13px; display:flex; align-items:center; justify-content:space-between;
  background:rgba(107,95,255,0.06); border:1px solid rgba(107,95,255,0.18); }
.tender-pay .l{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--purple); }
.tender-pay .v{ font-family:'JetBrains Mono',monospace; font-size:23px; font-weight:700; font-variant-numeric:tabular-nums; }
.quick{ display:flex; gap:6px; overflow-x:auto; padding-bottom:5px; margin-bottom:8px; }
.quick button{ flex:0 0 auto; padding:7px 12px; border-radius:9px; font-size:11.5px; font-weight:600; color:var(--ink-2);
  background:rgba(255,255,255,0.72); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); transition:all 140ms; white-space:nowrap; }
.quick button:hover{ color:var(--ink); background:#fff; }
.quick button.j{ color:var(--purple); border-color:rgba(107,95,255,0.32); background:rgba(107,95,255,0.08); }
.vuelto{ display:flex; justify-content:space-between; align-items:baseline; padding:5px 4px 12px; }
.vuelto .l{ font-size:13px; font-weight:600; color:var(--ink-2); }
.vuelto .v{ font-family:'JetBrains Mono',monospace; font-size:25px; font-weight:800; font-variant-numeric:tabular-nums; letter-spacing:-0.02em; }
.vuelto .v.ok{ color:#1a8e5a; }
.vuelto .v.no{ color:var(--ink-4); }
.numpad{ display:grid; grid-template-columns:repeat(3,1fr); gap:7px; margin-bottom:11px; }
.numpad button{ height:44px; border-radius:12px; font-family:'JetBrains Mono',monospace; font-size:18px; font-weight:600; color:var(--ink);
  background:rgba(255,255,255,0.78); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); transition:all 110ms; }
.numpad button:hover{ background:#fff; }
.numpad button:active{ transform:scale(0.95); background:rgba(107,95,255,0.10); }
.numpad button.bk{ color:var(--ink-3); }
.tender-cobrar{ width:100%; }
.tender-cobrar:disabled{ filter:grayscale(0.4); opacity:0.5; cursor:not-allowed; box-shadow:none; transform:none; }
.alt{ text-align:center; padding:6px 0 2px; }
.qr-box{ width:158px; height:158px; margin:6px auto 13px; padding:9px; border-radius:16px; background:#fff;
  border:1px solid rgba(13,20,36,0.07); box-shadow:var(--glass-hi), 0 4px 16px rgba(54,70,120,0.10); }
.qr-box img{ width:100%; height:100%; display:block; image-rendering:pixelated; }
.alt .txt{ font-size:12.5px; color:var(--ink-2); line-height:1.45; max-width:228px; margin:0 auto 14px; }
.card-art{ width:172px; height:108px; margin:6px auto 13px; border-radius:13px; position:relative; overflow:hidden;
  background:linear-gradient(135deg,var(--purple),#5b8cff); box-shadow:0 10px 24px rgba(107,95,255,0.32); }
.card-art .chip{ position:absolute; top:36px; left:18px; width:30px; height:23px; border-radius:5px; background:linear-gradient(135deg,#f4d77a,#caa23c); }
.card-art .dots{ position:absolute; bottom:20px; left:18px; right:18px; height:8px; display:flex; gap:9px; }
.card-art .dots span{ width:24px; height:7px; border-radius:3px; background:rgba(255,255,255,0.45); }
.alt .btn-solid{ width:100%; justify-content:center; }

/* ── Pago mixto: pagos agregados + restante ── */
.mix{ margin-top:13px; }
.mix-lines{ display:flex; flex-direction:column; gap:6px; margin-bottom:9px; }
.mix-lines:empty{ display:none; }
.mixrow{ display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:11px; background:rgba(52,199,125,0.08); border:1px solid rgba(52,199,125,0.2); }
.mixrow .mi{ width:24px; height:24px; flex:0 0 auto; border-radius:7px; background:rgba(31,157,99,0.14); color:#1a8e5a; display:flex; align-items:center; justify-content:center; }
.mixrow .mi svg{ width:14px; height:14px; }
.mixrow .mn{ font-size:11.5px; font-weight:600; flex:1; }
.mixrow .mv{ font-family:'JetBrains Mono',monospace; font-size:12px; font-weight:600; font-variant-numeric:tabular-nums; color:#1a7a4a; }
.mixrow .mx{ color:var(--ink-4); width:18px; height:18px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:color 140ms; }
.mixrow .mx:hover{ color:var(--red); }
.mixrow .mx svg{ width:12px; height:12px; }
.mix-rem{ display:flex; justify-content:space-between; align-items:center; padding:5px 4px 0; }
.mix-rem .l{ font-size:12px; font-weight:600; color:var(--ink-2); }
.mix-rem .v{ font-family:'JetBrains Mono',monospace; font-size:17px; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:-0.01em; color:var(--ink); }
.mix-rem.done .l::after{ content:' ✓'; color:#1a8e5a; }
.mix-rem.done .v{ color:#1a8e5a; }

/* ── Cobro: grilla de montos por método (estilo "Editar pagos" mejorado) ── */
.paysheet-total{ margin-left:auto; margin-right:10px; font-family:'JetBrains Mono',monospace; font-size:16px; font-weight:700; font-variant-numeric:tabular-nums; }
.paybar{ height:7px; border-radius:99px; background:rgba(13,20,36,0.07); overflow:hidden; margin:12px 2px 7px; }
.paybar-fill{ height:100%; width:0%; border-radius:99px; background:linear-gradient(90deg,var(--purple),var(--purple-2)); transition:width 260ms cubic-bezier(.2,.8,.2,1); }
.paybar-fill.done{ background:linear-gradient(90deg,#1f9d63,#34c77d); }
.paystat{ display:flex; justify-content:space-between; align-items:baseline; padding:0 2px 2px; font-size:11.5px; color:var(--ink-3); }
.paystat b{ font-family:'JetBrains Mono',monospace; font-size:13.5px; font-weight:700; color:var(--ink); margin-left:4px; font-variant-numeric:tabular-nums; }
#pay-rem-wrap.vuelto, #pay-rem-wrap.vuelto b{ color:#1a8e5a; }
.pmrows{ display:flex; flex-direction:column; gap:7px; margin:12px 0 9px; }
.pmrow{ display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:13px; cursor:pointer;
  background:rgba(255,255,255,0.7); border:1.5px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); transition:all 150ms; }
.pmrow:hover{ background:#fff; }
.pmrow.active{ border-color:var(--purple); background:rgba(107,95,255,0.07); box-shadow:var(--glass-hi), 0 4px 12px rgba(107,95,255,0.14); }
.pmrow .pmi{ width:32px; height:32px; flex:0 0 auto; border-radius:9px; display:flex; align-items:center; justify-content:center; color:var(--purple); background:rgba(107,95,255,0.10); transition:all 150ms; }
.pmrow.active .pmi{ background:var(--purple); color:#fff; }
.pmrow .pmi svg{ width:17px; height:17px; }
.pmrow .pmn{ flex:1; font-size:12.5px; font-weight:600; }
.pmrow .pma{ font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--ink); }
.pmrow .pma.zero{ color:var(--ink-4); }
.pmrow.active .pma{ color:var(--purple); }
.pmfill{ width:100%; display:flex; align-items:center; justify-content:center; gap:7px; padding:9px; border-radius:11px; margin-bottom:10px;
  font-size:12px; font-weight:600; color:var(--purple); background:rgba(107,95,255,0.08); border:1px solid rgba(107,95,255,0.22); transition:all 140ms; }
.pmfill:hover{ background:rgba(107,95,255,0.14); }
.pmfill b{ font-weight:700; }
.pmfill svg{ width:15px; height:15px; }
.cobrar:disabled{ filter:grayscale(0.4); opacity:0.5; cursor:not-allowed; box-shadow:none; transform:none; }
.cart-head{ flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:14px 14px 11px; border-bottom:1px solid rgba(13,20,36,0.05); }
.cart-title{ font-size:15px; font-weight:700; flex:1; }
.cart-count{ padding:3px 11px; border-radius:20px; background:var(--purple); color:#fff; font-size:11px; font-weight:700; }
.cart-menu{ color:var(--ink-4); width:24px; height:24px; display:flex; align-items:center; justify-content:center; border-radius:7px; transition:all 140ms; }
.cart-menu:hover{ color:var(--ink-2); background:rgba(13,20,36,0.05); }
.cart-menu svg{ width:18px; height:18px; }
.cust{ flex:0 0 auto; margin:11px 12px 0; padding:10px 11px; border-radius:13px; display:flex; align-items:center; gap:9px;
  background:rgba(255,255,255,0.7); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); }
.cust-av{ width:34px; height:34px; flex:0 0 auto; border-radius:10px; background:rgba(107,95,255,0.10); border:1px solid rgba(107,95,255,0.18); display:flex; align-items:center; justify-content:center; color:var(--purple); }
.cust-av svg{ width:17px; height:17px; }
.cust-name{ font-size:12.5px; font-weight:600; }
.cust-sub{ font-size:9.5px; color:var(--ink-3); }
.cust-cta{ margin-left:auto; font-size:11.5px; font-weight:600; color:var(--purple); display:flex; align-items:center; gap:4px; padding:6px 10px; border-radius:9px; transition:background 140ms; }
.cust-cta:hover{ background:rgba(107,95,255,0.08); }
.cust-cta svg{ width:14px; height:14px; }

.items{ flex:1; min-height:0; overflow-y:auto; padding:10px 12px; display:flex; flex-direction:column; gap:6px; }
.item{ display:flex; align-items:center; gap:9px; padding:8px 9px; border-radius:12px; background:rgba(255,255,255,0.65); border:1px solid rgba(255,255,255,0.88); box-shadow:var(--glass-hi); transition:background 140ms; }
.item:hover{ background:rgba(255,255,255,0.86); }
.item-thumb{ width:36px; height:36px; flex:0 0 auto; border-radius:9px; overflow:hidden; background:#fff; border:1px solid rgba(13,20,36,0.05); }
.item-thumb img{ width:100%; height:100%; object-fit:cover; }
.item-info{ flex:1; min-width:0; }
.item-name{ font-size:11.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.item-sku{ font-family:'JetBrains Mono',monospace; font-size:8.5px; color:var(--ink-4); }
.item-right{ display:flex; flex-direction:column; align-items:flex-end; gap:5px; flex:0 0 auto; }
.item-sub{ font-family:'JetBrains Mono',monospace; font-size:12px; font-weight:600; font-variant-numeric:tabular-nums; }
.qty{ display:flex; align-items:center; gap:5px; }
.qbtn{ width:19px; height:19px; border-radius:6px; background:rgba(13,20,36,0.06); color:var(--ink-2); font-size:12px; font-weight:600; display:flex; align-items:center; justify-content:center; transition:all 120ms; }
.qbtn:hover{ background:rgba(107,95,255,0.14); color:var(--purple); }
.qnum{ font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:700; min-width:14px; text-align:center; }
.del{ color:#cfd4e0; width:18px; height:18px; display:flex; align-items:center; justify-content:center; transition:color 120ms; }
.del:hover{ color:var(--red); }
.del svg{ width:12px; height:12px; }

.summary{ flex:0 0 auto; padding:11px 14px 0; border-top:1px solid rgba(13,20,36,0.05); }
.srow{ display:flex; justify-content:space-between; align-items:center; padding:3px 0; }
.slabel{ font-size:11.5px; color:var(--ink-3); }
.sval{ font-family:'JetBrains Mono',monospace; font-size:12px; font-weight:500; font-variant-numeric:tabular-nums; }
.sval.green{ color:#1a8e5a; }
.total{ display:flex; justify-content:space-between; align-items:baseline; padding:9px 0 4px; margin-top:4px; border-top:1px solid rgba(13,20,36,0.06); }
.total-label{ font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:var(--ink); }
.total-amt{ font-size:30px; font-weight:800; letter-spacing:-0.03em; color:var(--ink); font-variant-numeric:tabular-nums; }
.total-cur{ font-size:14px; font-weight:600; color:var(--ink-3); margin-right:2px; vertical-align:top; }
/* promo aplicada + tag de cliente (conecta Ofertas ↔ Clientes en el POS) */
.promo-applied{ display:flex; align-items:center; gap:9px; padding:8px 10px; margin:0 0 9px; border-radius:12px; background:linear-gradient(135deg, rgba(107,95,255,0.10), rgba(214,93,177,0.09)); border:1px solid rgba(107,95,255,0.22); }
.promo-applied .pa-ic{ width:28px; height:28px; border-radius:9px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; color:#fff; background:linear-gradient(135deg,#d65db1,#6b5fff); box-shadow:0 4px 10px rgba(107,95,255,0.3); }
.promo-applied .pa-ic svg{ width:15px; height:15px; }
.promo-applied .pa-tx{ flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
.promo-applied .pa-tx b{ font-size:12px; font-weight:700; color:var(--ink); }
.promo-applied .pa-tx small{ font-size:9.5px; color:var(--ink-3); }
.promo-applied .pa-amt{ font-family:'JetBrains Mono',monospace; font-size:13px; font-weight:800; color:#1a8e5a; flex:0 0 auto; }
.cust-tag{ display:inline-flex; align-items:center; font-size:9px; font-weight:700; color:#b56a2e; background:rgba(247,152,74,0.12); border:1px dashed rgba(247,152,74,0.55); padding:1px 6px; border-radius:5px; margin-left:6px; vertical-align:middle; }

.pay{ flex:0 0 auto; padding:9px 14px 13px; }
.pay-label{ font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--ink-4); margin-bottom:7px; }
.pay-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:9px; }
.pm{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; padding:8px 3px; border-radius:10px; font-size:9.5px; font-weight:600; color:var(--ink-2);
  background:rgba(255,255,255,0.7); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); transition:all 140ms; }
.pm:hover{ color:var(--ink); background:rgba(255,255,255,0.9); transform:translateY(-1px); }
.pm.sel{ color:var(--purple); background:rgba(107,95,255,0.1); border-color:rgba(107,95,255,0.3); }
.pm svg{ width:16px; height:16px; }
.cobrar{ width:100%; display:flex; align-items:center; justify-content:center; gap:9px; padding:14px; border-radius:13px;
  background:linear-gradient(140deg,var(--purple) 0%,var(--purple-2) 100%); color:#fff; font-size:14.5px; font-weight:800; letter-spacing:-0.02em;
  box-shadow:0 7px 20px rgba(107,95,255,0.42), 0 2px 6px rgba(107,95,255,0.28); transition:transform 170ms cubic-bezier(.2,.8,.2,1), box-shadow 170ms; }
.cobrar:hover{ transform:translateY(-1px); box-shadow:0 10px 26px rgba(107,95,255,0.52); }
.cobrar svg{ width:17px; height:17px; }
.cobrar .amt{ font-family:'JetBrains Mono',monospace; font-weight:700; font-variant-numeric:tabular-nums; opacity:0.92; }

@media (prefers-reduced-motion:reduce){ *{ animation:none !important; transition-duration:0.01ms !important; } }

/* ════ STAGE SWAP (catálogo / cliente / pago) ════ */
.main:not([data-view="prod"]) .cats{ display:none; }
.stage{ display:none; flex:1; min-height:0; flex-direction:column; }
.main[data-view="prod"] .stage-prod{ display:flex; }
.main[data-view="cliente"] .stage-cliente{ display:flex; animation:stageIn 260ms cubic-bezier(.2,.8,.2,1); }
.main[data-view="pago"] .stage-pago{ display:flex; animation:stageIn 260ms cubic-bezier(.2,.8,.2,1); }
@keyframes stageIn{ from{ opacity:0; transform:translateY(8px); } to{ opacity:1; transform:translateY(0); } }
.stage-head{ flex:0 0 auto; display:flex; align-items:center; gap:11px; padding:16px 18px; border-bottom:1px solid rgba(13,20,36,0.05); }
.stage-back{ width:34px; height:34px; flex:0 0 auto; border-radius:10px; display:flex; align-items:center; justify-content:center; color:var(--ink-2);
  background:rgba(255,255,255,0.7); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); transition:all 150ms; }
.stage-back:hover{ color:var(--ink); transform:translateX(-1px); }
.stage-back svg{ width:17px; height:17px; }
.stage-title{ font-size:16px; font-weight:700; line-height:1.2; }
.stage-title small{ display:block; font-size:11px; font-weight:500; color:var(--ink-3); margin-top:2px; }
.stage-body{ flex:1; min-height:0; overflow-y:auto; padding:24px 20px; }

/* form cliente */
.form-grid{ max-width:540px; margin:0 auto; display:flex; flex-direction:column; gap:15px; }
.frow{ display:flex; gap:12px; align-items:flex-end; }
.field{ flex:1; display:flex; flex-direction:column; gap:6px; min-width:0; }
.field label{ font-size:10.5px; font-weight:600; color:var(--ink-2); text-transform:uppercase; letter-spacing:0.05em; }
.field input,.field select{ width:100%; height:44px; padding:0 14px; border-radius:12px; font-size:13.5px; color:var(--ink); font-family:inherit;
  background:rgba(255,255,255,0.78); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); transition:all 150ms; }
.field input:focus,.field select:focus{ border-color:rgba(107,95,255,0.45); box-shadow:0 0 0 4px rgba(107,95,255,0.10); }
.field input::placeholder{ color:var(--ink-4); }
.seg{ display:inline-flex; padding:4px; gap:2px; border-radius:11px; background:rgba(255,255,255,0.6); border:1px solid rgba(255,255,255,0.85); box-shadow:var(--glass-hi); }
.seg button{ padding:9px 18px; border-radius:8px; font-size:13px; font-weight:600; color:var(--ink-2); transition:all 150ms; }
.seg button.on{ background:var(--ink); color:#fff; }
.padron-btn{ height:44px; flex:0 0 auto; padding:0 16px; border-radius:12px; font-size:13px; font-weight:600; color:#fff;
  background:linear-gradient(140deg,var(--purple),var(--purple-2)); box-shadow:0 4px 12px rgba(107,95,255,0.35); display:flex; align-items:center; gap:7px; }
.padron-btn svg{ width:15px; height:15px; }
.form-actions{ display:flex; justify-content:flex-end; gap:10px; margin-top:8px; }
.btn-ghost{ padding:12px 20px; border-radius:12px; font-size:14px; font-weight:600; color:var(--ink-2); background:rgba(255,255,255,0.6); border:1px solid rgba(255,255,255,0.85); transition:all 150ms; }
.btn-ghost:hover{ color:var(--ink); background:rgba(255,255,255,0.85); }
.btn-solid{ padding:12px 24px; border-radius:12px; font-size:14px; font-weight:700; color:#fff; background:linear-gradient(140deg,var(--purple),var(--purple-2)); box-shadow:0 6px 16px rgba(107,95,255,0.4); transition:all 150ms; display:inline-flex; align-items:center; gap:8px; }
.btn-solid:hover{ transform:translateY(-1px); box-shadow:0 9px 22px rgba(107,95,255,0.5); }
.btn-solid svg{ width:17px; height:17px; }

/* pago chooser */
.pay-total{ max-width:540px; margin:0 auto 24px; text-align:center; }
.pay-total .lbl{ font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:var(--ink-3); }
.pay-total .amt{ font-size:46px; font-weight:800; letter-spacing:-0.03em; margin-top:4px; font-variant-numeric:tabular-nums; }
.pay-methods{ max-width:540px; margin:0 auto; display:grid; grid-template-columns:1fr 1fr; gap:13px; }
.pmethod{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:11px; padding:26px 16px; border-radius:18px; cursor:pointer;
  background:rgba(255,255,255,0.8); border:2px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi), 0 2px 8px rgba(54,70,120,0.07); transition:all 180ms cubic-bezier(.2,.8,.2,1); }
.pmethod:hover{ transform:translateY(-2px); box-shadow:var(--glass-hi), 0 10px 24px rgba(54,70,120,0.14); }
.pmethod.on{ border-color:var(--purple); background:rgba(107,95,255,0.08); }
.pmethod .picon{ width:52px; height:52px; border-radius:14px; display:flex; align-items:center; justify-content:center; color:var(--purple); background:rgba(107,95,255,0.10); transition:all 180ms; }
.pmethod.on .picon{ background:var(--purple); color:#fff; }
.pmethod .picon svg{ width:25px; height:25px; }
.pmethod .pname{ font-size:14.5px; font-weight:600; color:var(--ink); }
.pay-confirm{ max-width:540px; margin:22px auto 0; }
.pay-confirm .btn-solid{ width:100%; justify-content:center; padding:16px; font-size:15px; }

/* botón "Elegir método de pago" en el carrito */
.paysel{ width:100%; display:flex; align-items:center; gap:10px; padding:11px 12px; border-radius:13px; margin-bottom:9px; text-align:left;
  background:rgba(255,255,255,0.7); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); transition:all 150ms; }
.paysel:hover{ background:rgba(255,255,255,0.92); }
.paysel .pic{ width:34px; height:34px; flex:0 0 auto; border-radius:10px; background:rgba(107,95,255,0.10); color:var(--purple); display:flex; align-items:center; justify-content:center; }
.paysel .pic svg{ width:17px; height:17px; }
.paysel .ptx{ flex:1; min-width:0; }
.paysel .pl{ display:block; font-size:8.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--ink-4); }
.paysel .pv{ display:block; font-size:13px; font-weight:600; color:var(--ink); }
.paysel .pchev{ color:var(--ink-4); flex:0 0 auto; }
.paysel .pchev svg{ width:16px; height:16px; }

/* top-tools cluster (consistencia con dashboard) */
.top-tools{ display:flex; align-items:center; gap:8px; margin-left:auto; }
.iconbtn{ width:40px; height:40px; display:flex; align-items:center; justify-content:center; border-radius:12px; color:var(--ink-1); position:relative; cursor:pointer; transition:all 160ms; flex:0 0 auto; }
.iconbtn:hover{ transform:translateY(-1px); }
.iconbtn svg{ width:18px; height:18px; }
.iconbtn .ndot{ position:absolute; top:6px; right:6px; min-width:15px; height:15px; border-radius:999px; background:#ee6a8e; color:#fff; font-size:9px; font-weight:700; display:flex; align-items:center; justify-content:center; border:2px solid rgba(255,255,255,0.9); }
.user-chip{ display:flex; align-items:center; gap:9px; padding:5px 14px 5px 5px; border-radius:999px; flex:0 0 auto; }
.user-name{ font-size:12.5px; font-weight:600; line-height:1.25; color:var(--ink-1); }
.user-role{ font-size:10.5px; color:var(--ink-3); }

/* ══ CORRECCIÓN sobre la maqueta (no es extracción) ═══════════════════
   OJO: este archivo es UN TEMPLATE LITERAL. Nada de backticks acá adentro,
   ni siquiera en los comentarios — cierran el string y rompen TODA la app
   con un "Expected a semicolon" que apunta al CSS y no al verdadero culpable.

   El selector .shell declara height:100dvh pero NO declara filas, así que la
   única fila del grid queda en auto y crece con el contenido: la altura fija
   no la contiene. Medido en headless (1600x848): .main daba 1005px dentro de
   un shell de 848 → la columna del carrito se cortaba 157px abajo, y con la
   hoja de cobro abierta el botón de confirmar quedaba FUERA de la pantalla.

   La maqueta tiene el mismo bug (mainH 996 vs shellH 848 en checkpoint-v20),
   o sea que esto no es divergencia sino un arreglo que la maqueta también
   necesita. Va acá abajo, después de la extracción verbatim, para no
   ensuciarla y para que una re-extracción no lo pise. */
.shell{ grid-template-rows:minmax(0,1fr); }

/* ── Cobro tipeable por método (v20 · estilo lisCobro) ──────────────
   Extraido VERBATIM de pos-preview/checkpoint-v20-cobro-tipeable.html.
   El v19 mostraba el monto en un <span>; el v20 lo hace un <input> que
   acepta teclado fisico Y numpad por el mismo camino. */
.pmrow .pmf{ display:flex; align-items:center; gap:3px; padding:5px 10px; border-radius:9px; background:rgba(13,20,36,0.04); border:1px solid rgba(13,20,36,0.08); transition:all 140ms; }
.pmrow.active .pmf{ background:rgba(107,95,255,0.09); border-color:rgba(107,95,255,0.4); }
.pmrow .pmc{ font-family:'JetBrains Mono',monospace; font-size:12.5px; font-weight:700; color:var(--ink-4); }
.pmrow.active .pmc{ color:var(--purple); }
.pmin{ width:78px; text-align:right; font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--ink); background:transparent; border:none; outline:none; padding:0; caret-color:var(--purple); }
.pmin.zero{ color:var(--ink-4); }
.pmrow.active .pmin{ color:var(--purple); }
.pmin::placeholder{ color:var(--ink-4); }

/* Fila que se ve pero no se puede cobrar en F0 (mp_qr: falta el SDK de
   MercadoPago que emite el mp_payment_external_id). Se muestra en vez de
   ocultarse para no mentir sobre los medios que el comercio va a tener. */
.pmrow[data-off="1"]{ opacity:0.5; }
.pmrow[data-off="1"] .pmf{ background:rgba(13,20,36,0.03); border-style:dashed; }
.pmrow .pmoff{ font-size:10px; font-weight:600; color:var(--ink-4); white-space:nowrap; }
`;
