#!/usr/bin/env bash
# ¿La cantidad al cierre y los lotes del inventario usan el MISMO reloj?
#
# Hasta la migration 0037, getInventarioAlCierre filtraba la CANTIDAD por
# stock_movements.created_at (cuándo se cargó) y los LOTES por expenses.fecha
# (la del comprobante). Con un comprobante cargado tarde —el caso normal— caían
# de lados distintos del cierre: en dev, 2 de 3 compras discrepaban al 31/07.
#
# Desde 0037 la cantidad lee stock_movements.fecha. Este script compara esa
# fecha contra la del comprobante para cada movimiento vinculado a un gasto
# (la compra y, si la hubo, su reversa por anulación). Tiene que dar 0.
#
# Imprime también la comparación con created_at, para que se vea que el
# problema era real y no que el chequeo mira mal.
set -euo pipefail

CIERRE="${CIERRE:-2026-07-31}"
CONTENEDOR="${CONTENEDOR:-supabase_db_pandora-erp}"

docker exec -i "$CONTENEDOR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
\pset border 2
\echo '=== Movimientos vinculados a un gasto vs cierre ${CIERRE} ==='
SELECT c.name AS tenant,
       p.name AS producto,
       m.type,
       m.direction,
       m.qty::text AS unidades,
       (m.created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date::text AS cargado,
       m.fecha::text AS fecha_mov,
       e.fecha::text AS comprobante,
       CASE WHEN m.fecha = e.fecha THEN 'coinciden' ELSE '>>> DISCREPAN <<<' END AS fecha_vs_comprobante
  FROM stock_movements m
  JOIN companies c ON c.id = m.tenant_id
  JOIN products p ON p.id = m.product_id
  JOIN expenses e ON e.id = m.related_expense_id
 ORDER BY c.name, p.name, m.created_at;

\echo ''
\echo '=== Resumen: cuántos discrepan con cada reloj ==='
SELECT c.name AS tenant,
       count(*) AS movimientos,
       count(*) FILTER (
         WHERE ((m.created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date <= DATE '${CIERRE}')
               <> (e.fecha <= DATE '${CIERRE}')
       ) AS discrepan_con_created_at,
       count(*) FILTER (
         WHERE (m.fecha <= DATE '${CIERRE}') <> (e.fecha <= DATE '${CIERRE}')
       ) AS discrepan_con_fecha
  FROM stock_movements m
  JOIN companies c ON c.id = m.tenant_id
  JOIN expenses e ON e.id = m.related_expense_id
 GROUP BY c.name;
SQL
