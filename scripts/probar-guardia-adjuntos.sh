#!/usr/bin/env bash
# Prueba que T-ADJ-01 tenga DIENTES: le saca la proteccion a la base y exige
# que el test se ponga ROJO.
#
# Por que: un test de aislamiento que nunca fallo no prueba aislamiento, prueba
# que la consulta devuelve vacio — y devuelve vacio por muchos motivos (el dato
# no existe, el filtro esta mal, el JWT no tiene company_id). Ya paso en este
# proyecto: `probar-guardia-cross-tenant.sh` nacio por lo mismo.
#
# Ocho mutaciones sobre garantias reales:
#   1. sin las policies del BUCKET → el vecino baja el archivo
#   2. sin el trigger de la tabla  → el adjunto se borra
#   3. la lista de tipos del service desincronizada de la del bucket
#   4. el path armado SIN el tenant → la policy del bucket no protege nada
#   5. sin la policy de DELETE de la 0042 → la compensacion vuelve a ser muda
#   6. el contrato vencido deja de marcarse → se pierde el respaldo de medio año
#   7. la lista blanca deja entrar a la contadora → vuelve a poder escribir
#   8. la descarga deja de mirar el tipo → la contadora baja un contrato (B-11)
#
# El estado se restaura SIEMPRE (trap), re-aplicando la 0040.
set -u
cd ~/workspace/pandora-erp || exit 1

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

psql_() { docker exec -i "$CONT" psql -U postgres -d postgres -q "$@"; }

fallos=0

restaurar() {
  echo "-- restaurando 0040 + 0041 + 0042 --"
  for m in 0040_adjuntos_comprobantes 0041_adjuntos_fk_con_tenant \
           0042_adjuntos_borrar_solo_huerfanos; do
    docker exec -i "$CONT" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
      < "drizzle/migrations/post_initial/${m}.sql" >/dev/null || {
        echo "🔴 no se pudo restaurar ${m} — la base queda DESPROTEGIDA"
        # 🔴 Antes esto solo hacia `return 1` y el script imprimia
        # "GUARDIA OK" igual, porque nadie miraba ese return: el guarda
        # terminaba en verde dejando la base sin proteccion. Es exactamente la
        # forma de falso verde que este script existe para cazar, adentro del
        # script. Ahora suma al contador.
        fallos=$((fallos + 1))
        return 1
      }
  done
}
trap restaurar EXIT


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

echo "== mutacion 5: sin el permiso de borrar el huerfano (0042) =="
# Esta mutacion es la que mas importa de todas, porque el bug que la 0042
# arregla NO daba error: `remove()` devolvia `data: [], error: null` y el
# objeto quedaba. Ningun test lo veia — el almacen falso probaba que el service
# LLAMA a borrar, no que borrar pueda borrar.
psql_ -c "DROP POLICY IF EXISTS comprobantes_borrar_huerfano ON storage.objects;" >/dev/null
if bash scripts/probar-storage-real.sh >/tmp/adj-rm.log 2>&1; then
  echo "🔴 sin la policy de DELETE — la vuelta real SIGUIO EN VERDE (el borrado mudo volvio)"
  fallos=$((fallos + 1))
else
  echo "✅ sin la policy de DELETE — la vuelta real fallo"
fi
restaurar

echo "== mutacion 6: el contrato vencido deja de marcarse =="
# La vigencia es donde mas facil se confunde "cuando rige" con "si vale". Un
# contrato que termino en junio respaldo los seis pagos que cubrio; si la marca
# se apaga (o peor, si alguien "limpia" la lista escondiendolos), la contadora
# deja de ver el respaldo de medio año y nada falla.
cp "$SVC_ADJ" /tmp/attachment.service.ts.bak2
restaurar_svc2() { cp /tmp/attachment.service.ts.bak2 "$SVC_ADJ"; }
sed -i 's|vencido: f.vigencia_hasta !== null \&\& f.vigencia_hasta < hoy,|vencido: false,|' "$SVC_ADJ"
if grep -q 'vencido: false,' "$SVC_ADJ"; then
  if bash scripts/correr-integracion.sh T-ADJ-04 >/tmp/adj-vig.log 2>&1; then
    echo "🔴 vencido sin marcar — el test SIGUIO EN VERDE"
    fallos=$((fallos + 1))
  else
    echo "✅ vencido sin marcar — el test se puso rojo"
  fi
