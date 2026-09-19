#!/usr/bin/env bash
# Prueba que T-ADJ-01 tenga DIENTES: le saca la proteccion a la base y exige
# que el test se ponga ROJO.
#
# Por que: un test de aislamiento que nunca fallo no prueba aislamiento, prueba
# que la consulta devuelve vacio — y devuelve vacio por muchos motivos (el dato
# no existe, el filtro esta mal, el JWT no tiene company_id). Ya paso en este
# proyecto: `probar-guardia-cross-tenant.sh` nacio por lo mismo.
#
# Cuatro mutaciones sobre garantias reales:
#   1. sin las policies del BUCKET → el vecino baja el archivo
#   2. sin el trigger de la tabla  → el adjunto se borra
#   3. la lista de tipos del service desincronizada de la del bucket
#   4. el path armado SIN el tenant → la policy del bucket no protege nada
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

echo "== mutacion 3: el service permite un tipo que el bucket no =="
# Esta no toca la base: toca el CÓDIGO. El chequeo de tipos vive en
# `aplicar-adjuntos.sh`, que re-aplica la migración antes de comparar — así que
# ensuciar el bucket se curaría solo y el chequeo pasaria igual. El lado que
# puede desincronizarse de verdad es la lista del TS.
TS_ADJ=src/lib/db/schema/attachments.ts
cp "$TS_ADJ" /tmp/attachments.ts.bak
restaurar_ts() { cp /tmp/attachments.ts.bak "$TS_ADJ"; }
sed -i "s|'application/pdf',|'application/pdf',\n  'image/gif',|" "$TS_ADJ"
if bash scripts/aplicar-adjuntos.sh >/tmp/adj-mime.log 2>&1; then
  echo "🔴 tipos desincronizados — el script SIGUIO EN VERDE"
  fallos=$((fallos + 1))
else
  echo "✅ tipos desincronizados — el script fallo"
fi
restaurar_ts

echo "== mutacion 4: el path se arma SIN el tenant =="
# La garantia central del slice 2. Si el path deja de llevar el tenant, los
# comprobantes de todos los comercios caen en la raiz del bucket y la policy
# `comprobantes_tenant_insert` —que compara el PRIMER SEGMENTO— deja de
# proteger nada. T-ADJ-02 tiene que gritar.
SVC_ADJ=src/lib/services/expenses/attachment.service.ts
cp "$SVC_ADJ" /tmp/attachment.service.ts.bak
restaurar_svc() { cp /tmp/attachment.service.ts.bak "$SVC_ADJ"; }
sed -i 's|const storagePath = `\${tenantId}/\${id}`;|const storagePath = `${id}`;|' "$SVC_ADJ"
if grep -q 'const storagePath = `${id}`;' "$SVC_ADJ"; then
  if bash scripts/correr-integracion.sh T-ADJ-02 >/tmp/adj-path.log 2>&1; then
    echo "🔴 path sin tenant — el test SIGUIO EN VERDE"
    fallos=$((fallos + 1))
  else
    echo "✅ path sin tenant — el test se puso rojo"
  fi
else
  # Si el sed no engancho, la mutacion nunca se aplico y un "verde" de abajo
  # no significaria nada. Se dice, no se calla.
  echo "🔴 la mutacion 4 NO se aplico (cambio el codigo del path?)"
  fallos=$((fallos + 1))
fi
restaurar_svc

echo "== y con todo en su lugar, verde =="
if bash scripts/correr-integracion.sh T-ADJ >/tmp/adj-ok.log 2>&1; then
  echo "✅ con todo restaurado, T-ADJ-01 y T-ADJ-02 en verde"
else
  echo "🔴 con todo restaurado los tests FALLAN — quedo algo roto"
  fallos=$((fallos + 1))
fi

if [ "$fallos" -ne 0 ]; then
  echo "GUARDIA DE ADJUNTOS: $fallos problema(s)"
  exit 1
fi
echo "GUARDIA DE ADJUNTOS OK (4 mutaciones atrapadas)"
