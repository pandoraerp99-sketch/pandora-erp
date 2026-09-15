#!/usr/bin/env bash
# RED por mutación sobre el bloque de merma y valor del stock
# (T-PANEL-02 + tests/unit/merma.test.ts).
#
# El reporte se escribió antes que el test de integración: sin estas
# mutaciones, que el test pase no prueba que mire lo que tiene que mirar.
# Cada mutación verifica que el archivo CAMBIÓ. Se decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

REPORTE=src/lib/services/reporting/merma.report.ts
PURA=src/lib/reporting/merma.ts
cp "$REPORTE" /tmp/mut-merma-reporte.bak
cp "$PURA" /tmp/mut-merma-pura.bak
restaurar() { cp /tmp/mut-merma-reporte.bak "$REPORTE"; cp /tmp/mut-merma-pura.bak "$PURA"; }
trap restaurar EXIT

correr() {
  if pnpm vitest run tests/unit/merma.test.ts >/tmp/mut-merma.txt 2>&1 \
     && pnpm test:integration --no-file-parallelism T-PANEL-02 >>/tmp/mut-merma.txt 2>&1; then
    echo 0
  else
    echo 1
  fi
}

NO_ATRAPADAS=0
mutar() {
  local archivo="$1" expr="$2" nombre="$3"
  cp "$archivo" /tmp/mut-merma-antes
  perl -0pi -e "$expr" "$archivo"
  if cmp -s "$archivo" /tmp/mut-merma-antes; then
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

mutar "$REPORTE" 's/\n\s*AND m\.motivo IS NOT NULL//' \
  "las correcciones cuentan el stock inicial y la compra anulada"
mutar "$REPORTE" 's/m\.fecha >= \$\{INICIO_MES\} AND //' \
  "la merma del mes pasado entra"
mutar "$REPORTE" "s/ AND m\.fecha < \(\\\$\{INICIO_MES\} \+ interval '1 month'\)::date//" \
  "la merma del mes que viene entra"
mutar "$REPORTE" 's/WHERE m\.tenant_id = \$\{tenantId\}\n(\s*)AND m\.type = .loss.\n(\s*)AND \$\{DEL_MES\}\n(\s*)GROUP BY m\.motivo/WHERE true\n$1AND m.type = '"'"'loss'"'"'\n$2AND \${DEL_MES}\n$3GROUP BY m.motivo/' \
  "la merma por motivo no filtra por comercio"
mutar "$REPORTE" 's/coalesce\(sum\(m\.qty\) FILTER \(WHERE p\.cost IS NULL\), 0\)/coalesce(sum(m.qty) FILTER (WHERE false), 0)/' \
  "las unidades sin costo desaparecen"
mutar "$REPORTE" 's/\n\s*AND is_active//' \
  "el valor del stock suma productos dados de baja"
mutar "$REPORTE" 's/\n\s*AND stock_tracking_enabled//' \
  "el valor del stock suma servicios sin control de stock"
mutar "$REPORTE" 's/count\(\*\) FILTER \(WHERE cost IS NULL\)::text AS productos_sin_costo/0::text AS productos_sin_costo/' \
  "el valor del stock no cuenta los productos sin costo"

echo ""
echo "==> Mutaciones — capa pura"

mutar "$PURA" "s/: sinCosto\.eq\(unidades\)\n(\s*)\? 'sin_costo'/: false\n\$1? 'sin_costo'/" \
  "toda la merma sin costo se muestra como \$0 en vez de sin_costo"
mutar "$PURA" 's/if \(a\.costo === null\) return 1;/if (a.costo === null) return -1;/' \
  "los productos sin costo se ordenan arriba"
mutar "$PURA" 's/hayPesos && costo\.gt\(0\) \? /true ? /' \
  "la participación divide por cero"

echo ""
if [ "$NO_ATRAPADAS" -eq 0 ]; then
  echo "==> Todas las mutaciones atrapadas"
  exit 0
fi
echo "==> $NO_ATRAPADAS mutación(es) NO atrapada(s)"
exit 1
