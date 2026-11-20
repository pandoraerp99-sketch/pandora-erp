// CSS de "Cargar gasto" (la vista que abre /gastos).
//
// Copia la pestaña Gastos de pos-preview/facturas-v4.html: mismas clases
// (.finput, .gdrop, .cimpact, .gsum, .gasto-row) y mismas medidas,
// para poder compararlas lado a lado con la maqueta.
//
// Tres diferencias con la maqueta, a proposito:
//   - Las etiquetas van en --ink-2 y no en --ink-3: a 10px, --ink-3 sobre el
//     vidrio no llega al 4,5 de WCAG AA.
//   - El violeta de los botones con texto blanco es #5f53f5 (5,2:1) y no
//     #6b5fff (4,45:1) ni el degradado a --purple-2 (~3:1).
//   - Los colores de categoria salen de las variables .cat-* (gastosCss), que
//     tienen variante oscura. La maqueta los pone inline (data-c), y un color
//     inline no tiene tema: ya rompio dos veces el modo oscuro.
//
// Todo lo que pinta fondo claro tiene su regla html[data-theme="dark"].
// OJO: es UN TEMPLATE LITERAL. Nada de backticks aca adentro.

export const CARGA_CSS = `
/* ═══════════════════ CARGAR GASTO ═══════════════════ */
.ptabs button{ font-weight:600; }
.cg-grid{ display:grid; grid-template-columns:minmax(0,1fr) 364px; gap:15px; align-items:start; }
@media (max-width:1180px){ .cg-grid{ grid-template-columns:minmax(0,1fr); } }

.cg{ padding:22px 22px 20px; cursor:default; }
.cg:hover{ transform:none; }
.sec-h{ font-size:11.5px; font-weight:700; color:var(--ink-2); text-transform:uppercase; letter-spacing:0.05em; margin:0 0 14px; display:flex; align-items:center; gap:9px; }
.sec-h .n{ width:21px; height:21px; border-radius:6px; background:#5f53f5; color:#fff; font-size:11px; display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-weight:700; box-shadow:0 3px 8px rgba(107,95,255,0.35); }

.cg .field{ flex:none; display:flex; flex-direction:column; gap:6px; min-width:0; }
.cg .field > label, .cg .field > .lbl{ font-size:10px; color:var(--ink-2); font-weight:600; font-family:var(--mono); text-transform:uppercase; letter-spacing:0.04em; }
.cg-gap{ margin-top:16px; }
.cg-gap-s{ margin-top:14px; }
.fgrid2{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.fgrid3{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
@media (max-width:760px){ .fgrid2, .fgrid3{ grid-template-columns:1fr; } }

.cg .finput, .cg .fselect{ height:44px; padding:0 13px; border-radius:11px; background:rgba(255,255,255,0.7); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); font-size:13.5px; color:var(--ink); width:100%; font-family:inherit; transition:border-color 150ms, box-shadow 150ms; }
.cg .finput::placeholder{ color:var(--ink-3); }
.cg .finput:focus, .cg .fselect:focus{ outline:none; border-color:rgba(107,95,255,0.55); box-shadow:0 0 0 3px rgba(107,95,255,0.16); }
.cg .finput.mono{ font-family:var(--mono); }
.cg .finput[aria-invalid="true"]{ border-color:rgba(201,53,69,0.55); }
.cg .fselect{ appearance:none; -webkit-appearance:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237681a0' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 12px center; padding-right:32px; cursor:pointer; }
.ferr{ font-size:11.5px; color:#a72c3a; font-weight:600; margin:4px 0 0; }

/* Menus con el punto de color adentro: categoria (var --gcat-dot de .cat-*)
   y tipo (.fv-dot de FijosVariables). El punto repite lo que dice el texto:
   el color nunca es la unica senal. */
.fsel-dot{ position:relative; }
.fsel-dot > i{ position:absolute; left:13px; top:50%; transform:translateY(-50%); width:9px; height:9px; border-radius:3px; margin:0; pointer-events:none; }
.fsel-dot > .cd{ background:var(--gcat-dot); }
.cg .fsel-dot .fselect{ padding-left:31px; }
.fv-dot.sin{ background:transparent; outline:1.5px dashed var(--ink-3); outline-offset:-1.5px; }
.fhint{ margin:7px 0 0; font-size:12px; color:var(--ink-2); line-height:1.45; }
.fhint.falta{ color:#8a520c; font-weight:600; }
.fnota{ height:44px; display:flex; align-items:center; padding:0 13px; border-radius:11px; font-size:12.5px; color:var(--ink-2); background:rgba(255,255,255,0.4); border:1px dashed rgba(13,20,36,0.14); }

/* La factura, plegada. La cabecera dice SIEMPRE si va a ARCA o al export. */
.cgfac{ margin-top:18px; border-radius:14px; border:1px solid rgba(255,255,255,0.85); background:rgba(255,255,255,0.45); }
.cgfac-head{ width:100%; display:flex; align-items:center; gap:12px; padding:13px 15px; background:none; border:none; cursor:pointer; text-align:left; font-family:inherit; border-radius:14px; }
.cgfac-head:focus-visible{ outline:2px solid var(--purple); outline-offset:-2px; }
.cgfac-dot{ width:10px; height:10px; border-radius:50%; flex:0 0 auto; }
.cgfac-dot.arca{ background:#1a8e5a; }
.cgfac-dot.manda{ background:#d98324; }
.cgfac-tx{ flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.cgfac-t{ font-size:13px; font-weight:700; color:var(--ink); }
.cgfac-s{ font-size:11.5px; color:var(--ink-2); }
.cgfac-cta{ font-size:12px; font-weight:700; color:#4b3fd6; white-space:nowrap; }
.cgfac-body{ padding:4px 15px 15px; border-top:1px solid rgba(13,20,36,0.07); }
.cgfac-body .fgrid2{ margin-top:12px; }
.cg-check{ margin-top:14px; }
/* Titulo arriba y explicacion abajo: en el ancho del formulario, los dos
   spans inline quedaban pegados en una sola linea. */
.cg .pm-check .t, .cg .pm-check .s{ display:block; }
.cg-nota{ font-size:11.5px; color:var(--ink-2); line-height:1.5; margin:8px 0 12px; }
.cg-link{ font:inherit; font-weight:700; color:#4b3fd6; text-decoration:underline; background:none; border:none; padding:0; cursor:pointer; }
.cg-link:disabled{ opacity:.5; cursor:not-allowed; }
.cg-link:focus-visible{ outline:2px solid var(--purple); outline-offset:2px; border-radius:3px; }
/* ── Compra de mercaderia (CompraMercaderia): articulos, impacto y "Coincide" ── */
.cm{ margin-top:18px; padding:16px; border-radius:14px; border:1px solid rgba(255,255,255,0.85); background:rgba(255,255,255,0.45); }
.cm-h{ margin:0 0 12px; }
.cm-t{ display:block; font-size:13px; font-weight:700; color:var(--ink); }
.cm-s{ display:block; font-size:11.5px; color:var(--ink-2); margin-top:3px; line-height:1.45; }
.cm-tab{ display:flex; flex-direction:column; margin:0 0 12px; }
.cm-th, .cm-fila{ display:grid; grid-template-columns:minmax(0,1fr) 76px 112px 112px 30px; gap:8px; align-items:center; }
.cm-th{ padding:0 0 6px; font-size:10px; font-family:var(--mono); text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-2); font-weight:600; }
.cm-th .r{ text-align:right; }
.cm-tr{ padding:9px 0; border-top:1px solid rgba(13,20,36,0.07); }
.cm-nom{ font-size:13px; font-weight:600; color:var(--ink-1); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cm-in{ height:36px; padding:0 10px; border-radius:9px; border:1px solid rgba(13,20,36,0.12); background:rgba(255,255,255,0.8); font-family:var(--mono); font-size:12.5px; text-align:right; color:var(--ink); width:100%; }
.cm-in:focus{ outline:none; border-color:rgba(107,95,255,0.55); box-shadow:0 0 0 3px rgba(107,95,255,0.16); }
.cm-sub{ font-family:var(--mono); font-size:12.5px; font-weight:600; text-align:right; color:var(--ink-1); font-variant-numeric:tabular-nums; }
.cm-x{ width:30px; height:30px; border:none; border-radius:8px; background:rgba(13,20,36,0.05); color:var(--ink-2); font-size:16px; cursor:pointer; }
.cm-x:hover{ background:rgba(192,56,74,0.12); color:#a72c3a; }
.cm-x:focus-visible{ outline:2px solid var(--purple); outline-offset:1px; }
.cm-imp{ display:flex; flex-wrap:wrap; gap:6px; margin-top:7px; }
.cm-chip{ font-size:11.5px; font-weight:600; padding:3px 9px; border-radius:7px; background:rgba(13,20,36,0.05); color:var(--ink-2); font-variant-numeric:tabular-nums; }
.cm-chip.mal{ background:rgba(239,93,106,0.10); color:#a72c3a; }
.cm-chip.bien{ background:rgba(52,199,125,0.12); color:#116b40; }
.cm-resumen{ margin:10px 0 0; font-size:12px; color:var(--ink-2); line-height:1.5; }
.cm-resumen b{ color:var(--ink); }
.cm-resumen b.cm-ojo{ color:#a72c3a; }
/* "Coincide": la tarjeta del mockup, alimentada por la MISMA cuenta que el boton. */
.cm-rec{ margin-top:12px; padding:12px 14px; border-radius:12px; border:1px solid rgba(255,255,255,0.85); background:rgba(255,255,255,0.6); }
.cm-rec.ok{ background:rgba(52,199,125,0.08); border-color:rgba(52,199,125,0.28); }
.cm-rec.mal{ background:rgba(239,93,106,0.07); border-color:rgba(239,93,106,0.28); }
.cm-rec-fila{ display:flex; justify-content:space-between; font-size:12.5px; color:var(--ink-2); padding:2px 0; }
.cm-rec-fila b{ font-family:var(--mono); font-weight:600; color:var(--ink-1); }
.cm-rec-res{ display:flex; justify-content:space-between; align-items:center; margin-top:6px; padding-top:8px; border-top:1px solid rgba(13,20,36,0.08); }
.cm-rec-k{ font-size:13px; font-weight:700; color:var(--ink-1); }
.cm-rec-res b{ font-family:var(--mono); font-size:15px; font-weight:700; color:var(--ink); }
.cm-rec.ok .cm-rec-k, .cm-rec.ok .cm-rec-res b{ color:#116b40; }
.cm-rec.mal .cm-rec-k, .cm-rec.mal .cm-rec-res b{ color:#a72c3a; }
.cm-rec-ayuda{ margin:8px 0 0; font-size:11.5px; color:var(--ink-2); line-height:1.45; }
@media (max-width:760px){ .cm-th{ display:none; } .cm-fila{ grid-template-columns:minmax(0,1fr) 64px 92px 30px; } .cm-sub{ display:none; } }

/* Comprobante adjunto. */
.gdrop{ display:flex; align-items:center; gap:14px; margin-top:18px; padding:15px 16px; border-radius:14px; border:1.5px dashed rgba(107,95,255,0.35); background:linear-gradient(135deg, rgba(107,95,255,0.05), rgba(91,140,255,0.04)); }
.gdrop.has{ border-style:solid; border-color:rgba(107,95,255,0.30); }
.gdrop-ic{ width:42px; height:42px; border-radius:12px; background:rgba(107,95,255,0.12); color:#5f53f5; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
.gdrop-tx{ flex:1; min-width:0; }
.gdrop-t{ font-size:13px; font-weight:700; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gdrop-s{ font-size:11.5px; color:var(--ink-2); margin-top:2px; }
.scan-btn{ display:inline-flex; align-items:center; gap:7px; min-height:38px; padding:10px 15px; border-radius:11px; font-size:12.5px; font-weight:600; color:var(--ink-1); background:rgba(255,255,255,0.72); border:1px solid rgba(255,255,255,0.9); box-shadow:var(--glass-hi); cursor:pointer; font-family:inherit; transition:transform 160ms; flex:0 0 auto; }
.scan-btn:hover{ transform:translateY(-1px); }
.scan-btn:focus-visible{ outline:2px solid var(--purple); outline-offset:2px; }

/* Impacto: en efectivo, la caja; a cuenta corriente, la deuda. */
.cimpact{ margin-top:16px; padding:13px 15px; border-radius:13px; border:1px solid rgba(255,255,255,0.8); background:rgba(255,255,255,0.5); }
.cimpact.efectivo{ background:rgba(52,199,125,0.07); border-color:rgba(52,199,125,0.22); }
.cimpact.efectivo.over{ background:rgba(239,93,106,0.07); border-color:rgba(239,93,106,0.25); }
.cimpact.deuda{ background:rgba(247,152,74,0.07); border-color:rgba(247,152,74,0.25); }
.ci-head{ display:flex; align-items:center; gap:8px; font-size:10.5px; font-weight:700; color:var(--ink-2); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:10px; }
.ci-head svg{ color:#5f53f5; flex:0 0 auto; }
.ci-row{ display:flex; align-items:center; justify-content:space-between; padding:4px 0; font-size:12.5px; color:var(--ink-2); }
.ci-row .mono{ font-family:var(--mono); font-weight:500; color:var(--ink-1); }
.ci-row .mono.neg{ color:#b42d3d; }
.ci-row.total{ margin-top:5px; padding-top:9px; border-top:1px solid rgba(13,20,36,0.08); font-weight:700; color:var(--ink); }
.ci-row.total .mono{ font-size:15px; font-weight:700; color:var(--ink); }
.ci-row.total .mono.neg{ color:#b42d3d; }
.ci-warn{ margin-top:8px; font-size:11.5px; color:#a72c3a; font-weight:600; }
.ci-pie{ margin-top:8px; font-size:11px; color:var(--ink-2); line-height:1.45; }
.ci-txt{ margin:0; font-size:12px; color:var(--ink-1); line-height:1.5; }
.ci-muted{ display:flex; align-items:center; gap:8px; font-size:12px; color:var(--ink-2); }
.ci-muted svg{ flex:0 0 auto; }

/* Registrado: confirmacion que no roba el foco (aria-live). */
.cg-ok{ display:flex; align-items:flex-start; gap:11px; margin-top:16px; padding:12px 14px; border-radius:13px; background:rgba(52,199,125,0.10); border:1px solid rgba(52,199,125,0.30); animation:cgEntra 220ms cubic-bezier(.2,.8,.2,1); }
.cg-ok-ic{ width:24px; height:24px; border-radius:8px; background:#1a8e5a; color:#fff; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
.cg-ok-tx{ flex:1; min-width:0; font-size:12.5px; color:var(--ink-1); line-height:1.5; }
.cg-ok-tx b{ color:var(--ink); }
.cg-ok-warn{ color:#8a520c; font-weight:600; }
.cg-ok .cg-link{ font-size:12.5px; white-space:nowrap; }
@keyframes cgEntra{ from{ opacity:0; transform:translateY(4px); } to{ opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce){ .cg-ok{ animation:none; } .reg-btn, .scan-btn{ transition:none; } }
.cg-err{ margin:14px 0 0; }
/* Posible duplicado: no es un error, es una pregunta. Ambar, como "hay que
   mandar": algo para mirar, no algo roto. */
.cg-duda{ margin-top:14px; padding:12px 14px; border-radius:13px; background:rgba(247,152,74,0.10); border:1px solid rgba(247,152,74,0.32); }
.cg-duda p{ margin:0 0 10px; font-size:12.5px; line-height:1.5; color:#7a4a0e; font-weight:600; }
.cg-duda-acts{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
.scan-btn.primary{ background:#5f53f5; color:#fff; border-color:transparent; box-shadow:0 5px 14px rgba(107,95,255,0.30); }

.reg-btn{ width:100%; margin-top:18px; min-height:48px; padding:14px; border-radius:14px; border:none; background:linear-gradient(140deg,#5f53f5,#6b5fff); color:#fff; font-size:14px; font-weight:700; font-family:inherit; box-shadow:0 7px 20px rgba(107,95,255,0.40); transition:transform 170ms, box-shadow 170ms; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; }
.reg-btn:hover:not(:disabled){ transform:translateY(-1px); box-shadow:0 10px 26px rgba(107,95,255,0.5); }
.reg-btn:active:not(:disabled){ transform:translateY(0); }
.reg-btn:focus-visible{ outline:3px solid rgba(107,95,255,0.45); outline-offset:3px; }
.reg-btn:disabled{ opacity:0.45; box-shadow:none; cursor:not-allowed; }
.cg-motivo{ margin:8px 0 0; text-align:center; font-size:11.5px; color:var(--ink-2); }

/* ── Columna derecha ── */
.cg-side{ display:flex; flex-direction:column; gap:15px; }
.cg-side .card{ padding:20px 22px; cursor:default; }
.cg-side .card:hover{ transform:none; }
.upper-mini{ font-size:10.5px; color:var(--ink-2); text-transform:uppercase; letter-spacing:0.08em; font-family:var(--mono); font-weight:500; }
.gbig{ font-family:var(--mono); font-size:30px; font-weight:700; letter-spacing:-0.02em; margin:4px 0 16px; color:var(--ink); font-variant-numeric:tabular-nums; }
.gsum{ display:flex; flex-direction:column; gap:13px; list-style:none; margin:0; padding:0; }
.gsum-head{ display:flex; align-items:center; gap:9px; font-size:12.5px; }
.gsdot{ width:9px; height:9px; border-radius:3px; flex:0 0 auto; background:var(--gcat-dot); }
.gsname{ color:var(--ink-1); font-weight:500; }
.gsval{ margin-left:auto; font-family:var(--mono); font-weight:600; color:var(--ink); font-variant-numeric:tabular-nums; }
.gsbar{ height:6px; border-radius:999px; background:rgba(13,20,36,0.06); margin-top:7px; overflow:hidden; }
.gsbar i{ display:block; height:100%; border-radius:999px; background:var(--gcat-dot); }
.cg-ult{ list-style:none; margin:0; padding:0; }
.gasto-row{ display:flex; align-items:center; gap:11px; padding:11px 0; border-top:1px solid rgba(13,20,36,0.05); }
.gasto-row:first-child{ border-top:none; }
.cg-ult .gcat{ width:auto; padding:4px 9px; white-space:nowrap; }
.gtxt{ flex:1; min-width:0; }
.gconcepto{ font-size:12.5px; font-weight:500; color:var(--ink-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gsub{ font-size:11px; color:var(--ink-2); margin-top:1px; }
.gmonto{ font-family:var(--mono); font-size:13.5px; font-weight:700; color:#b42d3d; flex:0 0 auto; font-variant-numeric:tabular-nums; }
.cg-vacio{ margin:0; font-size:12.5px; color:var(--ink-2); line-height:1.5; }

/* ── Oscuro ── */
/* RESET_CARD_POS deja el borde de .card:hover en blanco 0.85: en oscuro, toda
   tarjeta de /gastos se prendia con un marco blanco al pasar el mouse. Misma
   regla que ya tienen /contador y /productos, y va DESPUES del reset. */
html[data-theme="dark"] .card:hover{ border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .sec-h .n{ background:#5f53f5; }
html[data-theme="dark"] .cg .finput,
html[data-theme="dark"] .cg .fselect{ background-color:rgba(255,255,255,0.07); border-color:rgba(255,255,255,0.14); color:var(--ink); color-scheme:dark; }
html[data-theme="dark"] .ferr{ color:#ff8b96; }
html[data-theme="dark"] .fhint.falta{ color:#ffc79a; }
html[data-theme="dark"] .fnota{ background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.14); }
html[data-theme="dark"] .cgfac{ background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .cgfac-body{ border-top-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .cgfac-dot.arca{ background:#3fd68b; }
html[data-theme="dark"] .cgfac-dot.manda{ background:#ffb87a; }
html[data-theme="dark"] .cgfac-cta,
html[data-theme="dark"] .cg-link{ color:#b3c0ff; }
html[data-theme="dark"] .gdrop{ background:rgba(141,162,255,0.06); border-color:rgba(141,162,255,0.35); }
html[data-theme="dark"] .gdrop-ic{ background:rgba(141,162,255,0.14); color:#b3c0ff; }
html[data-theme="dark"] .scan-btn{ background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.14); color:var(--ink); }
html[data-theme="dark"] .cimpact{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .cimpact.efectivo{ background:rgba(63,214,139,0.08); border-color:rgba(63,214,139,0.24); }
html[data-theme="dark"] .cimpact.efectivo.over{ background:rgba(255,139,150,0.08); border-color:rgba(255,139,150,0.28); }
html[data-theme="dark"] .cimpact.deuda{ background:rgba(255,184,122,0.08); border-color:rgba(255,184,122,0.26); }
html[data-theme="dark"] .ci-head svg{ color:#b3c0ff; }
html[data-theme="dark"] .ci-row .mono.neg,
html[data-theme="dark"] .ci-row.total .mono.neg,
html[data-theme="dark"] .ci-warn{ color:#ff8b96; }
html[data-theme="dark"] .ci-row.total{ border-top-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .cg-ok{ background:rgba(63,214,139,0.10); border-color:rgba(63,214,139,0.28); }
html[data-theme="dark"] .cg-ok-ic{ background:#1f9e64; }
html[data-theme="dark"] .cg-ok-warn{ color:#ffc79a; }
html[data-theme="dark"] .reg-btn{ background:linear-gradient(140deg,#5f53f5,#6b5fff); }
html[data-theme="dark"] .gsbar{ background:rgba(255,255,255,0.08); }
html[data-theme="dark"] .gasto-row{ border-top-color:rgba(255,255,255,0.07); }
html[data-theme="dark"] .gmonto{ color:#ff8b96; }
html[data-theme="dark"] .cm{ background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .cm-tr{ border-top-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .cm-in{ background:rgba(255,255,255,0.07); border-color:rgba(255,255,255,0.14); color:var(--ink); color-scheme:dark; }
html[data-theme="dark"] .cm-x{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .cm-x:hover{ color:#ff8b96; }
html[data-theme="dark"] .cm-chip{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .cm-chip.mal{ background:rgba(255,139,150,0.12); color:#ff9aa4; }
html[data-theme="dark"] .cm-chip.bien{ background:rgba(63,214,139,0.12); color:#7fe0ae; }
html[data-theme="dark"] .cm-resumen b.cm-ojo{ color:#ff9aa4; }
html[data-theme="dark"] .cm-rec{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .cm-rec.ok{ background:rgba(63,214,139,0.08); border-color:rgba(63,214,139,0.26); }
html[data-theme="dark"] .cm-rec.mal{ background:rgba(255,139,150,0.08); border-color:rgba(255,139,150,0.28); }
html[data-theme="dark"] .cm-rec-res{ border-top-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .cm-rec.ok .cm-rec-k, html[data-theme="dark"] .cm-rec.ok .cm-rec-res b{ color:#7fe0ae; }
html[data-theme="dark"] .cm-rec.mal .cm-rec-k, html[data-theme="dark"] .cm-rec.mal .cm-rec-res b{ color:#ff9aa4; }
html[data-theme="dark"] .cg-duda{ background:rgba(255,184,122,0.08); border-color:rgba(255,184,122,0.28); }
html[data-theme="dark"] .cg-duda p{ color:#ffc79a; }
html[data-theme="dark"] .scan-btn.primary{ background:#5f53f5; color:#fff; }
`;
