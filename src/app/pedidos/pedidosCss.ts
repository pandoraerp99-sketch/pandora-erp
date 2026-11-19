/**
 * CSS de /pedidos — portado de pos-preview/pedidos.html (libro, KPIs,
 * filtros, tabla, detalle) y del formulario "Nuevo pedido señado" de
 * pos-preview/pedidos-senados.html. La maqueta es la autoridad visual: los
 * valores (tamaños, radios, sombras, colores) están copiados, no reinventados.
 *
 * Diferencias DELIBERADAS con la maqueta (ADR-0029 §Pantalla):
 *  - `.chips/.chip` se llaman `.po-chips/.po-chip`: `.chip` ya existe en el
 *    shell (global) y le hubiera colado estilos ajenos.
 *  - Lo que la maqueta no dibuja se resuelve con su mismo vocabulario: varias
 *    líneas en el alta (filas `.fld-row` + "Agregar ítem"), el modal de cobro
 *    (mismo `.modal`), el bloque de error (`.m-err`, rojo de `.po-est.cancelado`)
 *    y los botones de estado del detalle (`.m-btn.ghost`).
 *  - Colores de estado como CLASES y no inline: un color inline no tiene
 *    variante oscura (pasó dos veces, ver memoria "Días de stock").
 *
 * La maqueta sólo existe en claro. El oscuro sale de los tokens compartidos
 * (OSCURO_NUCLEO) y de las variantes de abajo, medidas sobre píxeles.
 *
 * OJO: template literal. Nada de backticks acá adentro.
 */
import { OSCURO_NUCLEO } from '../_css/tema-oscuro';