else
  echo "🔴 la mutacion 6 NO se aplico (cambio el calculo de la vigencia?)"
  fallos=$((fallos + 1))
fi
restaurar_svc2

echo "== mutacion 7: la contadora vuelve a poder escribir =="
# El agujero del slice 4: nada impedia que el rol `accountant` subiera un
# comprobante, subiera un contrato o diera uno de baja. Ni la pantalla
# (esconder un boton no es autorizacion, CLAUDE.md §6.4) ni el RLS — Drizzle
# entra como `postgres` con rolbypassrls=true, medido en
# scripts/ver-rol-de-la-conexion.sh.
#
# Se ensancha la lista blanca, que es exactamente como se volveria a abrir sin
# querer: agregando un rol "porque hacia falta para otra cosa".
cp "$SVC_ADJ" /tmp/attachment.service.ts.bak3
restaurar_svc3() { cp /tmp/attachment.service.ts.bak3 "$SVC_ADJ"; }
sed -i "s|\['owner', 'admin', 'cashier'\]|['owner', 'admin', 'cashier', 'accountant']|" "$SVC_ADJ"
if grep -q "'accountant'\]" "$SVC_ADJ"; then
  if bash scripts/correr-integracion.sh T-ADJ-05 >/tmp/adj-rol.log 2>&1; then
    echo "🔴 contadora con permiso de escribir — el test SIGUIO EN VERDE"
    fallos=$((fallos + 1))
  else
    echo "✅ contadora con permiso de escribir — el test se puso rojo"
  fi
else
  echo "🔴 la mutacion 7 NO se aplico (cambio la lista blanca?)"
  fallos=$((fallos + 1))
fi
restaurar_svc3

echo "== mutacion 8: el contrato vuelve a bajarse con el id =="
# B-11. La primera version del slice 4 excluia los contratos de la LISTA de
# /contador y lo daba por cerrado; pero `urlParaDescargar` no miraba el tipo,
# asi que con el id —que se consigue desde /gastos— la contadora bajaba el
# contrato igual. Esconder de una lista no es cerrar. Se apaga el chequeo
# por tipo y T-ADJ-05 tiene que gritar.
cp "$SVC_ADJ" /tmp/attachment.service.ts.bak4
restaurar_svc4() { cp /tmp/attachment.service.ts.bak4 "$SVC_ADJ"; }
sed -i "s|if (fila.tipo === 'contrato') {|if (false) {|" "$SVC_ADJ"
if grep -q "if (false) {" "$SVC_ADJ"; then
  if bash scripts/correr-integracion.sh T-ADJ-05 >/tmp/adj-contrato.log 2>&1; then
    echo "🔴 contrato sin chequeo de tipo — el test SIGUIO EN VERDE"
    fallos=$((fallos + 1))
  else
    echo "✅ contrato sin chequeo de tipo — el test se puso rojo"
  fi
else
  echo "🔴 la mutacion 8 NO se aplico (cambio el chequeo del tipo?)"
  fallos=$((fallos + 1))
fi
restaurar_svc4

# Restauracion EXPLICITA antes del veredicto. El `trap` corre al salir, o sea
# DESPUES del "GUARDIA OK": si fallaba ahi, el 🔴 aparecia debajo de un verde ya
# impreso y con codigo de salida 0. Un ultimo falso verde, en el script que
# existe para cazarlos.
restaurar

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
echo "GUARDIA DE ADJUNTOS OK (8 mutaciones atrapadas)"
