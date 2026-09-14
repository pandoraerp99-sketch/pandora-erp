#!/usr/bin/env bash
# RED por mutación sobre el mes del comercio en la serie de Clientes.
#
# Se revierte UNA pieza por vez al reloj UTC y se exige que algún test se ponga
# en rojo. Cada mutación verifica que el archivo CAMBIÓ antes de correr.
# Se decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

SERVICIO=src/lib/services/customers/customer.service.ts
DOMINIO=src/lib/domain/fecha-comercio.ts
cp "$SERVICIO" /tmp/mut-mes-servicio.bak
cp "$DOMINIO" /tmp/mut-mes-dominio.bak
restaurar() { cp /tmp/mut-mes-servicio.bak "$SERVICIO"; cp /tmp/mut-mes-dominio.bak "$DOMINIO"; }
trap restaurar EXIT

correr() {
  if pnpm vitest run tests/unit/meses-del-comercio.test.ts >/tmp/mut-mes.txt 2>&1 \
     && pnpm test:integration --no-file-parallelism T-CUST-02 >>/tmp/mut-mes.txt 2>&1; then
    echo 0
  else
    echo 1
  fi
}

NO_ATRAPADAS=0
mutar() {
  local archivo="$1" expr="$2" nombre="$3"
  cp "$archivo" /tmp/mut-mes-antes
  perl -0pi -e "$expr" "$archivo"
  if cmp -s "$archivo" /tmp/mut-mes-antes; then
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

mutar "$SERVICIO" 's/to_char\(created_at AT TIME ZONE \$\{ZONA_COMERCIO\}, /to_char(created_at, /' \
  "la compra se agrupa en el mes UTC"

# NO se muta la ventana del WHERE (`>= date_trunc(... now() ...)`): es un
# mutante EQUIVALENTE. Con el mes agrupado en hora local, una compra que la
# ventana UTC deja entrar de más cae en un mes que no está entre las etiquetas
# y se descarta igual. La ventana es un prefiltro; el filtro real son las
# etiquetas. (Corrida 2026-09-14: "no atrapada" por esto, no por un test flojo.)

mutar "$DOMINIO" 's/const \[y, m\] = diaDelComercio\(ahora\)\.split\(.-.\)\.map\(Number\) as \[number, number\];/const [y, m] = [ahora.getUTCFullYear(), ahora.getUTCMonth() + 1];/' \
  "las etiquetas de mes salen del reloj UTC"

echo ""
if [ "$NO_ATRAPADAS" -eq 0 ]; then
  echo "==> Todas las mutaciones atrapadas"
  exit 0
fi
echo "==> $NO_ATRAPADAS mutación(es) NO atrapada(s)"
exit 1
