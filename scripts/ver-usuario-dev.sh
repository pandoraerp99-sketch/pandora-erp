#!/usr/bin/env bash
# ¿Existe el operador de dev y tiene empresa? Es lo primero que hay que
# descartar cuando las capturas quedan trabadas en /login: una base reseteada
# se ve igual que un bug de hidratación.
set -u
cd ~/workspace/pandora-erp || exit 1

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -c \
"SELECT u.email,
        (au.id IS NOT NULL) AS tiene_login_auth,
        au.email_confirmed_at IS NOT NULL AS confirmado,
        cu.role,
        c.name AS empresa
   FROM users u
   LEFT JOIN auth.users au ON au.id = u.id
   LEFT JOIN company_users cu ON cu.user_id = u.id
   LEFT JOIN companies c ON c.id = cu.company_id
  ORDER BY u.email;"
