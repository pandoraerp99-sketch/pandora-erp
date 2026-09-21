#!/usr/bin/env bash
# ¿Qué services ESCRIBEN sin leer nunca el rol de quien escribe?
#
# Medida GRUESA a propósito: mira por archivo, no por función, y "lee el rol"
# = menciona `company_users` o recibe un `UserRole`. No prueba que la guardia
# sea correcta donde existe, ni que haga falta donde no está (hay services que
# no son del comercio). Sirve para dimensionar el hallazgo del slice 4 con un
# número medido en vez de una impresión.
set -euo pipefail
cd "$(dirname "$0")/.."

ESCRIBEN=0
SIN_GUARDIA=0
LISTA=""

for f in $(find src/lib/services -name '*.ts' ! -name '*.test.ts' | sort); do
  grep -qE '\.(insert|update|delete)\(' "$f" || continue
  ESCRIBEN=$((ESCRIBEN + 1))
  if grep -qE 'company_users|UserRole|actor_role' "$f"; then
    continue
  fi
  SIN_GUARDIA=$((SIN_GUARDIA + 1))
  LISTA="$LISTA  $f
"
done

echo "services que escriben:        $ESCRIBEN"
echo "sin ninguna lectura de rol:   $SIN_GUARDIA"
echo
printf '%s' "$LISTA"
