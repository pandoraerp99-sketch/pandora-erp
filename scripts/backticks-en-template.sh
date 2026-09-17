#!/usr/bin/env bash
# Backticks DENTRO de un template literal de CSS.
#
# Pasó dos veces en la misma tarde: un comentario del bloque oscuro citando
# `.paysheet` cierra el template y Next tira "Expected a semicolon" — la app
# entera devuelve 500, incluido /login, y el error no menciona la palabra
# "backtick" por ningún lado.
#
# El typecheck también lo atrapa, pero esto dice exactamente qué línea y por
# qué, y corre en un segundo.
#
# Uso: bash scripts/backticks-en-template.sh [archivos...]
#      sin argumentos, revisa todos los *Css.ts y _css/*.ts
set -u
cd ~/workspace/pandora-erp || exit 1

if [ "$#" -gt 0 ]; then
  ARCHIVOS="$*"
else
  ARCHIVOS=$(ls src/app/*/*Css.ts src/app/_css/*.ts src/components/shell/shellCss.ts 2>/dev/null)
fi

# ── Los template de SQL tienen el mismo problema ──────────────────────────
# El 2026-09-17 volvió a pasar, esta vez en un comentario adentro de un
# sql`...`: citar una tabla con backticks cierra el template y Next tira
# "`,` o `)` expected" en una línea que no tiene ni coma ni paréntesis.
#
# Acá no se puede usar el mismo parser de arriba —un .ts de servicio tiene
# muchos template sueltos y el estado abierto/cerrado no es confiable—, así que
# se busca lo que de verdad rompe: un backtick DENTRO de un comentario SQL.
if [ "$#" -eq 0 ]; then
  SQL_MALOS=$(grep -rn -- '--.*`' src/lib/services/ src/lib/db/ 2>/dev/null || true)
  if [ -n "$SQL_MALOS" ]; then
    echo "🔴 backtick adentro de un comentario SQL (rompe el template):"
    printf '%s\n' "$SQL_MALOS"
    exit 1
  fi
fi

MALOS=0
for f in $ARCHIVOS; do
  # Estado: 0 = fuera del template, 1 = adentro. Cada backtick lo alterna.
  # Un backtick que aparece con el estado ya en 1 y NO cierra la constante es
  # el sospechoso: se reporta la línea.
  salida=$(awk '
    {
      linea = $0
      n = gsub(/`/, "`", linea)
      if (dentro == 1 && n > 0) {
        # La línea que cierra de verdad es la que termina en `; o ` +
        if (linea !~ /^`(;| \+)/ && linea !~ /`;[ \t]*$/) {
          printf "  linea %d: %s\n", NR, substr($0, 1, 90)
          malo = 1
        }
      }
      if (n % 2 == 1) dentro = 1 - dentro
    }
    END { exit malo ? 1 : 0 }
  ' "$f") || {
    echo "🔴 $f"
    printf '%s\n' "$salida"
    MALOS=$((MALOS + 1))
  }
done

if [ "$MALOS" -eq 0 ]; then
  echo "OK — ningún backtick suelto adentro de un template de CSS"
  exit 0
fi
echo "$MALOS archivo(s) con backticks adentro del template"
exit 1
