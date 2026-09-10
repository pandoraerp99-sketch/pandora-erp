"""Extrae el CSS de public/panel.html a un modulo TS, escapando lo que rompe
un template literal (backticks y la secuencia de interpolacion).

Se hace con un script y no a mano porque son 41.000 caracteres: copiarlos a
mano es como se pierde una regla y despues 'se parece pero no es'.
"""
import io, re, os, sys

# Relativo al propio script: asi corre igual desde WSL, desde Windows o desde
# cualquier working directory. La primera version tenia la ruta de Windows
# escrita a mano y fallaba al correrlo desde el repo.
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = io.open(os.path.join(REPO, "public", "panel.html"), encoding="utf-8").read()

estilos = re.findall(r"<style[^>]*>(.*?)</style>", html, re.S)
css = "\n\n".join(s.strip() for s in estilos)

BT = chr(96)
INTERP = "$" + "{"
print("backticks en el CSS:", css.count(BT))
print("interpolaciones:", css.count(INTERP))
print("largo:", len(css))

# Escapar para que entre en un template literal.
seguro = css.replace("\\", "\\\\").replace(BT, "\\" + BT).replace(INTERP, "\\" + INTERP)

cabecera = '''// CSS del Panel — COPIA COMPLETA Y VERBATIM de los dos <style> de
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
'''

cola = '''
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
` + RESET_CARD_POS;
'''

destino = os.path.join(REPO, "src", "app", "panel", "panelCss.ts")
io.open(destino, "w", encoding="utf-8").write(cabecera + seguro + cola)
print("escrito ->", destino)
