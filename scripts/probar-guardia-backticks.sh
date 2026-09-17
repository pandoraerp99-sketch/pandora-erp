#!/usr/bin/env bash
# Prueba la guardia de backticks EN LOS DOS SENTIDOS.
#
# Existe porque la primera verificación de esta guardia dio un OK falso: el sed
# que inyectaba el backtick no aplicaba, así que "no encontró nada" significaba
# "no había nada", no "la guardia anda". Una guardia que nunca vio fallar no es
# una guardia.
set -u
cd ~/workspace/pandora-erp || exit 1

ARCHIVO=src/lib/services/reporting/cierre.report.ts
BK=$(mktemp)
cp "$ARCHIVO" "$BK"
restaurar() { cp "$BK" "$ARCHIVO"; rm -f "$BK"; }
trap restaurar EXIT

echo "1) sin backticks: tiene que PASAR"
if bash scripts/backticks-en-template.sh >/dev/null 2>&1; then
  echo "   ok — pasa"
else
  echo "   🔴 falla con el archivo sano"; exit 1
fi

echo "2) con un backtick en un comentario SQL: tiene que FALLAR"
python3 - "$ARCHIVO" <<'PY'
import sys
ruta = sys.argv[1]
texto = open(ruta, encoding='utf-8').read()
viejo = '-- gobierna la tabla expenses (GASTO_VIGENTE)'
nuevo = '-- gobierna la tabla `expenses` (GASTO_VIGENTE)'
assert viejo in texto, 'no se encontro la linea a mutar'
open(ruta, 'w', encoding='utf-8').write(texto.replace(viejo, nuevo, 1))
PY
if bash scripts/backticks-en-template.sh >/dev/null 2>&1; then
  echo "   🔴 PASA con el backtick puesto: la guardia no sirve"; exit 1
else
  echo "   ok — lo detecta"
fi
echo "guardia verificada en los dos sentidos"
