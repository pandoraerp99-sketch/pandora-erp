#!/usr/bin/env bash
# Las reglas del CSS claro QUE LA PANTALLA USA DE VERDAD y que hay que repintar
# para el modo oscuro.
#
# Por qué existe: las maquetas de este proyecto traen mucho CSS muerto. Pintar
# a ciegas todo lo que tenga un color claro produce un bloque oscuro enorme
# donde la mitad son selectores que no existen en la pantalla — cobertura
# aparente. Acá se cruzan las dos cosas: la regla tiene color claro Y la clase
# aparece en el .tsx.
#
# Uso: bash scripts/reglas-claras-en-uso.sh src/app/caja/cajaCss.ts src/app/caja/CajaClient.tsx
set -u
cd ~/workspace/pandora-erp || exit 1
CSS="${1:?falta el css}"
TSX="${2:?falta el tsx}"

# Clases que la pantalla realmente usa (className="..." y los literales de los
# className={...} dinámicos).
{
  grep -o 'className="[^"]*"' "$TSX" | sed 's/className="//;s/"//'
  grep -o 'className={[^}]*}' "$TSX" | grep -o "'[a-zA-Z0-9 _-]*'" | tr -d "'"
} | tr ' ' '\n' | grep -v '^$' | LC_ALL=C sort -u > /tmp/clases-en-uso.txt

echo "== reglas con color claro cuya clase SÍ se usa en la pantalla =="
# OJO con las reglas MULTILÍNEA. La primera versión de esto miraba sólo la
# línea donde estaba el color y buscaba la clase ahí mismo — así se le escapó
# `.paysheet`, cuyo selector está en una línea y su `background:rgba(255,255,
# 255,0.9)` en la siguiente. Era el peor caso de todos: la hoja de cobro con
# fondo blanco y texto casi blanco en modo oscuro.
#
# Ahora se recuerda el último selector visto (awk) y se reporta con él.
awk -v claras='/tmp/clases-en-uso.txt' '
  # Una línea que empieza con . o # (o los arrastra tras una coma) abre regla.
  /^[ \t]*[.#][a-zA-Z0-9_-]/ { sel = $0; selLinea = NR }
  /data-theme="dark"/        { next }
  /#[0-9a-fA-F]{6}|#fff[^0-9a-fA-F]|rgba\(255,255,255|rgba\(13,20,36|rgba\(54,70,120/ {
    linea = (sel == "" ? $0 : sel)
    # La primera clase del selector recordado.
    if (match(linea, /[.#][a-zA-Z0-9_-]+/)) {
      clase = substr(linea, RSTART + 1, RLENGTH - 1)
      cmd = "grep -qx \"" clase "\" " claras
      if (system(cmd) == 0) printf "%d:%s   <<< color en la linea %d\n", selLinea, sel, NR
    }
  }
' "$CSS" | LC_ALL=C sort -u -t: -k1,1n
