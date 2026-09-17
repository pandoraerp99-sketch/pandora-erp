#!/usr/bin/env bash
# Aplica SOLO la migración 0039 a la base de dev, y verifica que quedó.
#
# Va en un script y no en un `bash -lc` inline por la regla de siempre: un
# chequeo que se escribe a mano cada vez es un chequeo que un día sale distinto.
set -u
cd ~/workspace/pandora-erp || exit 1
set -a; . ./.env.test 2>/dev/null || true; set +a

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres \
  < drizzle/migrations/post_initial/0039_cuenta_corriente_proveedores.sql || exit 1

echo "== verificación =="
docker exec -i "$CONT" psql -U postgres -d postgres -t -c "
  SELECT 'tabla: ' || count(*)::text FROM information_schema.tables
    WHERE table_name = 'supplier_account_movements';
  SELECT 'triggers: ' || count(*)::text FROM pg_trigger
    WHERE tgrelid = 'supplier_account_movements'::regclass AND NOT tgisinternal;
  SELECT 'rls: ' || relrowsecurity::text FROM pg_class
    WHERE relname = 'supplier_account_movements';
  -- TODOS los checks de la columna, no sólo el que esta migración crea:
  -- verificar la existencia de lo que uno acaba de escribir no verifica nada.
  -- Tiene que dar UNA sola fila y con 'cuenta_corriente' adentro.
  SELECT conname || ' -> acepta cuenta_corriente: ' ||
         (pg_get_constraintdef(oid) LIKE '%cuenta_corriente%')::text
    FROM pg_constraint
   WHERE conrelid = 'expenses'::regclass
     AND pg_get_constraintdef(oid) LIKE '%medio_pago = ANY%';
"
