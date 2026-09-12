#!/usr/bin/env bash
# Antes de darle a stock_movements una fecha propia: qué filas hay que
# completar, y cuáles NO se pueden completar sin adivinar.
#
# Siempre por tenant: un count(*) global mezcla fixtures de tests con el
# catálogo real (ver memoria base-de-dev-y-chequeos-en-falso).
set -euo pipefail
CONTENEDOR="${CONTENEDOR:-supabase_db_pandora-erp}"

docker exec -i "$CONTENEDOR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
\pset border 2
\echo '=== Movimientos por tenant y tipo (denominador) ==='
SELECT c.name AS tenant, m.type, count(*) AS filas
  FROM stock_movements m JOIN companies c ON c.id = m.tenant_id
 GROUP BY c.name, m.type ORDER BY c.name, m.type;

\echo ''
\echo '=== Compras: fecha del comprobante vs día de carga ==='
SELECT c.name AS tenant,
       count(*) AS compras,
       count(*) FILTER (WHERE e.fecha <> (m.created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date) AS con_fecha_distinta,
       count(*) FILTER (WHERE m.related_expense_id IS NULL) AS sin_gasto_vinculado
  FROM stock_movements m
  JOIN companies c ON c.id = m.tenant_id
  LEFT JOIN expenses e ON e.id = m.related_expense_id
 WHERE m.type = 'purchase'
 GROUP BY c.name;

\echo ''
\echo '=== Reversas de anulación (no guardan a qué compra pertenecen) ==='
SELECT c.name AS tenant, m.product_id::text, m.qty::text, m.reason,
       (m.created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date::text AS cargada
  FROM stock_movements m JOIN companies c ON c.id = m.tenant_id
 WHERE m.type = 'adjustment' AND m.reason LIKE 'Anulación de compra%'
 ORDER BY c.name, m.created_at;
SQL
