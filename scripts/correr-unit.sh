#!/usr/bin/env bash
# Corre tests unitarios por filtro y resume. Decide por CÓDIGO DE SALIDA.
# Uso: bash scripts/correr-unit.sh tests/unit/merma.test.ts
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

LOG=/tmp/unit-$(date +%s).log
if pnpm vitest run "$@" >"$LOG" 2>&1; then RESULTADO=0; else RESULTADO=1; fi
grep -E '^\s*(×|✗|FAIL)|AssertionError|Error:|expected|Test Files|Tests ' "$LOG" | head -60
echo "log: $LOG"
echo "exit=$RESULTADO"
exit "$RESULTADO"
