#!/usr/bin/env bash
# El inventario al cierre, calculado a mano en SQL para cotejar la pantalla.
#
# No reusa inventario.report.ts: suma el libro y lista los lotes crudos, y la
# cuenta PEPS se hace a la vista con estos números. Sirve para ver que la
# pantalla muestra lo que dice el libro, no para validar la regla (eso lo
# hacen los tests y scripts/dos-relojes.sh).
set -euo pipefail
CIERRE="${CIERRE:-2026-07-31}"
CONTENEDOR="${CONTENEDOR:-supabase_db_pandora-erp}"
TENANT="${TENANT:-11111111-1111-4111-8111-111111111111}"

docker exec -i "$CONTENEDOR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
\pset border 2
\echo '=== Cantidad al ${CIERRE} por producto (libro por fecha) ==='
SELECT p.name, p.cost::text AS costo_declarado,
       sum(CASE WHEN m.direction = 'in' THEN m.qty ELSE -m.qty END)::text AS cantidad
  FROM products p
  JOIN stock_movements m ON m.product_id = p.id AND m.tenant_id = p.tenant_id
 WHERE p.tenant_id = '${TENANT}' AND p.stock_tracking_enabled
   AND m.fecha <= DATE '${CIERRE}'
 GROUP BY p.name, p.cost
 HAVING sum(CASE WHEN m.direction = 'in' THEN m.qty ELSE -m.qty END) <> 0
 ORDER BY p.name;

\echo ''
\echo '=== Lotes vigentes con comprobante <= ${CIERRE} ==='
SELECT p.name, e.fecha::text, ei.qty::text, ei.unit_cost::text,
       (ei.qty * ei.unit_cost)::text AS importe
  FROM expense_items ei
  JOIN expenses e ON e.id = ei.expense_id
  JOIN products p ON p.id = ei.product_id
 WHERE ei.tenant_id = '${TENANT}'
   AND e.fecha <= DATE '${CIERRE}'
   AND e.total > 0
   AND NOT EXISTS (SELECT 1 FROM expenses a WHERE a.corrects_id = e.id)
 ORDER BY p.name, e.fecha DESC;
SQL
