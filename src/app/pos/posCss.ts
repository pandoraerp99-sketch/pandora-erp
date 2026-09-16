/**
 * Modo oscuro del POS.
 *
 * ── POR QUE ESTE ARCHIVO NO EXISTIA ───────────────────────────────────────
 * El POS no tiene CSS propio: sus clases (`.card`, `.cart`, `.paysheet`,
 * `.numpad`…) viven en `components/shell/shellCss.ts`, que es la maqueta del
 * POS de la que salió el shell de toda la app. Por eso hasta hoy la pantalla
 * se veía ENTERA EN CLARO con el tema oscuro puesto: la luna aparecía y no
 * hacía nada.
 *
 * El bloque NO se agrega a `shellCss`: ese archivo lo montan TODAS las
 * pantallas, y las de gestión ya traen el núcleo oscuro por su cuenta —
 * quedaría cargado dos veces. Acá vive lo del POS, y `POSClient` lo monta
 * después del shell, que es el orden que hace que `html[data-theme="dark"]`
 * le gane al `:root` claro.
 *
 * Medido con `scripts/tokens-y-colores-claros.sh` y
 * `scripts/reglas-claras-en-uso.sh`: sólo se repinta lo que la pantalla usa.
 *
 * OJO: es un TEMPLATE LITERAL. Nada de backticks acá adentro.
 */
import { OSCURO_NUCLEO } from '../_css/tema-oscuro';

export const POS_CSS =
  OSCURO_NUCLEO +
  `
/* ════════════════ MODO OSCURO · lo propio del POS ════════════════ */

/* --tdf es el ÚNICO token del shell que el núcleo no redefine (es el celeste
   de Ley 19.640, que sólo usa el POS). En claro es #0e8f9e sobre blanco; sobre
   azul noche hay que subirlo o el chip TDF queda ilegible. */
html[data-theme="dark"]{ --tdf:#5fc8ff; }
html[data-theme="dark"] .tag-tdf{ background:rgba(3,7,20,0.55); border-color:rgba(95,200,255,0.3); }

/* Catálogo: tarjetas de producto. */
html[data-theme="dark"] .card{ background:rgba(29,37,66,0.6); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .card:hover{ border-color:rgba(141,162,255,0.45); box-shadow:inset 0 1px 0 rgba(255,255,255,0.07), 0 10px 22px rgba(3,7,20,0.45); }
html[data-theme="dark"] .card-img{ background:linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02)); }
html[data-theme="dark"] .card-stock.low{ color:#ff8b96; }

/* Iniciales de la tarjeta (hacen de foto). Estaban con el color inline. */
.card-ini{ font-size:34px; font-weight:700; letter-spacing:-0.03em; color:rgba(13,20,36,0.13); }

html[data-theme="dark"] .card-ini{ color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .cat-foot{ border-top-color:rgba(255,255,255,0.07); }
html[data-theme="dark"] .cat{ background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .cat:hover{ background:rgba(255,255,255,0.12); }
html[data-theme="dark"] .kbd{ background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.14); }
/* .online y .store-pill no están acá: son del SHELL y los repinta el núcleo,
   porque los muestra cualquier pantalla. */

/* Los dos chips sobre la foto del producto: fondo casi blanco con texto
   oscuro. Sobre la tarjeta oscura hay que dar vuelta las dos cosas. */
html[data-theme="dark"] .tag-low{ color:#ff8b96; background:rgba(3,7,20,0.62); border-color:rgba(255,139,150,0.35); }

/* Carrito. */
html[data-theme="dark"] .cart-head,
html[data-theme="dark"] .summary,
html[data-theme="dark"] .total{ border-color:rgba(255,255,255,0.08); }
html[data-theme="dark"] .item{ background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); }
html[data-theme="dark"] .item:hover{ background:rgba(255,255,255,0.09); }
html[data-theme="dark"] .del{ color:#5b6584; }
html[data-theme="dark"] .sval.green{ color:#55dd9b; }
html[data-theme="dark"] .cust-tag{ color:#ffb87a; background:rgba(247,152,74,0.16); }

/* Hoja de cobro.
   🔴 .paysheet es rgba(255,255,255,0.9): BLANCO al 90%. En oscuro el texto
   pasa a #eef2ff y quedaba casi blanco sobre casi blanco — la pantalla donde
   se cobra, ilegible. En la captura se leía como "los textos quedaron
   apagados"; lo que lo delató fue MEDIR el color computado
   (scripts/shot-pos.mjs "computados:..."), no mirar el PNG. */
html[data-theme="dark"] .paysheet{ background:rgba(16,22,46,0.94); border-top-color:rgba(255,255,255,0.12); box-shadow:0 -12px 44px rgba(3,7,20,0.6); }
html[data-theme="dark"] .paysheet-backdrop{ background:rgba(3,7,20,0.55); }
html[data-theme="dark"] .paysheet-grip{ background:rgba(255,255,255,0.2); }
html[data-theme="dark"] .paysheet-close:hover{ background:rgba(255,255,255,0.12); }
html[data-theme="dark"] .numpad button{ background:rgba(255,255,255,0.07); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .numpad button:hover{ background:rgba(255,255,255,0.15); }
html[data-theme="dark"] .paybar{ background:rgba(255,255,255,0.1); }
/* Las filas de medio de pago y el selector de cliente: blanco al 70% con
   borde blanco al 90%. Mismo caso que .paysheet, más chico. */
html[data-theme="dark"] .pmrow,
html[data-theme="dark"] .paysel,
html[data-theme="dark"] .cust{ background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .paysel:hover,
html[data-theme="dark"] .pmrow:hover{ background:rgba(255,255,255,0.12); }
html[data-theme="dark"] .pmrow.active{ background:rgba(141,162,255,0.14); border-color:var(--purple); }
html[data-theme="dark"] .pmrow .pmf{ background:rgba(255,255,255,0.07); border-color:rgba(255,255,255,0.12); }
html[data-theme="dark"] .pmrow[data-off="1"] .pmf{ background:rgba(255,255,255,0.04); }

/* Aviso de error / confirmación arriba del catálogo. Estaba con los dos
   colores inline en un ternario, o sea sin variante de tema. */
.pos-aviso{ flex:0 0 auto; padding:10px 14px; border-radius:14px; font-size:12.5px; color:#1f7a4d; }

.pos-aviso.err{ color:#c0384a; }

html[data-theme="dark"] .pos-aviso{ color:#55dd9b; }

html[data-theme="dark"] .pos-aviso.err{ color:#ff8b96; }

/* Banda del modo consulta. Tiene que seguir siendo IMPOSIBLE de confundir con
   el modo venta — por eso el ámbar se mantiene, subido para fondo oscuro. */
.pos-consulta{ flex:0 0 auto; padding:10px 14px; border-radius:14px; display:flex; align-items:center; gap:12px; font-size:12.5px;
  border:1px solid rgba(247,152,74,0.5); background:rgba(247,152,74,0.10); }

.pos-consulta b.pos-consulta-t{ color:#a2560f; font-weight:700; }

html[data-theme="dark"] .pos-consulta{ border-color:rgba(255,184,122,0.45); background:rgba(247,152,74,0.14); }

html[data-theme="dark"] .pos-consulta b.pos-consulta-t{ color:#ffb87a; }
`;
