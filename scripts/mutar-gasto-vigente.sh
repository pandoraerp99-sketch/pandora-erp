#!/bin/bash
# RED por mutación sobre `GASTO_VIGENTE`.
#
# La regla tiene DOS mitades y cada una tapa un agujero distinto. Un test que
# sólo mire importes deja pasar la caída de `total > 0` sin enterarse. Acá se
# rompe cada mitad por separado y se exige que la suite se ponga en rojo.
#
# Se decide por CÓDIGO DE SALIDA, nunca parseando el texto de vitest: la salida
# trae códigos ANSI y cualquier regex sobre eso da falsos verdes.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

ARCHIVO=src/lib/db/schema/expenses.ts
BACKUP=/tmp/expenses-schema-original.ts
cp "$ARCHIVO" "$BACKUP"

restaurar() { cp "$BACKUP" "$ARCHIVO"; }
trap restaurar EXIT

correr() {
  pnpm test:integration --no-file-parallelism T-GASTOS-02 >/tmp/mut-salida.txt 2>&1
  echo $?
}

probar() {
  local nombre="$1"
  local codigo
  codigo=$(correr)
  if [ "$codigo" -ne 0 ]; then
    echo "  OK   — atrapada:     $nombre"
  else
    echo "  FALLA — NO atrapada: $nombre   <-- la suite no cubre esto"
  fi
  restaurar
}

echo "=== MUTACIONES ==="

# M1: se cae la mitad `total > 0` → la fila de anulación pasa a contar como
#     comprobante en todos los count(*).
python3 - <<'PY'
import re
p = 'src/lib/db/schema/expenses.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("  expenses.total > 0\n  AND NOT EXISTS (", "  NOT EXISTS (", 1)
s = s.replace("  ${expenses.total} > 0\n  AND NOT EXISTS (", "  NOT EXISTS (", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M1 sin 'total > 0' (la anulacion cuenta como comprobante)"

# M2: se cae el NOT EXISTS → el gasto corregido sigue vigente y se cuenta dos
#     veces junto con su correccion.
python3 - <<'PY'
p = 'src/lib/db/schema/expenses.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("""  AND NOT EXISTS (
    SELECT 1 FROM expenses c WHERE c.corrects_id = expenses.id
  )""", "", 1)
s = s.replace("""  AND NOT EXISTS (
    SELECT 1 FROM expenses c WHERE c.corrects_id = ${expenses.id}
  )""", "", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M2 sin NOT EXISTS (el gasto anulado sigue vigente)"

echo
echo "=== CONTROL: restaurado tiene que pasar ==="
restaurar
codigo=$(correr)
if [ "$codigo" -eq 0 ]; then
  echo "  OK   — restaurado pasa"
else
  echo "  FALLA — restaurado NO pasa: el script dejo el archivo roto"
  tail -20 /tmp/mut-salida.txt
fi
echo "TOTAL de mutaciones probadas: 2"
