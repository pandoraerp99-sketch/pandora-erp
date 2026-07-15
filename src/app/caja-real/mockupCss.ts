// CSS de la maqueta (public/caja.html) extraido VERBATIM. No editar a mano.
// Es la fuente de la fidelidad visual de la caja real.
export const MOCKUP_CSS = `
  :root {
    --ink-0:#0d1424; --ink-1:#1f2a44; --ink-2:#4a5570; --ink-3:#7681a0; --ink-4:#a8b0c5;
    --glass-bg:rgba(255,255,255,0.58); --glass-bg-2:rgba(255,255,255,0.72);
    --glass-border:rgba(255,255,255,0.85);
    --glass-shadow:0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 32px rgba(54,70,120,0.10), 0 2px 8px rgba(54,70,120,0.06);
    --purple:#6b5fff; --purple-2:#9088ff; --blue:#5b8cff; --blue-2:#8eb0ff;
    --orange:#f7984a; --green:#34c77d; --pink:#ee6a8e; --red:#ef5d6a; --yellow:#f4c948;
    --r-md:14px; --r-lg:20px;
    --font:'Inter',ui-sans-serif,system-ui,sans-serif;
    --mono:'JetBrains Mono',ui-monospace,monospace;
  }
  * { box-sizing:border-box; }
  html, body {
    margin:0; padding:0; color:var(--ink-0); font-family:var(--font);
    -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
    letter-spacing:-0.011em; min-width:1440px; background:#d8e0f0;
  }
  body::before {
    content:''; position:fixed; inset:0; z-index:0;
    background:
      radial-gradient(ellipse 60% 50% at 20% 90%, rgba(238,200,220,0.55) 0%, transparent 60%),
      radial-gradient(ellipse 70% 60% at 85% 80%, rgba(240,210,180,0.40) 0%, transparent 60%),
      radial-gradient(ellipse 50% 40% at 60% 30%, rgba(255,255,255,0.6) 0%, transparent 50%),
      radial-gradient(ellipse 50% 40% at 15% 30%, rgba(195,215,245,0.6) 0%, transparent 60%),
      linear-gradient(180deg,#b8c8e8 0%,#c8d4ea 25%,#e0d4e0 60%,#f0d8d2 100%);
  }
  body::after {
    content:''; position:fixed; inset:0; z-index:0; pointer-events:none;
    background:
      radial-gradient(ellipse 400px 80px at 25% 65%, rgba(255,255,255,0.55) 0%, transparent 70%),
      radial-gradient(ellipse 500px 100px at 75% 75%, rgba(255,255,255,0.45) 0%, transparent 70%),
      radial-gradient(ellipse 300px 60px at 50% 40%, rgba(255,255,255,0.4) 0%, transparent 70%),
      radial-gradient(ellipse 350px 80px at 10% 85%, rgba(255,255,255,0.5) 0%, transparent 70%);
  }
  ::-webkit-scrollbar{ width:7px; height:7px; }
  ::-webkit-scrollbar-track{ background:transparent; }
  ::-webkit-scrollbar-thumb{ background:rgba(13,20,36,0.14); border-radius:5px; border:2px solid transparent; background-clip:padding-box; }

  .glass {
    background:var(--glass-bg); backdrop-filter:blur(28px) saturate(140%);
    -webkit-backdrop-filter:blur(28px) saturate(140%);
    border:1px solid var(--glass-border); border-radius:var(--r-lg); box-shadow:var(--glass-shadow);
    position:relative;
  }
  .glass-strong {
    background:var(--glass-bg-2); backdrop-filter:blur(32px) saturate(150%);
    -webkit-backdrop-filter:blur(32px) saturate(150%);
    border:1px solid var(--glass-border); border-radius:var(--r-lg); box-shadow:var(--glass-shadow);
    position:relative;
  }
  .tnum { font-variant-numeric:tabular-nums; }
  .mono { font-family:var(--mono); }

  /* ===== Sidebar ===== */
  .side {
    position:fixed; left:10px; top:10px; bottom:10px; width:210px;
    padding:22px 14px 18px; display:flex; flex-direction:column; z-index:10; border-radius:var(--r-lg);
  }
  .logo-row { display:flex; align-items:center; gap:10px; padding:0 8px 22px; }
  .logo-text {
    font-size:19px; font-weight:700; letter-spacing:-0.025em;
    background:linear-gradient(135deg,#2a3454 0%,#4a5878 100%);
    -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;
  }
  .nav { display:flex; flex-direction:column; gap:3px; flex:1; overflow-y:auto; min-height:0; padding-right:4px; margin-right:-4px; }
  .nav-item {
    display:flex; align-items:center; gap:11px; padding:10px 11px; border-radius:12px;
    color:var(--ink-2); font-size:13.5px; font-weight:500; cursor:pointer;
    transition:all 200ms cubic-bezier(.4,0,.2,1); position:relative;
  }
  .nav-item:hover { color:var(--ink-0); background:rgba(255,255,255,0.4); }
  .nav-item.active {
    background:rgba(255,255,255,0.92); color:var(--ink-0);
    box-shadow:0 1px 2px rgba(54,70,120,0.06), 0 4px 12px rgba(54,70,120,0.08);
  }
  .nav-item.active .nav-icon-box { background:var(--purple); color:#fff; box-shadow:0 4px 10px rgba(107,95,255,0.4); }
  .nav-icon-box {
    width:26px; height:26px; display:flex; align-items:center; justify-content:center;
    border-radius:7px; background:transparent; color:var(--ink-2); transition:all 200ms; flex-shrink:0;
  }
  .afip-chip {
    margin-top:auto; margin-bottom:12px; padding:11px 12px; border-radius:14px;
    background:rgba(52,199,125,0.10); border:1px solid rgba(52,199,125,0.28);
    box-shadow:0 1px 0 rgba(255,255,255,0.6) inset;
  }
  .afip-top { display:flex; align-items:center; gap:7px; }
  .afip-title { font-size:11.5px; font-weight:700; color:#1a7a4a; letter-spacing:-0.01em; }
  .afip-badge { margin-left:auto; font-size:8.5px; font-weight:700; color:var(--green); letter-spacing:0.06em; font-family:var(--mono); }
  .afip-sub { font-size:10.5px; color:#5a9b78; margin-top:4px; padding-left:15px; }

  .live-dot { width:8px; height:8px; border-radius:999px; background:var(--green); position:relative; display:inline-block; flex-shrink:0; }
  .live-dot::after {
    content:''; position:absolute; inset:-4px; border-radius:999px; background:var(--green);
    opacity:0.4; animation:liveRing 1.8s cubic-bezier(.2,.7,.2,1) infinite;
  }
  @keyframes liveRing { 0% { transform:scale(0.8); opacity:0.6; } 100% { transform:scale(2.2); opacity:0; } }

  /* ===== Main ===== */
  .main { margin-left:228px; padding:14px 10px 44px 10px; position:relative; z-index:1; }

  /* session bar */
  .session-bar { display:flex; align-items:center; gap:24px; padding:16px 20px; margin-bottom:18px; }
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
  .btn-primary {
    display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:12px 18px;
    background:linear-gradient(135deg,var(--purple) 0%,var(--purple-2) 100%); color:#fff;
    font-weight:600; font-size:13.5px; border:none; border-radius:12px; cursor:pointer; font-family:var(--font);
    box-shadow:0 4px 10px rgba(107,95,255,0.35), 0 1px 2px rgba(107,95,255,0.2); transition:transform 180ms, box-shadow 180ms;
    width:100%;
  }
  .btn-primary:hover { transform:translateY(-1px); box-shadow:0 6px 14px rgba(107,95,255,0.45); }

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
  html[data-theme="dark"] .mov-fchip[aria-pressed="true"] { box-shadow:inset 0 1px 0 rgba(255,255,255,0.10), 0 3px 10px rgba(3,7,20,0.35); }
  html[data-theme="dark"] .mov-fchip[aria-pressed="true"] .fsw { box-shadow:0 0 0 2.5px rgba(255,255,255,0.16); }
  .mov-scroll { max-height:400px; overflow-y:auto; }
  .mov-scroll thead th {
    position:sticky; top:0; z-index:1; padding:7px 0 11px;
    background:linear-gradient(rgba(255,255,255,0.90), rgba(255,255,255,0.62));
    -webkit-backdrop-filter:blur(10px) saturate(140%); backdrop-filter:blur(10px) saturate(140%);
  }
  html[data-theme="dark"] .mov-scroll thead th {
    background:linear-gradient(rgba(29,37,66,0.90), rgba(29,37,66,0.60));
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
  html[data-theme="dark"] .mov-corr { color:#55dd9b; background:rgba(52,199,125,0.16); }
  .reasign-cur { font-size:13px; color:var(--ink-2); }
  .reasign-cur b { color:var(--ink-0); }
  .reasign-pick { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .reasign-opt { display:inline-flex; align-items:center; gap:8px; padding:10px 12px; border-radius:11px; font-size:13px; font-weight:600; color:var(--ink-1); background:rgba(255,255,255,0.5); border:1px solid rgba(13,20,36,0.08); cursor:pointer; transition:all 150ms; text-align:left; }
  html[data-theme="dark"] .reasign-opt { background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.09); }
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
  .btn-primary:disabled { opacity:0.45; box-shadow:none; transform:none; cursor:not-allowed; }
  @keyframes rmFlash { 0% { box-shadow:0 0 0 2px rgba(107,95,255,0.35); } 100% { box-shadow:0 0 0 2px rgba(107,95,255,0); } }
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
  html[data-theme="dark"] .rs-row { background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.09); }
  .rs-row.active { border-color:var(--purple); background:rgba(107,95,255,0.07); }
  .rs-sw { width:9px; height:9px; border-radius:3px; flex:0 0 auto; }
  .rs-n { flex:1; font-size:12.5px; font-weight:600; color:var(--ink-1); }
  .rs-f { display:flex; align-items:center; gap:3px; padding:5px 9px; border-radius:9px; background:rgba(13,20,36,0.04); border:1px solid rgba(13,20,36,0.08); transition:all 140ms; }
  html[data-theme="dark"] .rs-f { background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.08); }
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
  html[data-theme="dark"] .rs-numpad button { background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.09); color:var(--ink-0); }

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
  .c-red { color:var(--red); } .c-green { color:#1a8e5a; } .c-ink { color:var(--ink-0); }
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

  @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  .fade-in { animation:fadeUp 600ms cubic-bezier(.2,.7,.2,1) backwards; }

/* sidebar footer canónico (alineado a dashboard) */
.side-foot{ margin-top:auto; padding-top:12px; display:flex; flex-direction:column; gap:9px; }
.afip{ padding:10px 11px; border-radius:13px; background:rgba(52,199,125,0.08); border:1px solid rgba(52,199,125,0.20); }
.afip-top{ display:flex; align-items:center; gap:7px; }
.afip-dot{ width:7px; height:7px; border-radius:50%; background:var(--green); flex:0 0 auto; animation:pg 2.4s ease-in-out infinite; }
.afip-name{ font-size:11.5px; font-weight:700; color:#177a4a; }
.afip-live{ margin-left:auto; font-size:8.5px; font-weight:800; letter-spacing:0.06em; color:var(--green); }
.afip-sub{ font-size:10px; color:#5a9b78; padding-left:14px; margin-top:2px; }
@keyframes pg{ 0%,100%{box-shadow:0 0 0 2px rgba(52,199,125,0.22)} 50%{box-shadow:0 0 0 5px rgba(52,199,125,0)} }
.cashier{ display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:13px; background:rgba(255,255,255,0.66); border:1px solid rgba(255,255,255,0.9); box-shadow:inset 0 1px 0 rgba(255,255,255,0.9); }
.cashier-av{ width:32px; height:32px; flex:0 0 auto; border-radius:50%; background:linear-gradient(135deg,var(--purple),var(--blue)); display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px; font-weight:700; }
.avatar-ring{ padding:2px; border-radius:50%; flex:0 0 auto; display:flex; background:conic-gradient(from 0deg,#6b5fff,#5b8cff,#34c77d,#f7984a,#ee6a8e,#6b5fff); animation:spinRing 6s linear infinite; }
.avatar-ring > .cashier-av{ animation:spinRing 6s linear infinite reverse; border:2px solid rgba(255,255,255,0.9); }
@keyframes spinRing{ to{ transform:rotate(360deg); } }
.cashier-name{ font-size:12px; font-weight:600; line-height:1.2; }
.cashier-role{ font-size:10px; color:var(--ink-3); }
.cashier-live{ width:7px; height:7px; border-radius:50%; background:var(--green); margin-left:auto; flex:0 0 auto; animation:pg 2.4s ease-in-out infinite; }

/* top-tools cluster (consistencia con dashboard) */
.topbar{ display:flex; align-items:center; gap:12px; margin-bottom:16px; }
.search{ position:relative; flex:1; display:flex; align-items:center; height:42px; border-radius:14px; padding:0 14px 0 40px; }
.search > svg{ position:absolute; left:14px; width:16px; height:16px; color:var(--ink-3); }
.search input{ flex:1; font-size:13px; background:none; border:none; outline:none; color:var(--ink-0); }
.search input::placeholder{ color:var(--ink-3); }
.search .kbd{ font-size:10px; font-family:var(--mono); color:var(--ink-3); background:rgba(13,20,36,0.05); padding:3px 7px; border-radius:6px; margin-left:8px; }
.lecturax{ display:inline-flex; align-items:center; gap:8px; height:42px; padding:0 16px; border-radius:13px; font-size:13px; font-weight:600; color:var(--ink-1); cursor:pointer; transition:all 160ms; flex:0 0 auto; }
.lecturax:hover{ transform:translateY(-1px); color:var(--ink-0); }
.lecturax svg{ width:16px; height:16px; }
.top-tools{ display:flex; align-items:center; gap:8px; }
.iconbtn{ width:40px; height:40px; display:flex; align-items:center; justify-content:center; border-radius:12px; color:var(--ink-1); position:relative; background:var(--glass-bg); backdrop-filter:blur(28px) saturate(140%); -webkit-backdrop-filter:blur(28px) saturate(140%); border:1px solid var(--glass-border); box-shadow:var(--glass-shadow); cursor:pointer; transition:all 160ms; }
.iconbtn:hover{ transform:translateY(-1px); color:var(--ink-0); }
.iconbtn svg{ width:18px; height:18px; }
.iconbtn .ndot{ position:absolute; top:6px; right:6px; min-width:15px; height:15px; border-radius:999px; background:var(--pink); color:#fff; font-size:9px; font-weight:700; display:flex; align-items:center; justify-content:center; border:2px solid rgba(255,255,255,0.9); }
.user-chip{ display:flex; align-items:center; gap:9px; padding:5px 14px 5px 5px; border-radius:999px; }
.user-name{ font-size:12.5px; font-weight:600; line-height:1.25; color:var(--ink-0); }
.user-role{ font-size:10.5px; color:var(--ink-3); }

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
.denom-hd span:nth-child(2){ text-align:center; } .denom-hd span:nth-child(3){ text-align:right; }
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
.modal-actions .btn-primary{ width:auto; flex:2; }

/* Lectura X — reporte de control (read-only, no cierra la caja) */
.lx-badge{ margin-left:9px; font-family:var(--mono); font-size:11px; font-weight:700; color:var(--purple); background:rgba(107,95,255,0.13); padding:2px 9px; border-radius:999px; }
.lx-body{ display:flex; flex-direction:column; gap:16px; }
.lx-meta{ display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; padding:13px 15px; border-radius:13px; background:rgba(255,255,255,0.5); border:1px solid rgba(255,255,255,0.8); }
html[data-theme="dark"] .lx-meta{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.09); }
.lx-meta .k{ font-size:9px; text-transform:uppercase; letter-spacing:0.07em; font-family:var(--mono); color:var(--ink-3); }
.lx-meta .v{ font-size:12.5px; font-weight:650; color:var(--ink-1); margin-top:2px; }
.lx-sec-h{ font-size:9.5px; text-transform:uppercase; letter-spacing:0.08em; font-family:var(--mono); color:var(--ink-3); font-weight:600; margin-bottom:8px; }
.lx-line{ display:flex; align-items:center; justify-content:space-between; padding:5px 0; font-size:13px; color:var(--ink-1); }
.lx-line.sub{ font-size:12px; color:var(--ink-2); padding:3px 0; }
.lx-line.total{ border-top:1px solid rgba(13,20,36,0.10); margin-top:6px; padding-top:10px; font-weight:700; color:var(--ink-0); }
html[data-theme="dark"] .lx-line.total{ border-top-color:rgba(255,255,255,0.12); }
.lx-line.total b{ color:var(--purple); font-size:16px; }
.lx-pago{ display:flex; align-items:center; gap:10px; padding:4px 0; font-size:12.5px; color:var(--ink-1); }
.lx-pago .d{ width:8px; height:8px; border-radius:3px; flex:0 0 auto; }
.lx-pago .nm{ flex:1; }
.lx-pago .tk{ font-size:11px; color:var(--ink-3); margin-right:10px; }
.lx-pago .am{ font-weight:650; }
.lx-note{ font-size:11px; line-height:1.55; color:var(--ink-2); background:rgba(107,95,255,0.06); border:1px solid rgba(107,95,255,0.15); border-radius:12px; padding:11px 13px; }
.lx-note b{ color:var(--purple); }

/* alivios de caja */
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
@keyframes aliAdjIn{ from{ opacity:0; transform:translateY(-3px); } }
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
.ali-hist-av{ width:28px; height:28px; border-radius:50%; background:linear-gradient(135deg,var(--purple),var(--blue)); color:#fff; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
.ali-hist-tx{ flex:1; min-width:0; }
.ali-hist-name{ font-weight:600; color:var(--ink-1); }
.ali-hist-sub{ font-size:10.5px; color:var(--ink-3); margin-top:1px; }
.ali-hist-amt{ font-family:var(--mono); font-weight:700; color:var(--ink-1); flex:0 0 auto; }
.ali-hist-amt .falt{ color:#c93545; font-weight:700; font-size:10.5px; margin-left:6px; }
.alivio-num{ font-family:var(--mono); font-size:10px; font-weight:600; color:var(--ink-3); background:rgba(13,20,36,0.05); padding:1px 6px; border-radius:5px; margin-left:6px; }
html[data-theme="dark"] .alivio-num{ background:rgba(255,255,255,0.08); }
html[data-theme="dark"] .ali-hist{ border-top-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .ali-hist-row{ border-top-color:rgba(255,255,255,0.05); }
html[data-theme="dark"] .ali-hist-amt .falt{ color:#ff8b96; }

/* historial de cierres */
.cl-cajero{ display:inline-flex; align-items:center; gap:8px; }
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

/* ════════════════ MODO OSCURO · cielo nocturno (Claude Design) ════════════════ */
html[data-theme="dark"]{
  --ink-0:#eef2ff; --ink-1:#cdd6f0; --ink-2:#9aa6cc; --ink-3:#7581a8; --ink-4:#525e85;
  --glass-bg:rgba(24,31,58,0.55); --glass-bg-2:rgba(29,37,66,0.66);
  --glass-border:rgba(255,255,255,0.12);
  --glass-shadow:inset 0 1px 0 rgba(255,255,255,0.07), 0 8px 32px rgba(3,7,20,0.42), 0 2px 8px rgba(3,7,20,0.28);
  --purple:#8da2ff; --purple-2:#bcc8ff; --blue:#6fa8ff; --blue-2:#8eb0ff; --orange:#ffb87a; --green:#3fd68b; --pink:#f48fb5; --red:#ff8b96; --yellow:#f4c948;
}
html[data-theme="dark"] body{ background:#030615; color:var(--ink-0); }
html[data-theme="dark"] body::before{ background:
  radial-gradient(ellipse 60% 50% at 14% 92%, rgba(244,115,168,0.16) 0%, transparent 60%),
  radial-gradient(ellipse 55% 45% at 84% 12%, rgba(120,190,255,0.12) 0%, transparent 60%),
  radial-gradient(ellipse 60% 45% at 78% 82%, rgba(96,150,255,0.13) 0%, transparent 60%),
  radial-gradient(ellipse 50% 40% at 22% 32%, rgba(86,124,238,0.16) 0%, transparent 60%),
  linear-gradient(180deg,#030615 0%,#05091e 35%,#08102b 72%,#0b1535 100%); }
html[data-theme="dark"] body::after{ background:
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
  animation:twinkle 6.5s ease-in-out infinite; }
@keyframes twinkle{ 0%,100%{opacity:0.82;} 50%{opacity:1;} }
@media (prefers-reduced-motion:reduce){ html[data-theme="dark"] body::after{ animation:none; } }
html[data-theme="dark"] ::-webkit-scrollbar-thumb{ background:rgba(255,255,255,0.16); }

/* sidebar */
html[data-theme="dark"] .logo-text{ background:linear-gradient(135deg,#eef2ff 0%,#aebde8 100%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
html[data-theme="dark"] .nav-item:hover{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .nav-item.active{ background:rgba(255,255,255,0.12); box-shadow:inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 12px rgba(3,7,20,0.3); }
html[data-theme="dark"] .afip-chip{ background:rgba(52,199,125,0.1); border-color:rgba(52,199,125,0.24); box-shadow:none; }
html[data-theme="dark"] .afip-title, html[data-theme="dark"] .afip-name{ color:#55dd9b; }
html[data-theme="dark"] .afip-sub{ color:#7fb79b; }
html[data-theme="dark"] .afip{ background:rgba(52,199,125,0.1); border-color:rgba(52,199,125,0.22); }
html[data-theme="dark"] .cashier{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); box-shadow:inset 0 1px 0 rgba(255,255,255,0.07); }

/* topbar */
html[data-theme="dark"] .search .kbd{ background:rgba(255,255,255,0.08); }
html[data-theme="dark"] .iconbtn .ndot{ border-color:rgba(11,17,42,0.9); }
html[data-theme="dark"] .more-btn:hover{ background:rgba(255,255,255,0.06); }

/* session bar */
html[data-theme="dark"] .sg-div{ background:rgba(255,255,255,0.1); }
html[data-theme="dark"] .pill-open{ color:#55dd9b; }
html[data-theme="dark"] .mini-ava{ border-color:rgba(255,255,255,0.2); }

/* efectivo + evolución */
html[data-theme="dark"] .btn{ box-shadow:inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 6px rgba(3,7,20,0.3); }
html[data-theme="dark"] .cash-icon{ background:rgba(141,162,255,0.14); }
html[data-theme="dark"] .cash-right{ border-left-color:rgba(255,255,255,0.08); }

/* movimientos + tabla */
html[data-theme="dark"] .mov-cols > div:first-child{ border-right-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .mov-item{ border-top-color:rgba(255,255,255,0.06); }
html[data-theme="dark"] .tbl th{ border-bottom-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .tbl td{ border-top-color:rgba(255,255,255,0.06); }

/* arqueo + cierre */
html[data-theme="dark"] .arq-row{ border-top-color:rgba(255,255,255,0.07); }
html[data-theme="dark"] .arq-input{ background:rgba(255,255,255,0.06); border-color:rgba(141,162,255,0.4); box-shadow:0 0 0 3px rgba(141,162,255,0.1); }
html[data-theme="dark"] .arq-input:focus{ border-color:var(--purple); box-shadow:0 0 0 4px rgba(141,162,255,0.18); }
html[data-theme="dark"] .motivo-input{ background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.14); }
html[data-theme="dark"] .c-green{ color:#55dd9b; }
html[data-theme="dark"] .rm{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .rm-input{ background:rgba(255,255,255,0.06); border-color:rgba(141,162,255,0.35); }
html[data-theme="dark"] .res-cell:nth-child(odd){ border-right-color:rgba(255,255,255,0.07); }
html[data-theme="dark"] .res-cell:nth-child(n+3){ border-top-color:rgba(255,255,255,0.07); }

/* modal denominaciones */
html[data-theme="dark"] .modal-ov{ background:rgba(3,7,20,0.55); }
html[data-theme="dark"] .modal-x{ background:rgba(255,255,255,0.06); }
html[data-theme="dark"] .modal-x:hover{ background:rgba(255,255,255,0.12); }
html[data-theme="dark"] .denom-row{ border-top-color:rgba(255,255,255,0.06); }
html[data-theme="dark"] .dq{ background:rgba(255,255,255,0.06); border-color:rgba(141,162,255,0.3); color:var(--ink-0); }
html[data-theme="dark"] .denom-foot{ background:rgba(52,199,125,0.12); border-color:rgba(52,199,125,0.26); }
html[data-theme="dark"] .denom-foot > span:first-child{ color:#55dd9b; }
html[data-theme="dark"] .denom-total{ color:#7fe3ad; }

/* alivios + historial */
html[data-theme="dark"] .alivio{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .alivio.pend:hover{ background:rgba(255,255,255,0.09); }
html[data-theme="dark"] .ali-sum, html[data-theme="dark"] .ali-chip.pend, html[data-theme="dark"] .cl-amber, html[data-theme="dark"] .cl-chip.warn{ color:#ffb87a; }
html[data-theme="dark"] .ali-chip.done, html[data-theme="dark"] .cl-chip.ok{ color:#55dd9b; }
html[data-theme="dark"] .ali-chip.parcial{ color:#ffb87a; }
html[data-theme="dark"] .ali-chip.falta{ color:#ff8b96; }
html[data-theme="dark"] .ali-chip.ok2{ color:#55dd9b; }
html[data-theme="dark"] .ali-real b{ color:#55dd9b; }
html[data-theme="dark"] .ali-real .falt{ color:#ff8b96; }
html[data-theme="dark"] .ali-adj-bar{ background:rgba(247,152,74,0.1); border-color:rgba(247,152,74,0.28); }
html[data-theme="dark"] .ali-rin{ background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .ali-falta-btn{ background:rgba(239,93,106,0.16); color:#ff8b96; border-color:rgba(239,93,106,0.3); }
html[data-theme="dark"] .cl-chip.err{ color:#ff8b96; }
html[data-theme="dark"] .cl-ic:hover{ background:rgba(255,255,255,0.06); color:var(--ink-1); }

/* botón toggle de tema */
#themeBtn svg{ transition:transform 400ms cubic-bezier(.2,.7,.2,1); }
#themeBtn:hover svg{ transform:rotate(20deg); }

`;
