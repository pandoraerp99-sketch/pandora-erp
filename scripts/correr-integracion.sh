#!/usr/bin/env bash
# Corre tests de integración por filtro y deja el log completo en /tmp.
# Uso: bash scripts/correr-integracion.sh T-AUDIT-02 [T-CTA-01 ...]
# Sin argumentos corre la suite entera. Decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

LOG=/tmp/integracion-$(date +%s).log
if pnpm test:integration --no-file-parallelism "$@" >"$LOG" 2>&1; then
  RESULTADO=0
else
  RESULTADO=1
fi

# Resumen: fallas con su motivo, y los totales.
grep -E '^\s*(×|✗|FAIL)|AssertionError|Error:|expected|Test Files|Tests ' "$LOG" | head -80
echo "log: $LOG"
echo "exit=$RESULTADO"
exit "$RESULTADO"
