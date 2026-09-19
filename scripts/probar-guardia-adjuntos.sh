#!/usr/bin/env bash
# Prueba que T-ADJ-01 tenga DIENTES: le saca la proteccion a la base y exige
# que el test se ponga ROJO.
#
# Por que: un test de aislamiento que nunca fallo no prueba aislamiento, prueba
# que la consulta devuelve vacio — y devuelve vacio por muchos motivos (el dato
# no existe, el filtro esta mal, el JWT no tiene company_id). Ya paso en este
# proyecto: `probar-guardia-cross-tenant.sh` nacio por lo mismo.
#
# Dos mutaciones, las dos sobre la garantia real:
#   1. sin las policies del BUCKET → el vecino baja el archivo
#   2. sin el trigger de la tabla  → el adjunto se borra
#
# El estado se restaura SIEMPRE (trap), re-aplicando la 0040.
set -u
cd ~/workspace/pandora-erp || exit 1

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

psql_() { docker exec -i "$CONT" psql -U postgres -d postgres -q "$@"; }

restaurar() {
  echo "-- restaurando 0040 + 0041 --"
  for m in 0040_adjuntos_comprobantes 0041_adjuntos_fk_con_tenant; do
    docker exec -i "$CONT" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
      < "drizzle/migrations/post_initial/${m}.sql" >/dev/null || {
        echo "🔴 no se pudo restaurar ${m} — la base queda DESPROTEGIDA"
        return 1
      }
  done
}
trap restaurar EXIT

fallos=0

esperar_rojo() {
  local caso="$1"
  if bash scripts/correr-integracion.sh T-ADJ-01 >/tmp/adj-mut.log 2>&1; then
    echo "🔴 $caso — el test SIGUIO EN VERDE (no tiene dientes)"
    fallos=$((fallos + 1))
  else
    echo "✅ $caso — el test se puso rojo"
  fi
}

echo "== mutacion 1: sin las policies del bucket =="
psql_ -c "DROP POLICY IF EXISTS comprobantes_tenant_select ON storage.objects;
          DROP POLICY IF EXISTS comprobantes_tenant_insert ON storage.objects;" >/dev/null
esperar_rojo "policies del bucket borradas"
restaurar

echo "== mutacion 2: sin el trigger que impide borrar el adjunto =="
psql_ -c "DROP TRIGGER IF EXISTS attachments_no_delete ON attachments;" >/dev/null
esperar_rojo "trigger de DELETE borrado"
restaurar

echo "== y con todo en su lugar, verde =="
if bash scripts/correr-integracion.sh T-ADJ-01 >/tmp/adj-ok.log 2>&1; then
  echo "✅ con la 0040 intacta: verde"
else
  echo "🔴 con la 0040 intacta el test FALLA — esta roto"
  fallos=$((fallos + 1))
fi

if [ "$fallos" -ne 0 ]; then
  echo "GUARDIA DE ADJUNTOS: $fallos problema(s)"
  exit 1
fi
echo "GUARDIA DE ADJUNTOS OK (2 mutaciones atrapadas)"
