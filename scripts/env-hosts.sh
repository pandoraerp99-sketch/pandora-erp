#!/usr/bin/env bash
# Qué host de Supabase/Postgres define cada archivo .env*, SIN mostrar claves
# ni contraseñas. Para diagnosticar a qué base apunta cada modo (dev/build/test).
set -u
cd ~/workspace/pandora-erp || exit 1
for f in .env*; do
  echo "== $f"
  grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL|DATABASE_URL|NODE_ENV)=' "$f" \
    | sed -E 's#(://)[^@/]*@#\1***@#' \
    | sed -E 's#^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL|DATABASE_URL)=([a-z]+://[^/?]*).*#\1=\2#'
done
echo "== variables exportadas en la shell"
env | grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL|DATABASE_URL)=' | sed -E 's#=.*#=(definida)#' || echo "(ninguna)"
