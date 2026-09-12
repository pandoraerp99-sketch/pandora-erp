#!/usr/bin/env bash
# ¿La cantidad al cierre y los lotes del inventario usan el MISMO reloj?
#
# getInventarioAlCierre filtra:
#   - la CANTIDAD por stock_movements.created_at  (cuándo se registró)
#   - los LOTES   por expenses.fecha              (la del comprobante)
#
# Para un comprobante cargado después de su fecha — que es el caso normal,
# y el caso para el que se construyó recalcularCostoUltimaCompra — esas dos
# fechas NO son la misma. Este script imprime, para cada movimiento de compra,
# de qué lado del cierre cae según CADA reloj.
set -euo pipefail

CIERRE="${CIERRE:-2026-07-31}"
CONTENEDOR="${CONTENEDOR:-supabase_db_pandora-erp}"

docker exec -i "$CONTENEDOR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
\pset border 2
\echo '=== Movimientos de compra vs cierre ${CIERRE} ==='
SELECT p.name AS producto,
       m.qty::text AS unidades,
       (m.created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date::text AS registrado,
       e.fecha::text AS comprobante,
       CASE WHEN (m.created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date <= DATE '${CIERRE}'
            THEN 'cuenta' ELSE 'NO cuenta' END AS en_la_cantidad,
       CASE WHEN e.fecha IS NULL THEN '-'
            WHEN e.fecha <= DATE '${CIERRE}' THEN 'SI respalda'
            ELSE 'no respalda' END AS en_los_lotes,
       CASE WHEN e.fecha IS NULL THEN 'sin gasto'
            WHEN ((m.created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date <= DATE '${CIERRE}')
                 = (e.fecha <= DATE '${CIERRE}')
            THEN 'coinciden' ELSE '>>> DISCREPAN <<<' END AS veredicto
  FROM stock_movements m
  JOIN products p ON p.id = m.product_id
  LEFT JOIN expenses e ON e.id = m.related_expense_id
 WHERE m.type = 'purchase'
 ORDER BY p.name, m.created_at;

\echo ''
\echo '=== Cuántos movimientos de compra discrepan ==='
SELECT count(*) FILTER (
         WHERE e.fecha IS NOT NULL
           AND ((m.created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date <= DATE '${CIERRE}')
               <> (e.fecha <= DATE '${CIERRE}')
       ) AS discrepan,
       count(*) AS total_compras
  FROM stock_movements m
  LEFT JOIN expenses e ON e.id = m.related_expense_id
 WHERE m.type = 'purchase';
SQL
