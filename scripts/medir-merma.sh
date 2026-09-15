#!/usr/bin/env bash
# Cuánta merma y cuántos ajustes hay en la base de dev, POR TENANT.
# (Un count(*) sin agrupar por tenant cuenta fixtures de tests como datos reales.)
# Uso: bash scripts/medir-merma.sh
set -u
docker exec supabase_db_pandora-erp psql -U postgres -P pager=off -c "
  SELECT c.name AS comercio, m.type, m.direction, m.motivo,
         count(*) AS filas, sum(m.qty)::numeric(19,4) AS unidades,
         min(m.fecha) AS desde, max(m.fecha) AS hasta
  FROM stock_movements m
  JOIN companies c ON c.id = m.tenant_id
  WHERE m.type IN ('loss', 'adjustment')
  GROUP BY c.name, m.type, m.direction, m.motivo
  ORDER BY c.name, m.type, m.motivo;"

echo "== comercios con operación real (ventas cerradas) =="
docker exec supabase_db_pandora-erp psql -U postgres -P pager=off -c "
  SELECT c.name, count(s.*) AS ventas
  FROM companies c JOIN sales s ON s.tenant_id = c.id
  GROUP BY c.name HAVING count(s.*) > 5 ORDER BY 2 DESC LIMIT 5;"

echo "== costo disponible para valorizar la merma =="
docker exec supabase_db_pandora-erp psql -U postgres -P pager=off -c "
  SELECT c.name, m.motivo, m.qty, p.name AS producto, p.cost
  FROM stock_movements m
  JOIN products p ON p.id = m.product_id
  JOIN companies c ON c.id = m.tenant_id
  WHERE m.type = 'loss'
  ORDER BY m.created_at DESC LIMIT 10;"
