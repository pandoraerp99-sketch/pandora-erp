#!/usr/bin/env bash
# ¿La FK de customer_account_movements.customer_id ata el tenant? ¿Quién llama a adjustAccount?
# Uso: bash scripts/fk-cuenta-corriente.sh
set -u
cd "$(dirname "$0")/.."

echo "== migration(es) que crean customer_account_movements =="
grep -rln 'customer_account_movements' supabase/migrations drizzle 2>/dev/null

echo "== FKs / referencias =="
for f in $(grep -rln 'customer_account_movements' supabase/migrations drizzle 2>/dev/null); do
  echo "-- $f"
  grep -n -i 'references\|foreign key\|customer_id' "$f" | head -20
done

echo "== constraints reales en la base =="
docker exec supabase_db_pandora-erp psql -U postgres -At -c "
  SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'public.customer_account_movements'::regclass AND contype IN ('f','c');"

echo "== consumidores de adjustAccount (fuera del service) =="
grep -rn 'adjustAccount' src --include='*.ts' --include='*.tsx' | grep -v 'services/customers/account.service.ts' || echo "(ninguno)"
