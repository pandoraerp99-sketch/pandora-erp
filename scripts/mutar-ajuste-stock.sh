#!/usr/bin/env bash
# RED por mutación sobre el ajuste manual de stock y el historial (0038).
#
# Se rompe cada regla que los tests dicen cubrir y se exige que algún test se
# ponga en rojo. Cada mutación verifica que el archivo CAMBIÓ antes de correr:
# una mutación que no se aplica se leería como "el test no cubre esto", que es
# un hallazgo falso. Se decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

DOMINIO=src/lib/domain/ajuste-stock.ts
STOCK=src/lib/inventory/stock.ts
SERVICE=src/lib/services/products/product.service.ts
QUERIES=src/lib/inventory/queries.ts
ARCHIVOS=("$DOMINIO" "$STOCK" "$SERVICE" "$QUERIES")

for f in "${ARCHIVOS[@]}"; do cp "$f" "/tmp/mut-aju-$(basename "$f").bak"; done
restaurar() {
  for f in "${ARCHIVOS[@]}"; do cp "/tmp/mut-aju-$(basename "$f").bak" "$f"; done
}
trap restaurar EXIT

correr() {
  if pnpm vitest run tests/unit/ajuste-stock.test.ts tests/unit/stock-service.test.ts >/tmp/mut-aju.txt 2>&1 \
     && pnpm test:integration --no-file-parallelism T-INV-10 T-INV-13 T-PROD-02 >>/tmp/mut-aju.txt 2>&1; then
    echo 0
  else
    echo 1
  fi
}

NO_ATRAPADAS=0
mutar() {
  local archivo="$1" expr="$2" nombre="$3"
  cp "$archivo" /tmp/mut-aju-antes
  perl -0pi -e "$expr" "$archivo"
  if cmp -s "$archivo" /tmp/mut-aju-antes; then
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

mutar "$DOMINIO" \
  's/if \(motivo\.grupo === .merma. && delta\.isPositive\(\)\)/if (false)/' \
  "una merma puede sumar"

mutar "$DOMINIO" \
  's/if \(motivo\.detalleObligatorio && detalle\.length === 0\)/if (false)/' \
  "\"Otro\" no pide detalle"

mutar "$STOCK" \
  's/if \(input\.type === .adjustment. && esMerma\)/if (false)/' \
  "el libro acepta un motivo de merma en un adjustment"

mutar "$STOCK" \
  's/if \(input\.skip_audit !== true && input\.type !== .adjustment. && input\.type !== .loss.\)/if (false)/' \
  "sale\/purchase\/return ya no necesitan su propio evento"

mutar "$STOCK" \
  's/\(movement\.type === .adjustment. \|\| movement\.type === .loss.\)/(movement.type === "adjustment")/' \
  "una merma no se audita"

mutar "$SERVICE" \
  's/      type: plan\.type,\n/      type: "adjustment" as const,\n/' \
  "el service registra toda merma como adjustment"

mutar "$QUERIES" \
  's/ORDER BY m\.fecha DESC, m\.created_at DESC, m\.id DESC/ORDER BY m.created_at DESC, m.id DESC/' \
  "el historial ordena por cuándo se cargó"

mutar "$QUERIES" \
  's/AND m\.product_id = \$\{productId\}/AND m.product_id = \${productId} OR m.product_id = \${productId}/' \
  "el historial pierde el filtro de tenant (precedencia del OR)"

mutar "$QUERIES" \
  "s/NULLIF\(TRIM\(s\.customer_name_snapshot\), ''\)/'Venta' || COALESCE(' · ' || NULLIF(TRIM(s.customer_name_snapshot), ''), '')/" \
  "el origen de la venta repite el tipo"

echo ""
if [ "$NO_ATRAPADAS" -eq 0 ]; then
  echo "==> Todas las mutaciones atrapadas"
  exit 0
fi
echo "==> $NO_ATRAPADAS mutación(es) NO atrapada(s)"
exit 1
