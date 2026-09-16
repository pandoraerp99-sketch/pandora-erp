#!/usr/bin/env bash
# ¿Los selectores que toca un bloque oscuro EXISTEN en el CSS claro y se USAN
# en la pantalla? Un selector inventado no rompe nada: queda CSS muerto que
# parece cobertura. Las maquetas de este proyecto traen mucho CSS sin usar, así
# que las dos columnas importan.
#
# Uso: bash scripts/selectores-existen.sh src/app/caja/cajaCss.ts src/app/caja/CajaClient.tsx
set -u
cd ~/workspace/pandora-erp || exit 1
CSS="${1:?falta el css}"
TSX="${2:?falta el tsx}"

# Los selectores de clase que aparecen DENTRO del bloque oscuro del archivo.
grep -o 'html\[data-theme="dark"\] [.#][a-zA-Z0-9_-]*' "$CSS" \
  | sed 's/.*[.#]//' | sort -u > /tmp/sel-oscuros.txt

printf '%-22s %-10s %s\n' SELECTOR EN-CSS-CLARO EN-PANTALLA
while read -r s; do
  # En el CSS claro: la regla sin el prefijo dark.
  enCss=$(grep -c "[.#]${s}[ ,{:]" "$CSS")
  oscuros=$(grep -c "html\[data-theme=\"dark\"\] [.#]${s}[ ,{:]" "$CSS")
  claro=$(( enCss - oscuros ))
  enTsx=$(grep -c -- "$s" "$TSX")
  marca=''
  [ "$claro" -le 0 ] && marca='  <-- NO existe en el CSS claro'
  [ "$enTsx" -le 0 ] && marca="$marca  <-- NO se usa en la pantalla"
  printf '%-22s %-10s %s%s\n' "$s" "$claro" "$enTsx" "$marca"
done < /tmp/sel-oscuros.txt
