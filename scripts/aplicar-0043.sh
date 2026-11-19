#!/usr/bin/env bash
# Aplica la migración 0043 (pedidos) a la base de dev y verifica que quedó.
# En un script y no inline: un chequeo escrito a mano cada vez sale distinto.
set -u
cd ~/workspace/pandora-erp || exit 1
CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < drizzle/migrations/post_initial/0043_pedidos.sql || exit 1

echo "== verificación =="
docker exec -i "$CONT" psql -U postgres -d postgres -t -c "
  SELECT t || ': rls=' || c.relrowsecurity::text
    || ' triggers=' || (SELECT count(*) FROM pg_trigger g WHERE g.tgrelid = c.oid AND NOT g.tgisinternal)::text
    || ' checks+fks=' || (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype IN ('c','f'))::text
  FROM unnest(ARRAY['orders','order_items','order_payments']) AS t
  JOIN pg_class c ON c.relname = t;
"
