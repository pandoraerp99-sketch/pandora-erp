#!/usr/bin/env bash
# Aplica la migración 0046 (flete de una compra) a la base de dev y verifica que quedó.
set -u
cd ~/workspace/pandora-erp || exit 1
CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < drizzle/migrations/post_initial/0046_flete_de_compra.sql || exit 1

echo "== verificación =="
docker exec -i "$CONT" psql -U postgres -d postgres -t -c "
  SELECT 'columna: ' || count(*) FROM information_schema.columns
   WHERE table_name = 'expenses' AND column_name = 'flete_de_compra_id';
  SELECT 'constraints: ' || string_agg(conname, ', ' ORDER BY conname) FROM pg_constraint
   WHERE conname IN ('expenses_flete_de_compra_fk', 'expenses_flete_no_es_su_compra');
  SELECT 'indice: ' || count(*) FROM pg_indexes WHERE indexname = 'expenses_flete_de_compra_idx';
"
