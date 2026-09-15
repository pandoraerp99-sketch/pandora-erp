#!/usr/bin/env bash
# Contraprueba del "Plata en stock" del Panel, producto por producto, con una
# consulta escrita aparte del reporte (si las dos coinciden por la misma razón
# equivocada, al menos acá se ven las filas).
set -u
docker exec supabase_db_pandora-erp psql -U postgres -P pager=off -c "
  SELECT p.name, p.is_active, p.stock_tracking_enabled AS ctrl, p.stock_current AS stock, p.cost,
         CASE WHEN p.cost IS NULL THEN NULL ELSE p.stock_current * p.cost END AS valor
  FROM products p JOIN companies c ON c.id = p.tenant_id
  WHERE c.name = 'Kiosco Demo TDF'
  ORDER BY valor DESC NULLS LAST;"
docker exec supabase_db_pandora-erp psql -U postgres -P pager=off -c "
  SELECT sum(p.stock_current * p.cost) AS total_activos_con_stock
  FROM products p JOIN companies c ON c.id = p.tenant_id
  WHERE c.name = 'Kiosco Demo TDF' AND p.is_active AND p.stock_tracking_enabled AND p.stock_current > 0;"
