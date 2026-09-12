#!/usr/bin/env bash
# RED por mutación sobre la fecha de los movimientos de stock (migration 0037).
#
# Se rompe cada cosa que los tests dicen cubrir y se exige que se pongan en
# rojo. Cada mutación verifica que el archivo CAMBIÓ: una mutación que no se
# aplica deja los tests en verde y se lee como "el test no cubre esto", que es
# un hallazgo falso (ya pasó una vez en esta cadena de slices).
#
# Se decide por CÓDIGO DE SALIDA, nunca parseando el texto de vitest.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

GASTOS=src/lib/services/expenses/expense.service.ts
STOCK=src/lib/inventory/stock.ts
REPORTE=src/lib/services/reporting/inventario.report.ts
ARCHIVOS=("$GASTOS" "$STOCK" "$REPORTE")

for f in "${ARCHIVOS[@]}"; do cp "$f" "/tmp/mut-fecha-$(basename "$f").bak"; done
restaurar() {
  for f in "${ARCHIVOS[@]}"; do cp "/tmp/mut-fecha-$(basename "$f").bak" "$f"; done
}
trap restaurar EXIT

correr() {
  if pnpm test:integration --no-file-parallelism T-INV-12 T-COMPRAS-01 >/tmp/mut-fecha.txt 2>&1 \
     && pnpm vitest run tests/unit/stock-service.test.ts >>/tmp/mut-fecha.txt 2>&1; then
    echo 0
  else
    echo 1
  fi
}

NO_ATRAPADAS=0
# mutar <archivo> <expresión perl> <nombre>
mutar() {
  local archivo="$1" expr="$2" nombre="$3"
  cp "$archivo" /tmp/mut-fecha-antes
  perl -0pi -e "$expr" "$archivo"
  if cmp -s "$archivo" /tmp/mut-fecha-antes; then
    echo "  ⛔ NO SE APLICÓ (ancla no encontrada): $nombre — abortando"
    exit 2
  fi
  if [ "$(correr)" -ne 0 ]; then
    echo "  OK    — atrapada:  $nombre"
  else
    echo "  🔴 NO ATRAPADA:    $nombre"
    NO_ATRAPADAS=$((NO_ATRAPADAS + 1))
  fi
  restaurar
}

echo "==> Verde de partida (sin mutar)"
if [ "$(correr)" -ne 0 ]; then
  echo "  🔴 Ya está en rojo sin mutar. Abortando."
  exit 1
fi
echo "  OK"
echo ""
echo "==> Mutaciones"

mutar "$GASTOS" \
  's/            fecha: input\.fecha,\n//' \
  "la compra no pasa la fecha del comprobante al movimiento"

mutar "$GASTOS" \
  's/            fecha: original\.fecha,\n//' \
  "la reversa de una anulación lleva la fecha de hoy"

mutar "$REPORTE" \
  's/AND m\.fecha <= \$\{fechaCierre\}::date/AND m.created_at::date <= \${fechaCierre}::date/' \
  "el reporte vuelve a filtrar la cantidad por created_at"

mutar "$GASTOS" \
  's/if \(items\.length > 0 && input\.fecha > diaDelComercio\(\)\)/if (false)/' \
  "registerExpense acepta una compra con fecha futura"

mutar "$STOCK" \
  's/if \(input\.fecha > diaDelComercio\(\)\)/if (false)/' \
  "el libro acepta un movimiento con fecha futura"

echo ""
if [ "$NO_ATRAPADAS" -eq 0 ]; then
  echo "==> Todas las mutaciones atrapadas"
  exit 0
fi
echo "==> $NO_ATRAPADAS mutación(es) NO atrapada(s)"
exit 1
