"""Extrae el CSS de public/panel.html a un modulo TS, escapando lo que rompe
un template literal (backticks y la secuencia de interpolacion).

Se hace con un script y no a mano porque son 41.000 caracteres: copiarlos a
mano es como se pierde una regla y despues 'se parece pero no es'.
"""
import io, re, os, sys

REPO = r"\\wsl.localhost\Ubuntu-22.04\home\pandora\workspace\pandora-erp"
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
.ig-rot{ font-size:10.5px; color:var(--ink-3); font-family:var(--mono); }

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
