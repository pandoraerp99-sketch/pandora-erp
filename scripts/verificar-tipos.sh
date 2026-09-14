#!/usr/bin/env bash
# Typecheck completo (tsc --noEmit). Decide por CÓDIGO DE SALIDA.
# Uso: bash scripts/verificar-tipos.sh [archivos a revisar por CRLF...]
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

if [ "$#" -gt 0 ]; then
  bash scripts/contar-crlf.sh "$@"
fi

if pnpm exec tsc --noEmit -p . >/tmp/tsc.log 2>&1; then
  echo "TSC_OK"
  exit 0
fi
echo "TSC_FAIL"
head -40 /tmp/tsc.log
exit 1
