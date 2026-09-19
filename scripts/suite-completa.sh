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

# El catálogo del CÓDIGO contra el DOC. Los tests no pueden hacerlo: corren en
# WSL y EVENT-TAXONOMY.md vive en el filesystem de Windows, así que el "coincide
# exacto" que afirmaban CLAUDE.md, el DECISION-LEDGER y el propio doc no lo
# verificaba nadie — y derivó dos versiones enteras (49 declarados con 51 en el
# código). Si el doc no está montado lo DICE y no falla: un chequeo que no corrió
# no es un chequeo que pasó.
echo "== catálogo de eventos: código vs EVENT-TAXONOMY.md =="
if bash scripts/verificar-catalogo-eventos.sh; then :; else FALLA=1; fi

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
