#!/usr/bin/env bash
# ¿Los gastos apuntan a un `tercero` o el proveedor es un nombre tipeado?
#
# Decide el slice 3: si el contrato cuelga del tercero y ningún gasto apunta a
# ese tercero, el PDF queda atado a una fila que la contadora no puede unir con
# la deducción — un archivo colgando de un string.
#
# Va en script y no inline: el `count(*)` sin agrupar por tenant ya me hizo
# reportar un hallazgo FALSO antes.
set -u
cd ~/workspace/pandora-erp || exit 1

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -c "
  SELECT c.name AS comercio,
         e.categoria,
         count(*)                                   AS gastos,
         count(e.tercero_id)                        AS con_tercero,
         count(*) - count(e.tercero_id)             AS sin_tercero,
         count(*) FILTER (WHERE e.payee_doc IS NOT NULL) AS con_cuit
    FROM expenses e
    JOIN companies c ON c.id = e.tenant_id
   WHERE e.total > 0
   GROUP BY c.name, e.categoria
   ORDER BY c.name, e.categoria;
"

echo "-- ¿la tabla terceros guarda CUIT o domicilio? --"
docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -c "
  SELECT column_name, data_type
    FROM information_schema.columns
   WHERE table_name = 'terceros'
   ORDER BY ordinal_position;
"
