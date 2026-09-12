#!/bin/bash
# RED por mutación sobre la compra de mercadería.
#
# T-COMPRAS-01 pasó en verde a la primera porque el servicio se escribió antes
# que el test. Un test que nunca se vio fallar no probó nada todavía: acá se
# rompe cada cosa que el test dice cubrir y se exige que se ponga en rojo.
#
# Se decide por CÓDIGO DE SALIDA, nunca parseando el texto de vitest.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

ARCHIVO=src/lib/services/expenses/expense.service.ts
BACKUP=/tmp/expense-service-original.ts
cp "$ARCHIVO" "$BACKUP"
restaurar() { cp "$BACKUP" "$ARCHIVO"; }
trap restaurar EXIT

correr() {
  pnpm test:integration --no-file-parallelism T-COMPRAS-01 >/tmp/mut-compras.txt 2>&1
  echo $?
}

probar() {
  local nombre="$1"
  local codigo
  codigo=$(correr)
  if [ "$codigo" -ne 0 ]; then
    echo "  OK    — atrapada:     $nombre"
  else
    echo "  FALLA — NO atrapada: $nombre   <-- el test no cubre esto"
  fi
  restaurar
}

echo "=== MUTACIONES ==="

# M1: el costo se guarda en BRUTO (con IVA) en vez de neto.
python3 - <<'PY'
p = 'src/lib/services/expenses/expense.service.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("cost: costo === null ? null : new Decimal(costo).toFixed(4),",
              "cost: costo === null ? null : new Decimal(costo).times('1.21').toFixed(4),", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M1 costo en BRUTO (margenes ~21% subestimados)"

# M2: la compra no entra al stock (queda el lote, no el movimiento).
python3 - <<'PY'
p = 'src/lib/services/expenses/expense.service.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("""        await recordStockMovement(
          {
            product_id: linea.product_id,
            type: 'purchase',""", """        if (false) await recordStockMovement(
          {
            product_id: linea.product_id,
            type: 'purchase',""", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M2 la compra NO entra al stock"

# M3: se cae el pre-chequeo de mercaderia ya vendida.
python3 - <<'PY'
p = 'src/lib/services/expenses/expense.service.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("      if (sinStock.length > 0) {", "      if (false) {", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M3 sin el bloqueo de mercaderia ya vendida"

# M4: las lineas no tienen que cerrar contra el comprobante.
python3 - <<'PY'
p = 'src/lib/services/expenses/expense.service.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("    if (!withinTolerance(suma, base)) {", "    if (false) {", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M4 el detalle no tiene que cerrar"

# M5: la reversion se audita como ajuste manual del comerciante.
python3 - <<'PY'
p = 'src/lib/services/expenses/expense.service.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("""            reason: `Anulación de compra · ${original.comprobante_numero ?? original.payee_name ?? 'sin comprobante'}`,""",
"""            reason: `Anulación de compra`,
            // mutacion M5""", 1)
s = s.replace("""            // anulación. Auditarlo como `stock.adjusted_manually` haría que el
            // audit log mintiera sobre quién movió el stock y por qué.
            skip_audit: true,""", "            skip_audit: false,", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M5 la reversion se audita como ajuste manual"

# M6: las lineas reconcilian contra el TOTAL aunque el IVA este discriminado.
python3 - <<'PY'
p = 'src/lib/services/expenses/expense.service.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("    const base = discrimina ? neto : total;", "    const base = total;", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M6 reconcilia contra el TOTAL (ignora que el IVA se recupera)"

# M7: anular no recalcula el costo (queda el de un comprobante anulado).
python3 - <<'PY'
p = 'src/lib/services/expenses/expense.service.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("""    await recalcularCostoUltimaCompra(
      tx,
      tenantId,
      [...new Set(lineas.map((l) => l.product_id))]
    );""", "", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M7 anular deja el costo del comprobante anulado"

# M8: sin compras vigentes el costo se deja como esta, en vez de ir a NULL.
python3 - <<'PY'
p = 'src/lib/services/expenses/expense.service.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("    const costo = costoDe.get(productId) ?? null;",
              "    const costo = costoDe.get(productId);\n    if (costo === undefined) continue;", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M8 sin compras vigentes el costo queda en el valor desmentido"

# M9: el desempate dentro del comprobante toma el PRIMER renglon.
python3 - <<'PY'
p = 'src/lib/services/expenses/expense.service.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("              expense_items.linea DESC", "              expense_items.linea ASC", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M9 el costo lo fija el primer renglon y no el ultimo"

# M10: todas las lineas se numeran igual (el orden del papel se pierde).
python3 - <<'PY'
p = 'src/lib/services/expenses/expense.service.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("        linea: indice + 1,", "        linea: 1,", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
probar "M10 todas las lineas con el mismo numero de renglon"

echo
echo "=== CONTROL: restaurado tiene que pasar ==="
restaurar
codigo=$(correr)
if [ "$codigo" -eq 0 ]; then
  echo "  OK    — restaurado pasa"
else
  echo "  FALLA — restaurado NO pasa"
  tail -25 /tmp/mut-compras.txt
fi
echo "TOTAL de mutaciones probadas: 10"
