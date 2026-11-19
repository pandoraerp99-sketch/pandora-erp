#!/usr/bin/env bash
# Estado de la base de DEV para el recorrido de pedidos: comercio del usuario
# de prueba, caja abierta y pedidos cargados. Sólo lectura.
set -u
cd ~/workspace/pandora-erp || exit 1
CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
[ -z "$CONT" ] && { echo "🔴 sin container supabase_db"; exit 1; }
docker exec -i "$CONT" psql -U postgres -d postgres -t -A -F' | ' -c "
WITH yo AS (
  SELECT u.id AS user_id, cu.company_id, cu.role
    FROM users u JOIN company_users cu ON cu.user_id = u.id
   WHERE u.email = 'operador@pandora.dev'
)
SELECT 'usuario', user_id::text, company_id::text, role FROM yo
UNION ALL
SELECT 'caja abierta', s.id::text, s.initial_amount::text, s.opened_at::text
  FROM cash_sessions s JOIN yo ON s.tenant_id = yo.company_id
 WHERE s.closed_at IS NULL
UNION ALL
SELECT 'pedidos', count(*)::text, coalesce(max(number),0)::text, ''
  FROM orders o JOIN yo ON o.tenant_id = yo.company_id
UNION ALL
SELECT 'clientes', count(*)::text, '', '' FROM customers c JOIN yo ON c.tenant_id = yo.company_id
UNION ALL
SELECT 'productos', count(*)::text, '', '' FROM products p JOIN yo ON p.tenant_id = yo.company_id;
"
