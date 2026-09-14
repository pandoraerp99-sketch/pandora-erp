#!/usr/bin/env bash
# RED por mutación sobre los eventos de audit_log de plata y acceso
# (EVENT-TAXONOMY v2.1.0, test T-AUDIT-02).
#
# Se rompe UNA pieza por vez y se exige que el test se ponga en rojo. Cada
# mutación verifica que el archivo CAMBIÓ antes de correr (ancla encontrada).
# Se decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

GASTOS=src/lib/services/expenses/expense.service.ts
CUENTA=src/lib/services/customers/account.service.ts
CONTADOR=src/lib/services/identity/accountant.service.ts
for f in "$GASTOS" "$CUENTA" "$CONTADOR"; do cp "$f" "/tmp/mut-aud-$(basename "$f").bak"; done
restaurar() {
  for f in "$GASTOS" "$CUENTA" "$CONTADOR"; do cp "/tmp/mut-aud-$(basename "$f").bak" "$f"; done
}
trap restaurar EXIT

correr() {
  if pnpm test:integration --no-file-parallelism T-AUDIT-02 >/tmp/mut-aud.txt 2>&1; then
    echo 0
  else
    echo 1
  fi
}

NO_ATRAPADAS=0
mutar() {
  local archivo="$1" expr="$2" nombre="$3"
  cp "$archivo" /tmp/mut-aud-antes
  perl -0pi -e "$expr" "$archivo"
  if cmp -s "$archivo" /tmp/mut-aud-antes; then
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

# ── Cada evento, reemplazado por otro evento válido del catálogo ──
# (equivale a no emitirlo, sin romper la compilación)
mutar "$GASTOS" "s/event_name: 'expense.registered'/event_name: 'sale.cancelled'/" \
  "el gasto no emite expense.registered"
mutar "$GASTOS" "s/event_name: 'expense.annulled'/event_name: 'sale.cancelled'/" \
  "la anulación no emite expense.annulled"
mutar "$CUENTA" "s/event_name: 'customer.account.settled'/event_name: 'sale.cancelled'/" \
  "el cobro no emite customer.account.settled"
mutar "$CUENTA" "s/event_name: 'customer.account.adjusted'/event_name: 'sale.cancelled'/" \
  "el ajuste no emite customer.account.adjusted"
mutar "$CONTADOR" "s/event_name: 'auth.accountant.granted'/event_name: 'auth.role.changed'/" \
  "dar acceso no emite auth.accountant.granted"
mutar "$CONTADOR" "s/event_name: 'auth.accountant.revoked'/event_name: 'auth.role.changed'/" \
  "sacar acceso no emite auth.accountant.revoked"

# ── El contenido que hace útil al evento ──
mutar "$GASTOS" 's/stockMovementIds\.push\(String\(movement\.id\)\);//' \
  "expense.registered sin los movimientos de stock"
mutar "$GASTOS" 's/salidasDeStock\.push\(String\(movement\.id\)\);//' \
  "expense.annulled sin las salidas de stock"
mutar "$GASTOS" 's/deposit_cash_movement_id: depositoId === null \? null : String\(depositoId\)/deposit_cash_movement_id: null/' \
  "expense.annulled sin el depósito que devolvió la plata"
mutar "$CUENTA" "s/saldo_antes: saldo\.toFixed\(4\)/saldo_antes: '0.0000'/" \
  "customer.account.settled con saldo previo inventado"

# ── Cuándo se emite ──
mutar "$CONTADOR" 's/if \(filas\.length > 0\) \{/if (true) {/' \
  "revocar audita aunque no se haya borrado nada"

# ── El chequeo de tenant en adjustAccount ──
mutar "$CUENTA" "s/if \(!cliente\) \{(\s*throw new AccountError\(\s*'customer_not_found',\s*'No existe ese cliente en este comercio')/if (false) {\$1/" \
  "adjustAccount acepta un cliente de otro comercio"

echo ""
if [ "$NO_ATRAPADAS" -eq 0 ]; then
  echo "==> Todas las mutaciones atrapadas"
  exit 0
fi
echo "==> $NO_ATRAPADAS mutación(es) NO atrapada(s)"
exit 1
