#!/usr/bin/env bash
# ¿Quién puede escribir `motivo` en stock_movements, y puede `fecha` venir NULL?
# Base del bloque de merma del Panel: "motivo cargado" = lo declaró una persona.
set -u
cd ~/workspace/pandora-erp || exit 1

echo "== llamadas a recordStockMovement (fuera de su definición) =="
grep -rn 'recordStockMovement(' src --include='*.ts' | grep -v 'export async function'

echo "== quién pasa motivo: =="
grep -rn 'motivo:' src/lib --include='*.ts' | grep -v '^src/lib/inventory/stock.ts' || echo "(nadie fuera de stock.ts)"

echo "== columna fecha: nullability y default =="
docker exec supabase_db_pandora-erp psql -U postgres -At -c "
  SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'stock_movements' AND column_name IN ('fecha', 'motivo');"

echo "== filas loss o adjustment con fecha NULL (todos los tenants) =="
docker exec supabase_db_pandora-erp psql -U postgres -At -c "
  SELECT count(*) FROM stock_movements WHERE fecha IS NULL;"
