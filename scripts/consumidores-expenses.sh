#!/bin/bash
# Quién lee la tabla `expenses`.
#
# Antes de agregar `corrects_id` hay que saber QUÉ consultas tienen que empezar
# a excluir las filas superseded. Si una queda afuera, un gasto anulado sigue
# sumando ahí y nadie se entera.
#
# Imprime SIEMPRE un total, incluso 0: un resultado vacío que parece "limpio"
# es justamente lo que haría dejar de buscar.
cd ~/workspace/pandora-erp || exit 1

echo "=== Archivos que mencionan la tabla expenses (sin el schema) ==="
archivos=$(grep -rl 'expenses' src/ --include=*.ts --include=*.tsx | grep -v 'db/schema/')
echo "$archivos"
echo

echo "=== Lecturas concretas (drizzle .from(expenses) o SQL crudo) ==="
total=0
for f in $archivos; do
  n=$(grep -cE '\.from\(expenses\)|FROM expenses|from expenses' "$f")
  if [ "$n" -gt 0 ]; then
    echo "--- $f ($n) ---"
    grep -nE '\.from\(expenses\)|FROM expenses|from expenses' "$f"
    total=$((total + n))
  fi
done
echo
echo "TOTAL de lecturas de expenses encontradas: $total"

echo
echo "=== Escrituras (INSERT) ==="
grep -rnE '\.insert\(expenses\)|INSERT INTO expenses' src/ --include=*.ts | grep -v 'db/schema/'
echo "TOTAL de inserts: $(grep -rcE '\.insert\(expenses\)|INSERT INTO expenses' src/ --include=*.ts | grep -v ':0' | grep -v 'db/schema' | wc -l)"
