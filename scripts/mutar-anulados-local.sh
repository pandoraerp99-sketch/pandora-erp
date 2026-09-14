#!/usr/bin/env bash
# RED por mutación sobre la pestaña Anulados de /gastos: el corte y la fecha
# mostrada van en la hora del comercio. Se revierte UNA pieza por vez a UTC y
# se exige rojo. Cada mutación verifica que el archivo CAMBIÓ antes de correr.
# Se decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

SERVICIO=src/lib/services/expenses/expense.service.ts
cp "$SERVICIO" /tmp/mut-anul.bak
restaurar() { cp /tmp/mut-anul.bak "$SERVICIO"; }
trap restaurar EXIT

correr() {
  if pnpm test:integration --no-file-parallelism T-GASTOS-03 >/tmp/mut-anul.txt 2>&1; then
    echo 0
  else
    echo 1
  fi
}

NO_ATRAPADAS=0
mutar() {
  local expr="$1" nombre="$2"
  cp "$SERVICIO" /tmp/mut-anul-antes
  perl -0pi -e "$expr" "$SERVICIO"
  if cmp -s "$SERVICIO" /tmp/mut-anul-antes; then
    echo "  ⛔ NO SE APLICÓ (ancla no encontrada): $nombre — abortando"
    exit 2
  fi
  if [ "$(correr)" -ne 0 ]; then
    echo "  OK    — atrapada:  $nombre"
  else
    echo "  🔴 NO ATRAPADA:    $nombre"
    NO_ATRAPADAS=$((NO_ATRAPADAS + 1))
  fi
  restaurar
}

echo "==> Verde de partida (sin mutar)"
if [ "$(correr)" -ne 0 ]; then
  echo "  🔴 Ya está en rojo sin mutar. Abortando."
  exit 1
fi
echo "  OK"
echo ""
echo "==> Mutaciones"

mutar 's/AND a\.created_at >= \(\$\{desde\}::date::timestamp AT TIME ZONE \$\{ZONA_COMERCIO\}\)/AND a.created_at >= \${desde}::date/' \
  "el desde de Anulados corta en medianoche UTC"

mutar 's/AND a\.created_at <  \(\$\{hasta\}::date::timestamp AT TIME ZONE \$\{ZONA_COMERCIO\}\)/AND a.created_at <  \${hasta}::date/' \
  "el hasta de Anulados corta en medianoche UTC"

mutar 's/\(a\.created_at AT TIME ZONE \$\{ZONA_COMERCIO\}\)::date::text AS anulado_el/a.created_at::date::text AS anulado_el/' \
  "la fecha 'anulado el' se muestra en UTC"

echo ""
if [ "$NO_ATRAPADAS" -eq 0 ]; then
  echo "==> Todas las mutaciones atrapadas"
  exit 0
fi
echo "==> $NO_ATRAPADAS mutación(es) NO atrapada(s)"
exit 1
