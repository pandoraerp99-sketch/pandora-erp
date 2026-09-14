#!/usr/bin/env bash
# Anulaciones de gastos en la base de dev, por tenant, con el instante en UTC y
# en la hora del comercio. Para contrastar la pestaña Anulados de /gastos.
set -u
docker exec -i supabase_db_pandora-erp psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT c.name                                                     AS comercio,
       a.corrects_id IS NOT NULL                                  AS es_anulacion,
       a.created_at                                               AS utc,
       (a.created_at AT TIME ZONE 'America/Argentina/Ushuaia')    AS ushuaia,
       o.fecha                                                    AS fecha_original
  FROM expenses a
  JOIN companies c ON c.id = a.tenant_id
  LEFT JOIN expenses o ON o.id = a.corrects_id
 WHERE a.corrects_id IS NOT NULL
   AND c.name NOT LIKE 'T-%'
 ORDER BY a.created_at DESC
 LIMIT 20;
SQL
