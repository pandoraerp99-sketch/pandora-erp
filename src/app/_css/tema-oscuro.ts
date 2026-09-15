// Modo oscuro compartido por las pantallas de gestion (cielo nocturno).
//
// Nacio en clientesCss.ts y se saco de ahi sin cambiar un byte (se verifico con
// una huella sha256 del CSS armado). Despues se le agrego el arreglo de .cta,
// que aplica a todas las pantallas que lo usan. Cada pantalla define sus tokens claros en su propio
// :root; estos bloques van DESPUES en el mismo <style>, y html[data-theme="dark"]
// le gana a :root por especificidad.
//
// OSCURO_NUCLEO: tokens, fondo con estrellas, scrollbar, sidebar y topbar.
// OSCURO_GESTION: la barra de titulo (.bar) y la tira de KPIs (.kpis).
//
// OJO: son TEMPLATE LITERALS. Nada de backticks aca adentro.

export const OSCURO_NUCLEO = `
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
  animation:twinkle 6.5s ease-in-out infinite; }
@keyframes twinkle{ 0%,100%{opacity:0.82;} 50%{opacity:1;} }
@media (prefers-reduced-motion:reduce){ html[data-theme="dark"] .bg::after{ animation:none; } }

html[data-theme="dark"] ::-webkit-scrollbar-thumb{ background:rgba(255,255,255,0.16); }
html[data-theme="dark"] .main::-webkit-scrollbar-thumb{ background:rgba(255,255,255,0.16); }

/* sidebar */
html[data-theme="dark"] .logo-text{ background:linear-gradient(135deg,#eef2ff 0%,#aebde8 100%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
html[data-theme="dark"] .nav-item:hover{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .nav-item.active{ background:rgba(255,255,255,0.12); box-shadow:inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(3,7,20,0.3); }
html[data-theme="dark"] .cashier{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .afip{ background:rgba(52,199,125,0.1); border-color:rgba(52,199,125,0.22); }
html[data-theme="dark"] .afip-name{ color:#55dd9b; }
html[data-theme="dark"] .afip-sub{ color:#7fb79b; }

/* topbar */
html[data-theme="dark"] .seg button.on{ background:rgba(238,242,255,0.94); color:#0d1424; }
html[data-theme="dark"] .iconbtn .ndot{ border-color:rgba(11,17,42,0.9); }

/* Boton principal (.cta). En claro es un degradado de var(--purple) a
   var(--purple-2) con texto blanco; en oscuro esos tokens pasan a violetas
   CLAROS (#8da2ff / #bcc8ff) y el blanco quedaba en 2,05:1 (medido sobre
   pixeles en /productos, "Editar"). Se fija un violeta con blanco >= 4,5. */
html[data-theme="dark"] .cta{ background:linear-gradient(140deg,#5f53f5,#6b5fff); }
`;

export const OSCURO_GESTION = `
/* header bar + KPIs */
html[data-theme="dark"] .bar{ background:rgba(29,37,66,0.5); border-color:rgba(255,255,255,0.1); box-shadow:inset 0 1px 0 rgba(255,255,255,0.07), 0 10px 30px -14px rgba(3,7,20,0.6); }
html[data-theme="dark"] .bar-icon{ border-color:rgba(255,255,255,0.14); box-shadow:inset 0 1px 0 rgba(255,255,255,0.12); }
html[data-theme="dark"] .bar .b.ghost{ background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.12); box-shadow:inset 0 1px 0 rgba(255,255,255,0.08); }
html[data-theme="dark"] .bar .b.ghost:hover{ background:rgba(255,255,255,0.1); }
html[data-theme="dark"] .bar-sub .dot-live{ color:#55dd9b; }
html[data-theme="dark"] .kpis .k{ background:rgba(29,37,66,0.5); border-color:rgba(255,255,255,0.1); box-shadow:inset 0 1px 0 rgba(255,255,255,0.07), 0 8px 24px -14px rgba(3,7,20,0.6); }
html[data-theme="dark"] .kpis .up{ color:#55dd9b; }
html[data-theme="dark"] .kpis .k.warn .k-v{ color:#ffb87a; }
html[data-theme="dark"] .kpis .k.bad .k-v{ color:#ff8b96; }
html[data-theme="dark"] .kpis .tag.bad{ color:#ff8b96; }
html[data-theme="dark"] .kpis .tag.warn{ color:#ffb87a; }
`;