export const PEDIDOS_CSS = `
/* Tokens que la maqueta usa y el :root del shell no define (verificado
   2026-11-18: sin esto el ícono del encabezado y el punto de "Tomado"
   salían sin color). Valores de pedidos.html. En oscuro los redefine
   OSCURO_NUCLEO, que va después y gana por especificidad. */
:root{ --blue:#5b8cff; --orange:#f7984a; --pink:#ee6a8e; --teal:#0e8f9e; --rose:#d65db1; --mono:'JetBrains Mono',ui-monospace,monospace; }
/* La maqueta usa el interlineado del navegador (normal); la app hereda 1,5
   del reset de Tailwind y cada tarjeta y fila salía unos píxeles más alta.
   Medido contra pedidos.html a 1600×1000 el 2026-11-18. */
.po-page{ line-height:normal; }
.tnum{ font-variant-numeric:tabular-nums; }
.upper-mini{ font-size:10.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.08em; font-family:var(--mono); font-weight:500; }

/* HEADER */
.po-head{ display:flex; align-items:center; justify-content:space-between; padding:18px 24px; border-radius:20px; margin-bottom:16px; }
.po-head-l{ display:flex; align-items:center; gap:15px; }
.po-head-ic{ width:46px; height:46px; border-radius:14px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; color:#fff; background:linear-gradient(135deg,var(--purple),var(--blue)); box-shadow:0 6px 16px rgba(107,95,255,0.35); }
.po-head-ic svg{ width:22px; height:22px; }
.po-title{ font-size:23px; font-weight:700; letter-spacing:-0.03em; }
.po-sub{ font-size:12.5px; color:var(--ink-2); margin-top:2px; }
.po-sub b{ color:var(--purple); }
.po-new{ display:inline-flex; align-items:center; gap:8px; padding:11px 18px; border-radius:13px; background:linear-gradient(140deg,var(--purple),var(--purple-2)); color:#fff; font-size:13.5px; font-weight:700; box-shadow:0 7px 20px rgba(107,95,255,0.42); transition:all 170ms; }
.po-new:hover{ transform:translateY(-1px); box-shadow:0 10px 26px rgba(107,95,255,0.52); }
.po-new:focus-visible, .m-btn:focus-visible, .po-chip:focus-visible, .po-dd-btn:focus-visible{ outline:2px solid var(--purple); outline-offset:2px; }
.po-new svg{ width:16px; height:16px; }

/* KPIs */
.po-kpis{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:16px; }
.po-kpi{ padding:16px 18px; border-radius:16px; position:relative; overflow:hidden; }
.po-kpi .v{ font-size:24px; font-weight:700; letter-spacing:-0.02em; margin-top:6px; }
.po-kpi .v.violeta{ color:var(--purple); }
.po-kpi .v.verde{ color:#1a8e5a; }
.po-kpi .foot{ font-size:11px; color:var(--ink-3); margin-top:3px; }
.po-kpi .spark{ position:absolute; right:14px; bottom:14px; opacity:.9; }

/* CONTROLES (filtros) */
.po-controls{ position:relative; z-index:30; display:flex; align-items:center; gap:10px; padding:11px 14px; border-radius:16px; margin-bottom:14px; flex-wrap:wrap; }
.po-chips{ display:inline-flex; align-items:center; gap:3px; padding:4px; border-radius:12px; background:rgba(13,20,36,0.04); }
.po-chip{ font-size:12px; font-weight:600; color:var(--ink-2); background:transparent; padding:7px 12px; border-radius:9px; transition:all 120ms; cursor:pointer; }
.po-chip.on{ background:var(--ink); color:#fff; }
.po-chip .c{ display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:6px; vertical-align:middle; }
.po-chip .c.violeta{ background:var(--purple); } .po-chip .c.verde{ background:var(--green); } .po-chip .c.gris{ background:var(--ink-4); } .po-chip .c.rojo{ background:var(--red); }
.po-dd{ position:relative; }
.po-dd-btn{ display:inline-flex; align-items:center; gap:8px; height:36px; padding:0 13px; border-radius:11px; background:#fff; border:1px solid rgba(13,20,36,0.1); font-size:12.5px; font-weight:600; color:var(--ink-1); }
.po-dd-btn .who{ display:inline-flex; align-items:center; gap:6px; }
.po-dd-btn svg{ width:13px; height:13px; color:var(--ink-3); transition:transform 160ms; }
.po-dd.open .po-dd-btn svg.chev{ transform:rotate(180deg); }
.po-dd-menu{ position:absolute; top:calc(100% + 6px); left:0; min-width:210px; z-index:40; display:none; flex-direction:column; padding:6px; border-radius:14px; background:rgba(255,255,255,0.93); backdrop-filter:blur(28px) saturate(150%); -webkit-backdrop-filter:blur(28px) saturate(150%); border:var(--glass-bd); box-shadow:0 16px 44px rgba(20,26,44,0.22); }
.po-dd.open .po-dd-menu{ display:flex; }
.po-dd-item{ display:flex; align-items:center; gap:9px; text-align:left; font-size:12.5px; font-weight:500; color:var(--ink-1); padding:8px 10px; border-radius:9px; }
.po-dd-item:hover{ background:rgba(255,255,255,0.6); }
.po-dd-item.on{ background:rgba(107,95,255,0.12); color:var(--purple); font-weight:700; }
.tk{ width:24px; height:24px; border-radius:7px; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-size:10px; font-weight:700; flex:0 0 auto; }
.tk.c0{ background:linear-gradient(135deg,#6b5fff,#5b8cff); } .tk.c1{ background:linear-gradient(135deg,#f7984a,#ee6a8e); } .tk.c2{ background:linear-gradient(135deg,#0e8f9e,#34c77d); } .tk.all{ background:linear-gradient(135deg,#7681a0,#a8b0c5); }
.po-view{ margin-left:auto; display:inline-flex; gap:3px; padding:4px; border-radius:11px; background:rgba(13,20,36,0.04); }
.po-view button{ font-size:12px; font-weight:600; color:var(--ink-2); padding:6px 12px; border-radius:8px; display:inline-flex; align-items:center; gap:6px; }
.po-view button.on{ background:#fff; color:var(--ink); box-shadow:0 1px 3px rgba(13,20,36,0.1); }
.po-view svg{ width:13px; height:13px; }

/* TABLA */
.po-card{ padding:6px 6px 10px; border-radius:20px; }
.po-cardhead{ display:flex; align-items:center; justify-content:space-between; padding:13px 16px 11px; }
.po-cardhead h3{ font-size:14px; font-weight:600; display:flex; align-items:center; gap:8px; }
.po-count{ font-size:12px; color:var(--ink-3); font-weight:500; }
.po-table{ width:100%; border-collapse:collapse; }
.po-table th{ text-align:left; font-size:9.5px; text-transform:uppercase; letter-spacing:0.06em; font-family:var(--mono); color:var(--ink-3); font-weight:600; padding:0 14px 9px; }
.po-table th.r, .po-table td.r{ text-align:right; }
.po-table td{ padding:11px 14px; border-top:1px solid rgba(13,20,36,0.05); font-size:13px; vertical-align:middle; }
.po-row{ cursor:pointer; transition:background 120ms; }
.po-row:hover{ background:rgba(255,255,255,0.5); }
.po-row:focus-visible{ outline:2px solid var(--purple); outline-offset:-2px; }
.po-num{ font-family:var(--mono); font-size:12px; font-weight:600; color:var(--ink-3); }
.po-date{ font-family:var(--mono); font-size:12px; color:var(--ink-2); }
.po-cli{ display:flex; align-items:center; gap:10px; }
.po-av{ width:30px; height:30px; border-radius:9px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px; font-weight:700; }
.po-av.c0{ background:linear-gradient(135deg,#6b5fff,#9088ff); } .po-av.c1{ background:linear-gradient(135deg,#f7984a,#ee6a8e); } .po-av.c2{ background:linear-gradient(135deg,#0e8f9e,#34c77d); } .po-av.c3{ background:linear-gradient(135deg,#5b8cff,#0e8f9e); } .po-av.c4{ background:linear-gradient(135deg,#d65db1,#ee6a8e); } .po-av.c5{ background:linear-gradient(135deg,#7681a0,#a8b0c5); }
.po-cli-n{ font-weight:600; font-size:13px; white-space:nowrap; }
.po-det{ color:var(--ink-2); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.po-est{ display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:700; padding:4px 10px; border-radius:7px; white-space:nowrap; }
.po-est .d{ width:6px; height:6px; border-radius:50%; }
.po-est.tomado{ background:rgba(91,140,255,0.13); color:#3b6fd4; } .po-est.tomado .d{ background:var(--blue); }
.po-est.prep{ background:rgba(107,95,255,0.12); color:var(--purple); } .po-est.prep .d{ background:var(--purple); }
.po-est.listo{ background:rgba(52,199,125,0.14); color:#1a8e5a; } .po-est.listo .d{ background:var(--green); }
.po-est.entregado{ background:rgba(13,20,36,0.05); color:var(--ink-3); } .po-est.entregado .d{ background:var(--ink-4); }
.po-est.cancelado{ background:rgba(239,93,106,0.12); color:#c93545; } .po-est.cancelado .d{ background:var(--red); }
.po-sena{ display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; }
.po-sena.si{ color:#1a8e5a; } .po-sena.si b{ font-family:var(--mono); }
.po-sena.no{ color:var(--ink-4); }
.po-tot{ font-family:var(--mono); font-weight:700; font-size:13px; }
.po-ent{ font-family:var(--mono); font-size:12px; color:var(--ink-2); }
.po-ent.over{ color:#c93545; font-weight:700; }
.po-ent.hoy{ color:#1a8e5a; font-weight:700; }
.po-tomo{ display:inline-flex; align-items:center; gap:7px; }
.po-tomo .nm{ font-size:12px; color:var(--ink-2); }
/* group header row (por día) */
.po-daygroup td{ padding:16px 14px 7px; border-top:none; }
.po-dg{ display:flex; align-items:center; gap:12px; }
.po-dg .lbl{ font-size:12.5px; font-weight:700; color:var(--ink-1); white-space:nowrap; }
.po-dg .lbl.hoy{ color:var(--purple); }
.po-dg .meta{ font-size:11px; color:var(--ink-3); font-family:var(--mono); white-space:nowrap; }
.po-dg .line{ flex:1; height:1px; background:rgba(13,20,36,0.07); }
.po-empty{ padding:40px; text-align:center; color:var(--ink-3); font-size:13px; }

/* saldo + exportar + columnas + toast */
.po-saldo{ font-family:var(--mono); font-weight:700; font-size:12.5px; }
.po-saldo.pend{ color:var(--ink); } .po-saldo.ok{ color:#1a8e5a; } .po-saldo.na{ color:var(--ink-4); }
.po-hcs{ display:flex; align-items:center; gap:8px; }
.po-exp{ position:relative; }
.po-exp-btn, .po-cols-btn{ display:inline-flex; align-items:center; gap:7px; height:34px; padding:0 13px; border-radius:10px; background:rgba(255,255,255,0.66); border:1px solid rgba(255,255,255,0.9); font-size:12.5px; font-weight:600; color:var(--ink-1); box-shadow:var(--glass-hi); }
.po-exp-btn svg, .po-cols-btn svg{ width:14px; height:14px; color:var(--ink-3); }
.po-exp-menu, .po-cols-menu{ position:absolute; top:calc(100% + 6px); right:0; min-width:190px; z-index:40; display:none; flex-direction:column; padding:6px; border-radius:13px; background:rgba(255,255,255,0.93); backdrop-filter:blur(28px) saturate(150%); -webkit-backdrop-filter:blur(28px) saturate(150%); border:var(--glass-bd); box-shadow:0 16px 44px rgba(20,26,44,0.22); }
.po-exp.open .po-exp-menu, .po-cols.open .po-cols-menu{ display:flex; }
.po-exp-menu button, .po-cols-menu button{ display:flex; align-items:center; gap:9px; text-align:left; font-size:12.5px; font-weight:500; color:var(--ink-1); padding:8px 10px; border-radius:9px; }
.po-exp-menu button:hover, .po-cols-menu button:hover{ background:rgba(255,255,255,0.6); }
.po-exp-menu button svg{ width:15px; height:15px; color:var(--ink-3); }
.po-cols{ position:relative; }
.po-chk{ width:16px; height:16px; border-radius:5px; border:1.5px solid var(--ink-4); display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; }
.po-chk svg{ width:10px; height:10px; color:#fff; opacity:0; }
.po-cols-menu button.on .po-chk{ background:var(--purple); border-color:var(--purple); } .po-cols-menu button.on .po-chk svg{ opacity:1; }
/* ocultar columnas por posición (2 Fecha · 8 Saldo · 9 Entrega · 10 Tomó) */
.po-table.h-fecha th:nth-child(2), .po-table.h-fecha td:nth-child(2){ display:none; }
.po-table.h-saldo th:nth-child(8), .po-table.h-saldo td:nth-child(8){ display:none; }
.po-table.h-entrega th:nth-child(9), .po-table.h-entrega td:nth-child(9){ display:none; }
.po-table.h-tomo th:nth-child(10), .po-table.h-tomo td:nth-child(10){ display:none; }
.po-toast{ position:fixed; bottom:26px; left:50%; transform:translateX(-50%) translateY(10px); z-index:200; display:flex; align-items:center; gap:9px; padding:12px 18px; border-radius:13px; background:var(--ink); color:#fff; font-size:13px; font-weight:600; box-shadow:0 12px 34px rgba(13,20,36,0.3); opacity:0; pointer-events:none; transition:all 220ms; }
.po-toast.show{ opacity:1; transform:translateX(-50%) translateY(0); }
.po-toast svg{ width:16px; height:16px; color:#5bd39a; }

/* modal */
.modal-ov{ position:fixed; inset:0; z-index:100; background:rgba(20,26,44,0.42); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; padding:24px; }
.modal{ width:100%; max-width:520px; max-height:88vh; overflow-y:auto; background:var(--glass-bg-2); backdrop-filter:blur(32px) saturate(150%); -webkit-backdrop-filter:blur(32px) saturate(150%); border:var(--glass-bd); border-radius:22px; box-shadow:0 24px 70px rgba(20,26,44,0.35); padding:24px; animation:mIn 220ms cubic-bezier(.16,1,.3,1); }
.modal.ancho{ max-width:620px; }
@keyframes mIn{ from{ opacity:0; transform:translateY(16px) scale(.98); } }
.m-head{ display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px; }
.m-title{ font-size:19px; font-weight:700; letter-spacing:-0.02em; }
.m-sub{ font-size:12.5px; color:var(--ink-3); margin-top:2px; }
.m-x{ width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; color:var(--ink-2); background:rgba(13,20,36,0.05); flex:0 0 auto; }
.m-x svg{ width:16px; height:16px; }
.d-sec{ font-size:11px; text-transform:uppercase; letter-spacing:0.05em; font-family:var(--mono); font-weight:600; color:var(--ink-3); margin:16px 0 8px; }
.d-item{ display:flex; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid rgba(13,20,36,0.06); font-size:13px; } .d-item:first-child{ border-top:none; }
.d-item .q{ color:var(--ink-3); font-size:11.5px; } .d-item .a{ font-family:var(--mono); font-weight:600; white-space:nowrap; }
.d-item.total{ font-weight:700; } .d-item.total .a{ font-weight:700; }
.d-tl{ display:flex; flex-direction:column; gap:10px; }
.d-tl .row{ display:flex; align-items:center; gap:11px; font-size:12.5px; }
.d-tl .row.pend{ opacity:.5; }
.d-tl .row b{ color:var(--purple); margin-left:4px; }
.d-tl .dot{ width:10px; height:10px; border-radius:50%; flex:0 0 auto; background:rgba(13,20,36,0.15); }
.d-tl .dot.ok{ background:var(--green); } .d-tl .dot.no{ background:var(--red); }
.d-tl .row .dt{ margin-left:auto; font-family:var(--mono); font-size:11px; color:var(--ink-3); }
.d-pay{ display:flex; align-items:center; gap:10px; padding:9px 0; border-top:1px solid rgba(13,20,36,0.06); font-size:12.5px; } .d-pay:first-child{ border-top:none; }
.d-pay.pend{ opacity:.55; }
.d-pay .pd{ width:8px; height:8px; border-radius:50%; background:var(--green); flex:0 0 auto; }
.d-pay.pend .pd{ background:var(--ink-4); }
.d-pay .t{ font-weight:600; } .d-pay .s{ font-size:10.5px; color:var(--ink-3); }
.d-pay .amt{ margin-left:auto; font-family:var(--mono); font-weight:700; }
.m-summary{ display:flex; gap:16px; padding:14px; border-radius:12px; background:rgba(255,255,255,0.6); border:1px solid rgba(255,255,255,0.85); margin:14px 0 16px; }
.m-summary .s-cell{ flex:1; } .m-summary .s-k{ font-size:10.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.05em; } .m-summary .s-v{ font-size:17px; font-weight:700; margin-top:3px; }
.m-summary .s-v.chico{ font-size:14px; } .m-summary .s-v.verde{ color:#1a8e5a; }
.m-summary .s-v.e-tomado{ color:var(--blue); } .m-summary .s-v.e-prep{ color:var(--purple); } .m-summary .s-v.e-listo{ color:var(--green); } .m-summary .s-v.e-entregado{ color:var(--ink-3); } .m-summary .s-v.e-cancelado{ color:var(--red); }
.m-acts{ display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }
.m-acts .izq{ margin-right:auto; display:flex; gap:8px; flex-wrap:wrap; }
.m-btn{ font-size:13px; font-weight:600; padding:10px 17px; border-radius:11px; }
.m-btn.ghost{ color:var(--ink-2); background:rgba(13,20,36,0.05); }
.m-btn.peligro{ color:#c93545; background:rgba(239,93,106,0.10); }
.m-btn.primary{ color:#fff; background:linear-gradient(140deg,var(--purple),var(--purple-2)); box-shadow:0 6px 16px rgba(107,95,255,0.4); }
.m-btn:disabled{ opacity:.5; cursor:not-allowed; }
.m-err{ margin:0 0 14px; padding:11px 13px; border-radius:11px; background:rgba(239,93,106,0.10); border:1px solid rgba(239,93,106,0.25); color:#c93545; font-size:12.5px; font-weight:600; }
.m-aviso{ margin:0 0 14px; padding:11px 13px; border-radius:11px; background:rgba(247,152,74,0.10); border:1px solid rgba(247,152,74,0.28); color:#9a5512; font-size:12px; font-weight:600; }

/* formulario (pedidos-senados.html · Nuevo pedido señado) */
.fld{ margin-bottom:14px; } .fld label{ display:block; font-size:11.5px; font-weight:600; color:var(--ink-2); margin-bottom:6px; }
.fld input, .fld select{ width:100%; font-size:13.5px; background:#fff; border:1px solid rgba(13,20,36,0.12); border-radius:10px; padding:10px 12px; outline:none; font-family:inherit; box-sizing:border-box; color:var(--ink); }
.fld input:focus, .fld select:focus{ border-color:var(--purple); }
.fld-row{ display:flex; gap:10px; } .fld-row .fld{ flex:1; }
.fld-row .fld.desc{ flex:2.4; } .fld-row .fld.chico{ flex:0.8; }
.fld-row .quitar{ align-self:flex-end; margin-bottom:14px; width:38px; height:40px; flex:0 0 auto; border-radius:10px; display:flex; align-items:center; justify-content:center; color:var(--ink-3); background:rgba(13,20,36,0.05); }
.fld-row .quitar:hover{ color:#c93545; background:rgba(239,93,106,0.10); }
.fld-row .quitar svg{ width:15px; height:15px; }
.fld-row .quitar.ocupa{ visibility:hidden; }
.m-add{ display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; color:var(--purple); padding:4px 2px; margin:-4px 0 14px; }
.m-add svg{ width:14px; height:14px; }
.m-toggle{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border-radius:12px; background:rgba(107,95,255,0.06); border:1px solid rgba(107,95,255,0.15); margin-bottom:14px; }
.m-toggle .t{ font-size:12.5px; font-weight:600; } .m-toggle .s{ font-size:11px; color:var(--ink-3); margin-top:1px; }
.sw{ width:42px; height:24px; border-radius:999px; background:rgba(13,20,36,0.18); position:relative; flex:0 0 auto; transition:background 160ms; cursor:pointer; }
.sw::after{ content:''; position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.2); transition:transform 160ms; }
.sw.on{ background:var(--green); } .sw.on::after{ transform:translateX(18px); }
.sw:focus-visible{ outline:2px solid var(--purple); outline-offset:2px; }
.m-summary.form{ margin:4px 0 16px; }

@media (prefers-reduced-motion:reduce){ .modal{ animation:none; } .po-toast{ transition:none; } }

/* Impresión del libro: sólo la tabla. */
@media print{
  .sidebar, .topbar, .po-head, .po-kpis, .po-controls, .po-hcs, .po-toast{ display:none !important; }
  .po-card{ box-shadow:none !important; background:#fff !important; }
}
` + OSCURO_NUCLEO + `
/* ═════════ Pedidos en oscuro ═════════
   La maqueta es sólo clara. Todo lo que en claro es blanco opaco o un tono
   oscuro fijo (#1a8e5a, #c93545, #3b6fd4) se reemplaza: sobre el cielo
   nocturno quedaría ilegible o como una placa blanca. */
html[data-theme="dark"] .po-new{ background:linear-gradient(140deg,#5f53f5,#6b5fff); }
/* El ícono es blanco: sobre los violetas CLAROS del oscuro quedaba lavado. */
html[data-theme="dark"] .po-head-ic{ background:linear-gradient(135deg,#5f53f5,#4f7bff); }
/* Medido sobre píxeles 2026-11-18: "Sin seña" daba 2,73:1 y el pie de los
   KPIs 4,42:1 con los tokens del tema. Este tono da más de 4,5:1. */
html[data-theme="dark"] .po-sena.no,
html[data-theme="dark"] .po-kpi .foot{ color:#8592b8; }
html[data-theme="dark"] .po-kpi .v.verde,
html[data-theme="dark"] .po-sena.si,
html[data-theme="dark"] .po-saldo.ok,
html[data-theme="dark"] .po-ent.hoy,
html[data-theme="dark"] .m-summary .s-v.verde{ color:#7fe0ae; }
html[data-theme="dark"] .po-ent.over{ color:#ff8b96; }
html[data-theme="dark"] .po-chips,
html[data-theme="dark"] .po-view{ background:rgba(255,255,255,0.06); }
html[data-theme="dark"] .po-chip.on{ background:rgba(238,242,255,0.94); color:#0d1424; }
html[data-theme="dark"] .po-view button.on{ background:rgba(238,242,255,0.94); color:#0d1424; }
html[data-theme="dark"] .po-dd-btn{ background:rgba(255,255,255,0.07); border-color:rgba(255,255,255,0.14); }
html[data-theme="dark"] .po-exp-btn,
html[data-theme="dark"] .po-cols-btn{ background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .po-dd-menu,
html[data-theme="dark"] .po-exp-menu,
html[data-theme="dark"] .po-cols-menu{ background:rgba(29,37,66,0.96); }
html[data-theme="dark"] .po-dd-item:hover,
html[data-theme="dark"] .po-exp-menu button:hover,
html[data-theme="dark"] .po-cols-menu button:hover{ background:rgba(255,255,255,0.08); }
html[data-theme="dark"] .po-dd-item.on{ background:rgba(141,162,255,0.16); }
html[data-theme="dark"] .po-row:hover{ background:rgba(255,255,255,0.05); }
html[data-theme="dark"] .po-table td{ border-top-color:rgba(255,255,255,0.07); }
html[data-theme="dark"] .po-dg .line{ background:rgba(255,255,255,0.08); }
html[data-theme="dark"] .po-num{ color:var(--ink-2); }
html[data-theme="dark"] .po-est.tomado{ background:rgba(111,168,255,0.16); color:#9dbcff; }
html[data-theme="dark"] .po-est.prep{ background:rgba(141,162,255,0.16); }
html[data-theme="dark"] .po-est.listo{ background:rgba(63,214,139,0.15); color:#7fe0ae; }
html[data-theme="dark"] .po-est.entregado{ background:rgba(255,255,255,0.07); color:var(--ink-2); }
html[data-theme="dark"] .po-est.cancelado{ background:rgba(255,139,150,0.14); color:#ff8b96; }
html[data-theme="dark"] .po-toast{ background:#eef2ff; color:#0d1424; }
html[data-theme="dark"] .po-toast svg{ color:#1a8e5a; }
html[data-theme="dark"] .m-x,
html[data-theme="dark"] .m-btn.ghost,
html[data-theme="dark"] .fld-row .quitar{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .m-btn.peligro{ color:#ff8b96; background:rgba(255,139,150,0.12); }
html[data-theme="dark"] .m-btn.primary{ background:linear-gradient(140deg,#5f53f5,#6b5fff); }
html[data-theme="dark"] .m-summary{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .d-item,
html[data-theme="dark"] .d-pay{ border-top-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .d-tl .dot{ background:rgba(255,255,255,0.18); }
html[data-theme="dark"] .d-tl .dot.ok{ background:var(--green); }
html[data-theme="dark"] .d-tl .dot.no{ background:var(--red); }
html[data-theme="dark"] .fld input,
html[data-theme="dark"] .fld select{ background:rgba(255,255,255,0.07); border-color:rgba(255,255,255,0.14); color:var(--ink); color-scheme:dark; }
html[data-theme="dark"] .m-err{ color:#ff8b96; background:rgba(255,139,150,0.10); border-color:rgba(255,139,150,0.25); }
html[data-theme="dark"] .m-aviso{ color:#ffc79a; background:rgba(255,184,122,0.10); border-color:rgba(255,184,122,0.25); }
html[data-theme="dark"] .m-toggle{ background:rgba(141,162,255,0.08); border-color:rgba(141,162,255,0.2); }
html[data-theme="dark"] .sw{ background:rgba(255,255,255,0.2); }
`;
