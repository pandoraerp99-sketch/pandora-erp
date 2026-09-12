#!/usr/bin/env bash
# RED por mutación sobre el calendario del comercio en /contador.
#
# Cada consulta del resumen corta el mes por separado. Se revierte UNA por vez
# al corte en UTC y se exige que algún test se ponga en rojo: si una sola se
# quedara en UTC, ese bloque de la pantalla contaría otro mes que los demás.
#
# Cada mutación verifica que el archivo CAMBIÓ antes de correr los tests.
# Se decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

REPORTE=src/lib/services/reporting/accountant.report.ts
cp "$REPORTE" /tmp/mut-periodo.bak
restaurar() { cp /tmp/mut-periodo.bak "$REPORTE"; }
trap restaurar EXIT

correr() {
  if pnpm vitest run tests/unit/periodo-ejercicio.test.ts >/tmp/mut-periodo.txt 2>&1 \
     && pnpm test:integration --no-file-parallelism T-CONT-02 >>/tmp/mut-periodo.txt 2>&1; then
    echo 0
  else
    echo 1
  fi
}

NO_ATRAPADAS=0
mutar() {
  local expr="$1" nombre="$2"
  cp "$REPORTE" /tmp/mut-periodo-antes
  perl -0pi -e "$expr" "$REPORTE"
  if cmp -s "$REPORTE" /tmp/mut-periodo-antes; then
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

UTC_DESDE='${periodo.desde.toISOString()}::timestamptz'

echo "==> Verde de partida (sin mutar)"
if [ "$(correr)" -ne 0 ]; then
  echo "  🔴 Ya está en rojo sin mutar. Abortando."
  exit 1
fi
echo "  OK"
echo ""
echo "==> Mutaciones"

mutar 's/const \[y, m\] = diaDelComercio\(fecha\)\.split\(.-.\)\.map\(Number\);\n  return \{ y: y!, m: m! - 1 \};/return { y: fecha.getUTCFullYear(), m: fecha.getUTCMonth() };/' \
  "el mes/año/ejercicio se elige con el reloj UTC"

mutar 's/AND created_at >= \$\{inicioDelDia\(periodo\.desde\)\}/AND created_at >= \${periodo.desde.toISOString()}::timestamptz/' \
  "ventas del resumen cortan el mes en UTC"

mutar 's/AND s\.created_at >= \$\{inicioDelDia\(periodo\.desde\)\}(\n\s+AND s\.created_at <  \$\{inicioDelDia\(periodo\.hasta\)\}\n\s+-- Activo)/AND s.created_at >= \${periodo.desde.toISOString()}::timestamptz$1/' \
  "cobros por medio cortan el mes en UTC"

mutar 's/AND closed_at >= \$\{inicioDelDia\(periodo\.desde\)\}/AND closed_at >= \${periodo.desde.toISOString()}::timestamptz/' \
  "cierres de caja cortan el mes en UTC"

mutar 's/AND s\.created_at >= \$\{inicioDelDia\(periodo\.desde\)\}(\n\s+AND s\.created_at <  \$\{inicioDelDia\(periodo\.hasta\)\}\n\s+ORDER BY)/AND s.created_at >= \${periodo.desde.toISOString()}::timestamptz$1/' \
  "el export de ventas corta el mes en UTC"

mutar 's/to_char\(s\.created_at AT TIME ZONE \$\{TZ_COMERCIO\}, /to_char(s.created_at, /' \
  "el CSV fecha las ventas con el día UTC"

echo ""
if [ "$NO_ATRAPADAS" -eq 0 ]; then
  echo "==> Todas las mutaciones atrapadas"
  exit 0
fi
echo "==> $NO_ATRAPADAS mutación(es) NO atrapada(s)"
exit 1
