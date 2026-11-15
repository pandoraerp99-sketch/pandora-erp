#!/usr/bin/env bash
# ¿Qué pantallas usan cada clase CSS? Antes de tocar una clase del shell hay
# que saber si el cambio se derrama a otras pantallas.
# Uso: bash scripts/quien-usa-la-clase.sh cobrar card-stock ...
set -u
cd ~/workspace/pandora-erp || exit 1
for c in "$@"; do
  printf '%-12s ' "$c"
  # La clase como palabra entera dentro de un className (string o template).
  grep -rlE "className=.*(^|[^a-z-])${c}([^a-z-]|$)" src/app src/components --include='*.tsx' \
    | sed 's|src/||' | tr '\n' ' '
  echo
done
