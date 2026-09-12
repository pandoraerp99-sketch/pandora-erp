#!/usr/bin/env bash
# RED por mutación sobre el stock de alta (T-INV-11).
#
# El test pasó en verde a la primera porque el servicio se escribió antes que
# el test. Un test que nunca se vio fallar no probó nada todavía: acá se rompe
# cada cosa que T-INV-11 dice cubrir y se exige que se ponga en rojo.
#
# Se decide por CÓDIGO DE SALIDA, nunca parseando el texto de vitest (los
# códigos ANSI hacen que un grep "passed" mienta).
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

SERVICE=src/lib/services/products/product.service.ts
STOCK=src/lib/inventory/stock.ts
CSV=src/lib/services/products/csv-import.ts

cp "$SERVICE" /tmp/mut-service.bak
cp "$STOCK"   /tmp/mut-stock.bak
cp "$CSV"     /tmp/mut-csv.bak
restaurar() {
  cp /tmp/mut-service.bak "$SERVICE"
  cp /tmp/mut-stock.bak   "$STOCK"
  cp /tmp/mut-csv.bak     "$CSV"
}
trap restaurar EXIT

correr() {
  pnpm test:integration --no-file-parallelism T-INV-11 >/tmp/mut-stock-inicial.txt 2>&1
  echo $?
}

FALLARON=0
probar() {
  local nombre="$1"
  local codigo
  codigo=$(correr)
  if [ "$codigo" -ne 0 ]; then
    echo "  OK    — atrapada:     $nombre"
  else
    echo "  🔴 NO ATRAPADA:       $nombre"
    FALLARON=$((FALLARON + 1))
  fi
  restaurar
}

echo "==> Verde de partida (sin mutar)"
if [ "$(correr)" -ne 0 ]; then
  echo "  🔴 El test YA está en rojo sin mutar. Abortando."
  exit 1
fi
echo "  OK"
echo ""
echo "==> Mutaciones"

# M1 — el alta no abre libro (el bug original: stock_current directo).
perl -0pi -e 's/const abreLibro = stockInicial\.gt\(0\) && input\.stock_tracking_enabled;/const abreLibro = false;/' "$SERVICE"
probar "el alta escribe stock_current directo, sin movimiento"

# M2 — el alta en cero abre libro igual (movimiento vacío; qty > 0 lo rechaza).
perl -0pi -e 's/const abreLibro = stockInicial\.gt\(0\) && input\.stock_tracking_enabled;/const abreLibro = input.stock_tracking_enabled;/' "$SERVICE"
probar "un alta en cero genera un movimiento vacío"

# M3 — abre libro aunque el producto no lleve tracking (descuadre al revés).
perl -0pi -e 's/const abreLibro = stockInicial\.gt\(0\) && input\.stock_tracking_enabled;/const abreLibro = stockInicial.gt(0);/' "$SERVICE"
probar "abre libro sin tracking: columna 0, libro N"

# M4 — no difiere la baja: el movimiento choca con ProductInactiveError.
perl -0pi -e 's/is_active: abreLibro \? true : input\.is_active,/is_active: input.is_active,/' "$SERVICE"
probar "alta inactiva con stock revienta el alta entera"

# M5 — el alta se audita como ajuste manual del comerciante.
perl -0pi -e 's/      skip_audit: true,\n      \.\.\.\(input\.override_tenant_id/      skip_audit: false,\n      ...(input.override_tenant_id/' "$STOCK"
probar "el alta emite stock.adjusted_manually"

# M6 — editar un producto vuelve a poder escribir el stock (silenciosamente).
perl -0pi -e 's/\(rawInput as \{ stock_current\?: unknown \}\)\.stock_current !== undefined/false/' "$SERVICE"
probar "updateProduct ignora en silencio el stock_current que le mandan"

# M7 — la importación masiva vuelve a insertar el stock directo.
perl -0pi -e 's/\.values\(rowsToInsert\.map\(\(r\) => \(\{ \.\.\.r, stock_current: .0. \}\)\)\)/.values(rowsToInsert)/' "$CSV"
probar "el import CSV escribe stock_current directo"

echo ""
if [ "$FALLARON" -eq 0 ]; then
  echo "==> Las 7 mutaciones fueron atrapadas."
else
  echo "==> 🔴 $FALLARON mutaciones NO fueron atrapadas: el test no cubre lo que dice."
fi
exit "$FALLARON"
