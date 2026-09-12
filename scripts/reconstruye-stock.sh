#!/usr/bin/env bash
# ¿El libro puede reconstruir el stock?
#
# Ésta es LA invariante de la que depende el inventario valorizado al cierre
# (ítem 8 del pedido de la contadora): si sumando los movimientos con su signo
# no se llega al stock guardado, entonces no hay forma de decir cuánto había a
# una fecha pasada, y la valuación no se puede calcular.
#
# El hallazgo que motivó este script: de 7 productos con movimientos en la base
# de dev, NINGUNO reconstruía. `createProduct` escribía `stock_current` directo
# sin emitir movimiento de apertura.
#
# ⚠️ Va en un script y no inline en `bash -lc` a propósito: un chequeo cuyo
# resultado "limpio" te haría dejar de buscar tiene que ser legible y
# repetible. Así se coló un hallazgo FALSO antes en este proyecto (un count(*)
# sin GROUP BY tenant_id).
#
# Uso:  ./scripts/reconstruye-stock.sh
# Sale 0 si TODOS los productos reconstruyen, 1 si alguno no.
set -uo pipefail

DB_CONTAINER=$(docker ps --filter "name=supabase_db_" --format "{{.Names}}" | head -1)
if [ -z "$DB_CONTAINER" ]; then
  echo "ERROR: no encontré el container de Postgres. Corré 'pnpm exec supabase start'." >&2
  exit 2
fi

# El stock según el libro = suma de movimientos con su signo (columna
# `direction`, migration 0032). Sin esa columna esta cuenta era imposible: un
# +5 y un −5 eran filas idénticas.
SQL=$(cat <<'EOSQL'
WITH libro AS (
  SELECT product_id,
         SUM(CASE WHEN direction = 'in' THEN qty ELSE -qty END) AS segun_libro
    FROM stock_movements
   GROUP BY product_id
)
SELECT p.tenant_id::text AS tenant,
       p.name,
       p.stock_current   AS guardado,
       COALESCE(l.segun_libro, 0) AS segun_libro,
       p.stock_current - COALESCE(l.segun_libro, 0) AS diferencia
  FROM products p
  LEFT JOIN libro l ON l.product_id = p.id
 WHERE p.stock_tracking_enabled
   AND p.stock_current <> COALESCE(l.segun_libro, 0)
 ORDER BY p.tenant_id, p.name;
EOSQL
)

echo "==> Productos cuyo stock NO se reconstruye desde el libro:"
SALIDA=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -A -F'|' -t -c "$SQL")

if [ -z "$SALIDA" ]; then
  echo "    (ninguno — todos reconstruyen)"
  DESCUADRADOS=0
else
  echo "$SALIDA" | sed 's/^/    /'
  DESCUADRADOS=$(echo "$SALIDA" | wc -l)
fi

# El total del universo medido, para que el "0 descuadrados" no pueda venir de
# haber contado cero productos. Un cero sin denominador no prueba nada.
TOTAL=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -A -t -c \
  "SELECT count(*) FROM products WHERE stock_tracking_enabled")
CON_MOVS=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -A -t -c \
  "SELECT count(DISTINCT product_id) FROM stock_movements")

echo ""
echo "    descuadrados: $DESCUADRADOS  /  productos con tracking: $TOTAL  (con movimientos: $CON_MOVS)"

[ "$DESCUADRADOS" -eq 0 ]
