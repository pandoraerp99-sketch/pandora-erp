#!/usr/bin/env bash
# Suite completa: unit + integración (secuencial). Decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

echo "== eventos cableados (tienen que ser 6 nombres propios, no mutados) =="
grep -hoE "event_name: '(expense|customer\.account|auth\.accountant)\.[a-z_]+'" \
  src/lib/services/expenses/expense.service.ts \
  src/lib/services/customers/account.service.ts \
  src/lib/services/identity/accountant.service.ts | sort

FALLA=0
if pnpm test >/tmp/suite-unit.log 2>&1; then echo "UNIT OK"; else echo "UNIT FAIL"; FALLA=1; fi
grep -E 'Test Files|Tests ' /tmp/suite-unit.log | tail -2

if pnpm test:integration --no-file-parallelism >/tmp/suite-int.log 2>&1; then
  echo "INTEGRACION OK"
else
  echo "INTEGRACION FAIL"; FALLA=1
  grep -E '^\s*(FAIL|×)' /tmp/suite-int.log | head -30
fi
grep -E 'Test Files|Tests ' /tmp/suite-int.log | tail -2
exit "$FALLA"
