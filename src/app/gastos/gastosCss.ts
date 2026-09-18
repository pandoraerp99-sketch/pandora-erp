// CSS de Gastos.
//
// ── POR QUE ESTE ARCHIVO NO COPIA UNA MAQUETA ─────────────────────────────
// Gastos es la primera pantalla que NO nace de `pos-preview/`: nace del pedido
// real de la contadora (ver EVIDENCIA-pedido-contadora-2026-09.md). No hay
// maqueta que copiar.
//
// Entonces se hace lo mismo que se hizo con el modal de cobro de Clientes: se
// COMPONE con el vocabulario que ya existe, en vez de inventar uno nuevo. La
// base es la de Clientes — que es la pantalla de gestion mas cercana: barra de
// titulo, tira de KPIs, lista con encabezado de columnas, modal — y abajo va
// una cola corta SOLO con lo que Gastos tiene y Clientes no.
//
// Verificar con: node scripts/comparar-con-maqueta.mjs (comparando /gastos
// contra /clientes, que comparten esta base: si .bar, .kpis, .clrow o .pmod no
// computan igual, algo se filtro).
//
// OJO: esto es UN TEMPLATE LITERAL. Nada de backticks aca adentro.
import { CLIENTES_CSS } from '../clientes/clientesCss';

export const GASTOS_CSS =
  CLIENTES_CSS +
  `
/* ═══════════════════ GASTOS · lo propio de esta pantalla ═══════════════════ */

/* Marca de si el gasto lo baja el estudio de ARCA o hay que mandarlo.
   NO usa el rojo de .cc: "fuera de ARCA" no es un error ni una deuda, es una
   tarea. Va en ambar, el mismo tono que .kpis .warn. */
.gflag{ width:126px; box-sizing:border-box; text-align:center; font-size:10px; font-weight:700; padding:5px 0; border-radius:8px; flex:0 0 auto; letter-spacing:0.01em; }
/* Un escalon mas oscuros que #1a8e5a / #b9701c, que son los del sistema
   (.cc.ok en Clientes, .kpis .tag.warn). Medidos sobre el fondo compuesto
   daban 3.28 y 3.03 de contraste con texto de 10px en negrita: por debajo del
   4.5 de WCAG AA. "Hay que mandar" es JUSTO la marca que sostiene esta
   pantalla — que sea la menos legible seria el peor lugar para ahorrar. Se
   diverge del token a proposito; ser consistente con un valor inaccesible no
   es una razon para copiarlo. */
.gflag.arca{ background:rgba(52,199,125,0.13); color:#116b40; }
.gflag.manda{ background:rgba(247,152,74,0.16); color:#8a520c; }
html[data-theme="dark"] .gflag.arca{ background:rgba(63,214,139,0.16); color:#7fe0ae; }
html[data-theme="dark"] .gflag.manda{ background:rgba(255,184,122,0.16); color:#ffc79a; }

/* Columna de importe del gasto: mismo ancho y tipografia que .clcompras. */
.gtotal{ width:104px; text-align:right; font-family:var(--mono); font-weight:700; font-size:13px; color:var(--ink); flex:0 0 auto; }
.gmedio{ width:96px; font-size:11.5px; color:var(--ink-3); flex:0 0 auto; }
.gfecha{ width:78px; font-size:12px; color:var(--ink-3); font-family:var(--mono); flex:0 0 auto; }

/* ── COLOR POR CATEGORIA ───────────────────────────────────────────────────
   Cada categoria define TRES variables y las consumen la pill de la fila y el
   punto del panel derecho. Asi el color se declara una sola vez por categoria
   y por tema.

   La primera version ponia el color inline (style={{color: ...}}) con el hex
   del tema CLARO. Medido en oscuro: texto oscuro sobre fondo oscuro, las siete
   pills ilegibles. Un color inline no puede tener variante de tema — por eso
   esto es CSS y no un objeto en el TSX.

   Ninguna categoria usa verde, ambar ni rojo: esos tres ya SIGNIFICAN algo en
   esta pantalla (ya-en-ARCA / hay-que-mandar / error). Una categoria pintada
   de verde al lado de la marca verde se lee como si dijeran lo mismo. */
/* .gcat NO se apoya en .pill, aunque tenga su misma geometria. Clientes tiene
   'html[data-theme="dark"] .pill{ color:#dbe2f7 !important }' — aplana TODAS
   las pills a un solo color en oscuro, que es como resolvieron alli el mismo
   problema. Ese !important le ganaba a --gcat-fg y dejaba las siete categorias
   del mismo color (medido). Con clase propia, cada tema tiene su color. */
.gcat{ font-size:10.5px; font-weight:700; padding:4px 10px; border-radius:7px;
       width:118px; box-sizing:border-box; text-align:center; flex:0 0 auto;
       color:var(--gcat-fg); background:var(--gcat-bg); }
.gcatdot{ background:var(--gcat-dot); }

/* Los tonos de texto del tema claro son un escalon MAS OSCUROS que el token
   del sistema (--purple, --teal, etc). No es capricho: medido sobre el fondo
   compuesto de la pill, el token puro da 3.5-4.4 de contraste, y estas pills
   son de 10.5px en negrita — texto chico, que segun WCAG AA necesita 4.5. El
   token se conserva para el PUNTO del panel derecho (--gcat-dot), donde no hay
   texto y el color puede ser el vivo. */
.cat-alquiler        { --gcat-fg:#453ab8; --gcat-bg:rgba(107,95,255,0.13);  --gcat-dot:#6b5fff; }
.cat-mercaderia      { --gcat-fg:#0a5b64; --gcat-bg:rgba(14,143,158,0.13);  --gcat-dot:#0e8f9e; }
.cat-servicios       { --gcat-fg:#2c52aa; --gcat-bg:rgba(91,140,255,0.14);  --gcat-dot:#5b8cff; }
.cat-seguros         { --gcat-fg:#544aa6; --gcat-bg:rgba(144,136,255,0.17); --gcat-dot:#9088ff; }
.cat-impuestos_y_tasas{--gcat-fg:#8f3252; --gcat-bg:rgba(238,106,142,0.14); --gcat-dot:#ee6a8e; }
.cat-honorarios      { --gcat-fg:#4a5570; --gcat-bg:rgba(74,85,112,0.11);   --gcat-dot:#4a5570; }
.cat-otros           { --gcat-fg:#555d75; --gcat-bg:rgba(122,130,155,0.12); --gcat-dot:#a8b0c5; }

html[data-theme="dark"] .cat-alquiler        { --gcat-fg:#b3aaff; --gcat-bg:rgba(141,162,255,0.16); --gcat-dot:#8da2ff; }
html[data-theme="dark"] .cat-mercaderia      { --gcat-fg:#7fd8e6; --gcat-bg:rgba(95,200,255,0.15);  --gcat-dot:#5fc8ff; }
html[data-theme="dark"] .cat-servicios       { --gcat-fg:#9dbcff; --gcat-bg:rgba(111,168,255,0.16); --gcat-dot:#6fa8ff; }
html[data-theme="dark"] .cat-seguros         { --gcat-fg:#c4bcff; --gcat-bg:rgba(188,200,255,0.15); --gcat-dot:#bcc8ff; }
html[data-theme="dark"] .cat-impuestos_y_tasas{--gcat-fg:#f4a8c2; --gcat-bg:rgba(244,143,181,0.16); --gcat-dot:#f48fb5; }
html[data-theme="dark"] .cat-honorarios      { --gcat-fg:#b6c0da; --gcat-bg:rgba(255,255,255,0.09); --gcat-dot:#9aa6cc; }
html[data-theme="dark"] .cat-otros           { --gcat-fg:#98a2be; --gcat-bg:rgba(255,255,255,0.07); --gcat-dot:#7581a8; }

/* Totales por categoria (columna derecha). */
.gcatrow{ display:flex; align-items:center; gap:10px; padding:9px 0; border-top:1px solid rgba(13,20,36,0.05); }
.gcatrow:first-child{ border-top:none; }
.gcatdot{ width:9px; height:9px; border-radius:3px; flex:0 0 auto; }
.gcatname{ flex:1; min-width:0; font-size:12.5px; color:var(--ink-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gcatn{ font-size:10.5px; color:var(--ink-4); font-family:var(--mono); flex:0 0 auto; }
.gcatv{ font-family:var(--mono); font-weight:700; font-size:12.5px; color:var(--ink); flex:0 0 auto; }

/* Por proveedor (item 9 de la carta): razon social, CUIT e importe. */
.gprov{ display:flex; align-items:center; gap:10px; padding:9px 0; border-top:1px solid rgba(13,20,36,0.05); }
.gprov:first-of-type{ border-top:none; }
.gprov-id{ flex:1; min-width:0; }
.gprov-n{ font-size:12.5px; font-weight:600; color:var(--ink-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gprov-c{ font-size:10.5px; font-family:var(--mono); color:var(--ink-3); margin-top:2px; }
.gprov-sin{ color:var(--ink-4); font-style:italic; font-family:inherit; }
/* Dos CUIT en el mismo proveedor no es un error del sistema, es algo que hay
   que mirar antes de mandarlo. Ambar, como "hay que mandar": es una tarea. */
.gprov-ojo{ color:#8a520c; font-weight:700; }
/* Pagarle a un proveedor desde la tarjeta de acreedores. Discreto a proposito:
   compite con "Nuevo gasto", que es la accion principal de la pantalla. */
.gprov-pagar{
  flex:none; padding:5px 11px; border-radius:8px; cursor:pointer;
  border:1px solid rgba(107,95,255,0.30); background:rgba(107,95,255,0.10);
  color:#4a3fd0; font-size:11.5px; font-weight:700; font-family:inherit;
  transition:background 140ms ease, border-color 140ms ease;
}
.gprov-pagar:hover{ background:rgba(107,95,255,0.18); border-color:rgba(107,95,255,0.45); }
html[data-theme="dark"] .gprov{ border-top-color:rgba(255,255,255,0.06); }
html[data-theme="dark"] .gprov-ojo{ color:#ffc79a; }
html[data-theme="dark"] .gprov-pagar{
  background:rgba(124,113,255,0.22); border-color:rgba(124,113,255,0.44); color:#d5d0ff;
}
html[data-theme="dark"] .gprov-pagar:hover{ background:rgba(124,113,255,0.32); }

/* Vacio con MOTIVO. Un cero pelado se lee como "no hubo gastos"; el texto
   distingue "todavia no cargaste ninguno" de "en este periodo no hubo". */
.gempty{ padding:38px 24px; text-align:center; }
.gempty .t{ font-size:13.5px; font-weight:600; color:var(--ink-2); }
.gempty .s{ font-size:12px; color:var(--ink-3); margin-top:7px; line-height:1.55; max-width:400px; margin-left:auto; margin-right:auto; }

/* Casilla del modal (en IVA compras). No es un checkbox suelto: la etiqueta
   sola no alcanza para decidir, hace falta la explicacion al lado. */
.pm-check{ display:flex; gap:11px; align-items:flex-start; padding:12px 13px; border-radius:12px; background:rgba(255,255,255,0.5); border:1px solid rgba(255,255,255,0.85); margin-bottom:14px; cursor:pointer; }
.pm-check input{ width:17px; height:17px; margin-top:1px; flex:0 0 auto; accent-color:var(--purple); cursor:pointer; }
.pm-check .t{ font-size:12.5px; font-weight:600; color:var(--ink-1); }
.pm-check .s{ font-size:11px; color:var(--ink-3); margin-top:3px; line-height:1.45; }
html[data-theme="dark"] .pm-check{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.12); }

/* Aviso dentro del modal. Rojo = no se puede guardar; ambar = se puede, pero
   hay algo que el que carga tiene que saber (el doble descuento de la caja). */
.pm-warn{ font-size:11px; line-height:1.5; padding:10px 12px; border-radius:11px; margin:0 0 14px; }
.pm-warn.amber{ background:rgba(247,152,74,0.12); border:1px solid rgba(247,152,74,0.30); color:#8f5716; }
.pm-warn.red{ background:rgba(239,93,106,0.10); border:1px solid rgba(239,93,106,0.30); color:#a72c3a; }
.pm-warn b{ font-weight:700; }
html[data-theme="dark"] .pm-warn.amber{ color:#ffc79a; }
html[data-theme="dark"] .pm-warn.red{ color:#ff9aa4; }

/* El importe del modal se lee en grande: es el dato que se tipea mal. */
.pm-fld input.big{ font-family:var(--mono); font-size:19px; font-weight:700; letter-spacing:-0.02em; padding:12px; }

/* ── MENU DE EXPORTAR ─────────────────────────────────────────────────────
   Reusa .tipo-dd / .tipo-menu / .tm-item de Clientes. Es un MENU (acciones),
   no un listbox (filtro), asi que el markup usa role=menu / menuitem.

   Por que un menu y no dos botones en la barra: la contadora pide DOS cosas
   distintas de los gastos, y ninguna de las dos se explica sola con un rotulo
   corto. Dos botones obligarian a rotulos largos que no entran; el menu deja
   nombrar cada una con su linea de abajo, y deja lugar para la del ejercicio
   sin volver a tocar la barra. */
/* La barra tiene que apilar POR ENCIMA de los KPIs, o el menu sale roto.
   Medido: el menu se abria y las tarjetas de KPI le pasaban por arriba. La
   causa no es el z-index del menu (tiene 40) sino que .bar usa
   backdrop-filter, y eso CREA UN CONTEXTO DE APILAMIENTO: el 40 del menu solo
   compite adentro de la barra, y la barra entera —con z-index auto— queda
   debajo de los .kpis .k, que son position:relative y vienen despues en el
   DOM. Se arregla dandole a la barra su propio z-index, que ademas es lo
   correcto para un encabezado: lo que cuelga de el va arriba del contenido. */
.bar{ position:relative; z-index:50; }
/* Mas opaco que el .tipo-menu de Clientes, a proposito: aquel se despliega
   sobre una lista y el glass ahi funciona; este cae justo encima de los KPIs,
   que son numeros grandes en mono, y con 0.72 se leian A TRAVES del texto del
   menu. La sombra tambien sube, para que se despegue del fondo. */
.tipo-menu.der{ left:auto; right:0; min-width:296px;
  background:rgba(255,255,255,0.95);
  box-shadow:0 22px 52px rgba(20,26,44,0.30), 0 2px 8px rgba(20,26,44,0.12); }
html[data-theme="dark"] .tipo-menu.der{ background:rgba(26,33,60,0.97); }
.tm-item .tt{ display:block; font-size:12.5px; font-weight:600; color:var(--ink-1); }
.tm-item .ss{ display:block; font-size:11px; color:var(--ink-3); margin-top:3px; line-height:1.4; white-space:normal; }
.tm-item[disabled] .tt{ color:var(--ink-3); }
button.tm-item:focus-visible{ outline:2px solid var(--purple); outline-offset:-2px; }

/* El filtro de la lista, a la derecha del titulo de la seccion. */
.gfilters{ display:flex; align-items:center; gap:7px; }
.gf{ font-size:11.5px; font-weight:600; color:var(--ink-2); background:rgba(13,20,36,0.05); border:1px solid transparent; padding:6px 11px; border-radius:9px; cursor:pointer; transition:all 130ms; font-family:inherit; }
.gf:hover{ background:rgba(13,20,36,0.09); }
.gf.on{ background:rgba(107,95,255,0.12); color:var(--purple); border-color:rgba(107,95,255,0.3); }
html[data-theme="dark"] .gf{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .gf:hover{ background:rgba(255,255,255,0.12); }

/* ── ACCIONES DE LA FILA ──────────────────────────────────────────────────
   Aparecen siempre, no en hover: en una tablet no hay hover, y un boton que
   solo existe con el mouse encima no existe para quien la usa parada atras del
   mostrador. */
.gacts{ width:148px; flex:0 0 auto; display:flex; gap:6px; justify-content:flex-end; }
.gact{ font-size:11px; font-weight:600; font-family:inherit; color:var(--ink-2);
  background:rgba(13,20,36,0.05); border:1px solid transparent;
  padding:5px 9px; border-radius:8px; cursor:pointer; transition:all 130ms; white-space:nowrap; }
.gact:hover{ background:rgba(13,20,36,0.10); color:var(--ink-1); }
.gact.danger:hover{ background:rgba(192,56,74,0.12); color:var(--red); }
.gact:focus-visible{ outline:2px solid var(--purple); outline-offset:1px; }
html[data-theme="dark"] .gact{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .gact:hover{ background:rgba(255,255,255,0.13); }
html[data-theme="dark"] .gact.danger:hover{ background:rgba(255,120,140,0.16); }

/* ── ANULADOS ─────────────────────────────────────────────────────────────
   La fila se ve apagada y el importe TACHADO: existio y se dio de baja. No se
   muestra en cero porque eso escondria de cuanto era el comprobante. */
.clrow.anulada{ opacity:0.72; }
.clrow.anulada .clname{ text-decoration:line-through; text-decoration-thickness:1px; }
.gtotal.tachado{ text-decoration:line-through; color:var(--ink-3); }

/* ── ERROR DENTRO DE UN MODAL ─────────────────────────────────────────────
   Clase, no color inline: un hex por style no puede tener variante de tema, y
   este proyecto ya se equivoco DOS veces con eso (las pills de categoria aca
   mismo, y el color de dias de stock en el panel). */
.gerr{ font-size:12px; font-weight:600; color:var(--red);
  background:rgba(192,56,74,0.10); border:1px solid rgba(192,56,74,0.25);
  border-radius:10px; padding:9px 12px; margin:0 0 14px; line-height:1.45; }
html[data-theme="dark"] .gerr{ color:#ff9aa9; background:rgba(255,120,140,0.13); border-color:rgba(255,120,140,0.28); }
/* El error de la pantalla (fuera del modal). Era un color inline: el mismo
   error una tercera vez. Mismo valor en claro. */
.g-error{ font-size:12.5px; color:#c0384a; font-weight:600; }
html[data-theme="dark"] .g-error{ color:#ff9aa9; }

/* Lista de consecuencias antes de confirmar algo que mueve plata y stock. */
.pm-lista{ margin:0 0 16px; padding:0 0 0 17px; display:flex; flex-direction:column; gap:7px; }
.pm-lista li{ font-size:12px; color:var(--ink-2); line-height:1.5; }
.pm-lista li b{ color:var(--ink-1); }
.pm-btn.danger{ color:#fff; background:linear-gradient(140deg,#c0384a,#d9566a); box-shadow:0 6px 16px rgba(192,56,74,0.35); }

/* ── DETALLE DE UNA COMPRA (lectura) ──────────────────────────────────── */
.dtab{ margin:0 0 12px; border:1px solid rgba(13,20,36,0.09); border-radius:12px; overflow:hidden; }
.dth{ display:flex; gap:10px; align-items:center; padding:8px 12px;
  font-size:10.5px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase;
  color:var(--ink-3); background:rgba(13,20,36,0.04); }
.dtr{ display:flex; gap:10px; align-items:center; padding:9px 12px; font-size:12.5px; color:var(--ink-1);
  border-top:1px solid rgba(13,20,36,0.06); }
.dnum{ font-family:var(--mono,ui-monospace,monospace); font-variant-numeric:tabular-nums; }
.dsum{ display:flex; justify-content:space-between; align-items:center;
  font-size:12.5px; color:var(--ink-2); padding:0 2px; margin:0 0 10px; }
.dsum b{ font-size:14px; color:var(--ink-1); }
html[data-theme="dark"] .dtab{ border-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .dth{ background:rgba(255,255,255,0.05); }
html[data-theme="dark"] .dtr{ border-top-color:rgba(255,255,255,0.07); }

/* ── DETALLE EN EL ALTA (edicion) ─────────────────────────────────────── */
.det{ border-top:1px solid rgba(13,20,36,0.08); margin:4px 0 16px; padding:14px 0 0; }
.det-h{ margin:0 0 10px; }
.det-t{ display:block; font-size:12.5px; font-weight:700; color:var(--ink-1); }
.det-s{ display:block; font-size:11px; color:var(--ink-3); margin-top:3px; line-height:1.45; }
.det-tab{ border:1px solid rgba(13,20,36,0.09); border-radius:12px; overflow:hidden; margin:0 0 10px; }
.det-th{ display:flex; gap:8px; align-items:center; padding:7px 10px;
  font-size:10.5px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase;
  color:var(--ink-3); background:rgba(13,20,36,0.04); }
.det-tr{ display:flex; gap:8px; align-items:center; padding:7px 10px;
  border-top:1px solid rgba(13,20,36,0.06); }
.det-nom{ font-size:12.5px; color:var(--ink-1); }
.det-sub{ font-size:12.5px; color:var(--ink-1); font-family:var(--mono,ui-monospace,monospace); font-variant-numeric:tabular-nums; }
.det-in{ font-family:var(--mono,ui-monospace,monospace); font-size:12.5px; text-align:right;
  color:var(--ink-1); background:rgba(13,20,36,0.04); border:1px solid rgba(13,20,36,0.10);
  border-radius:8px; padding:5px 8px; outline:none; }
.det-in:focus{ border-color:var(--purple); background:rgba(107,95,255,0.06); }
.det-x{ width:28px; height:26px; border:none; border-radius:7px; cursor:pointer; font-size:16px; line-height:1;
  color:var(--ink-3); background:rgba(13,20,36,0.05); font-family:inherit; }
.det-x:hover{ color:var(--red); background:rgba(192,56,74,0.12); }
.det-busc{ position:relative; }
.det-busc input{ width:100%; font-family:inherit; font-size:12.5px; color:var(--ink-1);
  background:rgba(13,20,36,0.04); border:1px solid rgba(13,20,36,0.10);
  border-radius:10px; padding:9px 11px; outline:none; }
.det-busc input:focus{ border-color:var(--purple); }
.det-op{ position:absolute; z-index:60; left:0; right:0; top:calc(100% + 5px);
  background:rgba(255,255,255,0.97); border:1px solid rgba(13,20,36,0.10); border-radius:12px;
  box-shadow:0 18px 44px rgba(20,26,44,0.22); max-height:230px; overflow-y:auto; }
.det-opi{ display:block; width:100%; text-align:left; padding:8px 11px; border:none; cursor:pointer;
  background:transparent; font-family:inherit; }
.det-opi:hover{ background:rgba(107,95,255,0.10); }
.det-opn{ display:block; font-size:12.5px; font-weight:600; color:var(--ink-1); }
.det-opc{ display:block; font-size:10.5px; color:var(--ink-3); margin-top:2px; }
.det-vacio{ padding:9px 11px; font-size:11.5px; color:var(--ink-3); line-height:1.45; }
.det-sum{ display:flex; justify-content:space-between; align-items:center;
  font-size:12.5px; color:var(--ink-2); padding:0 2px; margin:0 0 10px; }
.det-sum i{ font-style:normal; color:var(--ink-3); font-size:11px; }
html[data-theme="dark"] .det{ border-top-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .det-tab{ border-color:rgba(255,255,255,0.10); }
html[data-theme="dark"] .det-th{ background:rgba(255,255,255,0.05); }
html[data-theme="dark"] .det-tr{ border-top-color:rgba(255,255,255,0.07); }
html[data-theme="dark"] .det-in,
html[data-theme="dark"] .det-busc input{ background:rgba(255,255,255,0.07); border-color:rgba(255,255,255,0.13); }
html[data-theme="dark"] .det-x{ background:rgba(255,255,255,0.07); }
html[data-theme="dark"] .det-op{ background:rgba(26,33,60,0.98); border-color:rgba(255,255,255,0.12); }
`;
