#!/usr/bin/env bash
# Corre un grupo de tests de integración N veces y cuenta cuántas pasan.
# Para sospechas de test inestable: una corrida verde no prueba nada.
# Uso: bash scripts/repetir-test.sh T-CASH-10 20
set -u
cd ~/workspace/pandora-erp || exit 1
filtro="${1:?falta el filtro}"; veces="${2:-10}"
ok=0
for i in $(seq 1 "$veces"); do
  if bash scripts/correr-integracion.sh "$filtro" >/tmp/repetir.log 2>&1; then
    ok=$((ok + 1))
  else
    echo "  corrida $i ROJA:"
    grep -E "×|Error:" /tmp/repetir.log | head -3
  fi
done
echo "$filtro: $ok/$veces verdes"
[ "$ok" -eq "$veces" ]
