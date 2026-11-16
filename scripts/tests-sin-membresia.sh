#!/usr/bin/env bash
# Qué tests arman un contexto de tracing con actor 'user' y NUNCA insertan
# una fila en company_users. Con la guardia de rol (H-01), un usuario sin
# membresía no escribe: esos tests se ponen rojos, y lo correcto es darles
# la membresía en el fixture, no aflojar la guardia.
set -u
cd ~/workspace/pandora-erp || exit 1

total=0; sin=0
for f in tests/integration/*.ts tests/cross-tenant/*.ts; do
  grep -q "withTracingContext" "$f" || continue
  total=$((total + 1))
  if ! grep -q "company_users" "$f"; then
    sin=$((sin + 1))
    echo "  $f"
  fi
done
echo "tests con contexto: $total · sin company_users: $sin"
