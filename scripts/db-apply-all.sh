#!/usr/bin/env bash
# Aplica TODAS las migraciones al Postgres apuntado por DATABASE_URL.
# Orden: Drizzle managed → post_initial/ (custom plpgsql/triggers/RLS).
#
# **Uso típico contra Supabase Local CLI:**
#   1. pnpm exec supabase start (levanta stack)
#   2. cp .env.test.example .env.test
#   3. export $(grep -v '^#' .env.test | xargs)
#   4. ./scripts/db-apply-all.sh
#
# **psql:** este script usa `docker exec` contra el container `supabase_db_*`
# para evitar dependencia de psql nativo en host. Si querés correr contra
# Supabase managed (cloud) o postgres remoto sin container local, instalar
# postgres-client y cambiar el bloque correspondiente.
#
# **Reset desde cero** (drop schema + reaplicar todo):
#   pnpm exec supabase db reset   # Supabase CLI nativo

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL no está definida." >&2
  echo "Setea .env.test (cp .env.test.example .env.test) y export las vars." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Detectar container postgres del proyecto.
DB_CONTAINER=$(docker ps --filter "label=com.supabase.cli.project=pandora-erp" --filter "name=supabase_db_" --format "{{.Names}}" | head -1)
if [ -z "$DB_CONTAINER" ]; then
  echo "ERROR: no encontré container supabase_db_pandora-erp." >&2
  echo "Corré 'pnpm exec supabase start' primero." >&2
  exit 1
fi

echo "==> Container Postgres detectado: $DB_CONTAINER"

run_sql_file() {
  local sql_file="$1"
  echo "    → $sql_file"
  docker exec -i -e PGOPTIONS='--client-min-messages=warning' "$DB_CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$sql_file" 2>&1 | grep -vE '^(NOTICE|SET|BEGIN|COMMIT)$' | tail -10 || true
}

echo ""
echo "==> Aplicando migraciones Drizzle managed (drizzle-kit migrate)..."
pnpm exec drizzle-kit migrate 2>&1 | tail -10

echo ""
echo "==> Aplicando migraciones custom post_initial/..."
for sql_file in drizzle/migrations/post_initial/*.sql; do
  run_sql_file "$sql_file"
done

echo ""
echo "==> Migraciones aplicadas. Schema check (tables en public schema):"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -c "
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;
" 2>&1 | head -40
