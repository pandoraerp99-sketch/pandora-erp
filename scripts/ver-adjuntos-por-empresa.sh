#!/usr/bin/env bash
# De qué empresa y de qué fechas son los adjuntos de la base de dev.
# Es lo que hay que mirar cuando /contador lista vacío: el filtro es
# (tenant, período, tipo) y cualquiera de los tres explica un vacío legítimo.
set -u
cd ~/workspace/pandora-erp || exit 1

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -c \
"SELECT a.tenant_id::text AS tenant,
        coalesce(c.name,'(empresa borrada)') AS empresa,
        a.tipo,
        count(*)   AS cant,
        min(e.fecha) AS desde,
        max(e.fecha) AS hasta
   FROM attachments a
   JOIN expenses e ON e.id = a.expense_id
   LEFT JOIN companies c ON c.id = a.tenant_id
  WHERE a.removed_at IS NULL
  GROUP BY 1,2,3
  ORDER BY cant DESC;"

echo "-- empresa del operador de dev --"
docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -c \
"SELECT c.id::text, c.name
   FROM companies c
   JOIN company_users cu ON cu.company_id = c.id
   JOIN users u ON u.id = cu.user_id
  WHERE u.email = 'operador@pandora.dev';"
