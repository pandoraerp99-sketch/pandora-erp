#!/usr/bin/env bash
# Suite completa: unit + integración (secuencial). Decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

# Los nombres tienen que salir LITERALES del código, no armados con variables:
# un `event_name: \`\${dominio}.settled\`` pasa el typecheck y deja el catálogo
# sin poder auditarse con un grep.
#
# ⚠️ La lista de archivos es a mano y por eso se queda vieja: el 2026-09-18 este
# check decía "6" y no miraba supplier-account.service.ts, así que los dos
# eventos de proveedores estaban emitidos y NO aparecían acá. Si agregás un
# service que emite, agregalo también en esta lista y en el dominio de la regex.
echo "== eventos cableados (tienen que ser 8 nombres propios, no mutados) =="
grep -hoE "event_name: '(expense|customer\.account|supplier\.account|auth\.accountant)\.[a-z_]+'" \
  src/lib/services/expenses/expense.service.ts \
  src/lib/services/expenses/supplier-account.service.ts \
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
