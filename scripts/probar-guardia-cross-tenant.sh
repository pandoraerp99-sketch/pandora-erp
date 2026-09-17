#!/usr/bin/env bash
# Prueba EN LOS DOS SENTIDOS el test cross-tenant del gráfico de ingresos vs
# gastos.
#
# Existe por la misma razón que `probar-guardia-backticks.sh`: un test
# cross-tenant que pasa puede estar pasando porque no hay nada que ver, no
# porque el filtro ande. Acá se le saca el `tenant_id` al brazo nuevo de la
# UNION —el de supplier_account_movements— y se verifica que el test LO
# DETECTE. Si pasa igual, el test no sirve de guardia.
set -u
cd ~/workspace/pandora-erp || exit 1

ARCHIVO=src/lib/services/reporting/panel.report.ts
BK=$(mktemp)
cp "$ARCHIVO" "$BK"
restaurar() { cp "$BK" "$ARCHIVO"; rm -f "$BK"; }
trap restaurar EXIT

echo "1) con el filtro puesto: tiene que PASAR"
if bash scripts/correr-integracion.sh T-PROV-01 >/dev/null 2>&1; then
  echo "   ok — pasa"
else
  echo "   🔴 falla con el archivo sano"; exit 1
fi

echo "2) sin el filtro por tenant en los pagos: tiene que FALLAR"
python3 - "$ARCHIVO" <<'PY'
import sys
ruta = sys.argv[1]
texto = open(ruta, encoding='utf-8').read()
viejo = """            FROM supplier_account_movements
            WHERE tenant_id = ${tenantId}
              AND type = 'payment'"""
nuevo = """            FROM supplier_account_movements
            WHERE type = 'payment'"""
assert viejo in texto, 'no se encontro el brazo de pagos a mutar'
open(ruta, 'w', encoding='utf-8').write(texto.replace(viejo, nuevo, 1))
PY
if bash scripts/correr-integracion.sh T-PROV-01 >/dev/null 2>&1; then
  echo "   🔴 PASA sin el filtro: el test no es guardia de nada"; exit 1
else
  echo "   ok — lo detecta"
fi
echo "guardia cross-tenant verificada en los dos sentidos"
