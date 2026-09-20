#!/usr/bin/env bash
# Qué rol tiene el usuario de dev. Decide si el alta automática de proveedor
# (owner-only, igual que el resto del catálogo) llega a dispararse en dev.
set -u
cd ~/workspace/pandora-erp || exit 1
CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi
docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -c \
  "SELECT u.email, cu.role, c.name AS comercio
     FROM company_users cu
     JOIN users u ON u.id = cu.user_id
     JOIN companies c ON c.id = cu.company_id
    WHERE u.email NOT LIKE '%test.local%'
    ORDER BY u.email;"
