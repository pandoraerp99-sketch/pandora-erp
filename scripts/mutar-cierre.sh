#!/usr/bin/env bash
# RED por mutación sobre caja y deudores AL CIERRE
# (tests/unit/caja-al-cierre.test.ts + T-CIERRE-01).
#
# Los dos ítems ya figuraban ✅ en la evidencia y no los entregaba nadie: acá
# lo que se verifica es que los tests fallen cuando el reporte deja de mirar lo
# que tiene que mirar. Se decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

REPORTE=src/lib/services/reporting/cierre.report.ts
PURA=src/lib/domain/caja-al-cierre.ts
cp "$REPORTE" /tmp/mut-cierre-reporte.bak
cp "$PURA" /tmp/mut-cierre-pura.bak
restaurar() { cp /tmp/mut-cierre-reporte.bak "$REPORTE"; cp /tmp/mut-cierre-pura.bak "$PURA"; }
trap restaurar EXIT

correr() {
  if pnpm vitest run tests/unit/caja-al-cierre.test.ts >/tmp/mut-cierre.txt 2>&1 \
     && pnpm test:integration --no-file-parallelism T-CIERRE-01 >>/tmp/mut-cierre.txt 2>&1; then
    echo 0
  else
    echo 1
  fi
}

NO_ATRAPADAS=0
mutar() {
  local archivo="$1" expr="$2" nombre="$3"
  cp "$archivo" /tmp/mut-cierre-antes
  perl -0pi -e "$expr" "$archivo"
  if cmp -s "$archivo" /tmp/mut-cierre-antes; then
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
echo "==> Mutaciones — reporte (SQL)"

mutar "$REPORTE" 's/SELECT DISTINCT ON \(sale_point\)/SELECT/' \
  "suma TODOS los turnos en vez del último arqueo de cada caja"
# OJO con el ancla: `perl -0pi -e 's///'` sin /g cambia la PRIMERA ocurrencia, y
# la primera de "ORDER BY sale_point, closed_at DESC" está en el COMENTARIO que
# explica la consulta. Mutar un comentario no cambia nada y la mutación sale
# "no atrapada" sin que haya un agujero real. Se ancla al principio de línea.
mutar "$REPORTE" 's/\n(\s+)ORDER BY sale_point, closed_at DESC/\n$1ORDER BY sale_point, closed_at ASC/' \
  "toma el arqueo más VIEJO de cada caja"
mutar "$REPORTE" 's/\(\$\{fechaCierre\}::date \+ 1\)/\${fechaCierre}::date/' \
  "el día del cierre queda afuera (el arqueo de las 22:00 se pierde)"
mutar "$REPORTE" "s/AT TIME ZONE \\\$\{TZ_COMERCIO\}, 'YYYY-MM-DD'\) AS fecha/AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS fecha/" \
  "la fecha del arqueo se lee en UTC y cambia de día"
mutar "$REPORTE" 's/AND \(closed_at IS NULL OR closed_at >= \$\{finDelDia\(fechaCierre\)\}\)/AND closed_at IS NULL/' \
  "la caja que se contó DESPUÉS del cierre deja de avisarse"
mutar "$REPORTE" 's/AND m\.created_at < \$\{finDelDia\(fechaCierre\)\}//' \
  "los deudores salen a HOY y no al cierre"
mutar "$REPORTE" "s/SUM\(CASE WHEN m\.type = 'payment' THEN -m\.amount ELSE m\.amount END\)::text AS saldo/SUM(m.amount)::text AS saldo/" \
  "los pagos no restan: todos figuran debiendo el total fiado"
mutar "$REPORTE" "s/COALESCE\(c\.doc_number, ''\)   AS doc_numero/'' AS doc_numero/" \
  "el CSV va sin CUIT, que es la mitad de lo que pide el ítem 5"
mutar "$REPORTE" 's/fecha en que se REGISTRO cada movimiento/fecha de la operacion/' \
  "el CSV deja de declarar por dónde corta"
mutar "$REPORTE" 's/Es el EFECTIVO contado en el arqueo /Es el total de la caja /' \
  "el CSV de caja deja de decir que es sólo efectivo"
mutar "$REPORTE" 's/Cada arqueo se atribuye al dia en que SE CONTO/Cada arqueo corresponde al turno/' \
  "el CSV deja de avisar que la caja contada a las 02:00 cae al día siguiente"

echo ""
echo "==> Mutaciones — capa pura"

mutar "$PURA" "s/estado: todosDelDia \? 'contado' : 'anterior'/estado: 'contado'/" \
  "un arqueo viejo se presenta como si fuera del día del cierre"
mutar "$PURA" "s/return \{ fecha: fechaCierre, estado: 'sin_datos', total: null, puntos: \[\], abiertas \};/return { fecha: fechaCierre, estado: 'sin_datos', total: '0.0000', puntos: [], abiertas };/" \
  "sin ningún arqueo inventa un \$0 (se leería como caja vacía)"
mutar "$PURA" 's/acc\.plus\(new Decimal\(a\.contado\)\)/acc.plus(new Decimal(a.contado)).plus(0)/;s/const total = arqueos\.reduce\(/const total = arqueos.slice(1).reduce(/' \
  "el total se saltea la primera caja"

echo ""
if [ "$NO_ATRAPADAS" -eq 0 ]; then
  echo "==> Todas las mutaciones atrapadas"
  exit 0
fi
echo "==> $NO_ATRAPADAS mutación(es) NO atrapada(s)"
exit 1
