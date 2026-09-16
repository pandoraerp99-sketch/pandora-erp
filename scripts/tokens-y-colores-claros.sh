#!/usr/bin/env bash
# Qué le falta a una pantalla para tener modo oscuro, medido sobre su CSS.
#
# (1) TOKENS: los que la pantalla define en su :root y el núcleo oscuro NO
#     redefine. Cada uno que falte queda con su valor CLARO sobre fondo noche
#     — así es como /caja quedaba blanca con 6 parches puestos.
# (2) REGLAS con color/fondo/borde claro hardcodeado (no por token), que son
#     las que hay que repintar a mano.
#
# Uso: bash scripts/tokens-y-colores-claros.sh src/app/caja/cajaCss.ts
set -u
cd ~/workspace/pandora-erp || exit 1
CSS="${1:?falta el archivo css}"
NUCLEO=src/app/_css/tema-oscuro.ts

echo "== tokens que define $CSS y el núcleo oscuro NO redefine =="
# Los tokens del :root del archivo, y los del bloque dark del núcleo.
# LC_ALL=C: `comm` exige el MISMO orden que usó `sort`, y con la locale de la
# sesión los guiones se ordenan distinto. Sin esto imprime "file 1 is not in
# sorted order" y se saltea tokens — o sea, dice que no falta nada.
grep -o -- '--[a-z0-9-]*:' "$CSS" | tr -d ':' | LC_ALL=C sort -u > /tmp/tok-pantalla.txt
grep -o -- '--[a-z0-9-]*:' "$NUCLEO" | tr -d ':' | LC_ALL=C sort -u > /tmp/tok-nucleo.txt
LC_ALL=C comm -23 /tmp/tok-pantalla.txt /tmp/tok-nucleo.txt

echo ""
echo "== reglas con color claro a mano (no por token) =="
# Blancos, casi-blancos y rgba oscuros translúcidos (bordes/sombras del claro).
grep -n -E '(#f[0-9a-f]{5}|#e[0-9a-f]{5}|#fff\b|rgba\(255,255,255|rgba\(13,20,36|rgba\(54,70,120)' "$CSS" \
  | grep -v 'data-theme="dark"' | head -60

echo ""
echo "== cuántas reglas ya tienen variante oscura =="
grep -c 'data-theme="dark"' "$CSS"
