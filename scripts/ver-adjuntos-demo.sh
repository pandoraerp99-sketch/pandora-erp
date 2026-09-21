#!/usr/bin/env bash
# Qué comprobantes adjuntos hay en la base de dev y de qué fecha son.
# La fecha importa: /contador lista por PERÍODO, y un adjunto de un mes viejo
# no aparece en la vista "Mes" aunque exista.
set -u
cd ~/workspace/pandora-erp || exit 1

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -c \
"SELECT e.fecha, e.categoria, coalesce(e.payee_name,'(sin nombre)') AS quien,
        e.total, a.tipo, a.nombre_original
   FROM attachments a
   JOIN expenses e ON e.id = a.expense_id
  WHERE a.removed_at IS NULL
  ORDER BY e.fecha DESC LIMIT 10;"

echo "-- hoy --"
date +%F
