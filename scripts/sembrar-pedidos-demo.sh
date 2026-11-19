#!/usr/bin/env bash
# Carga en la base de DEV los encargos de pos-preview/pedidos.html (ver el .sql).
# No se repite: si ya están, no hace nada. Nunca contra producción.
set -u
cd ~/workspace/pandora-erp || exit 1
CONT=$(docker ps --format "{{.Names}}" | grep supabase_db | head -1)
[ -z "$CONT" ] && { echo "sin container supabase_db"; exit 1; }
docker exec -i "$CONT" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/seed-pedidos-demo.sql
