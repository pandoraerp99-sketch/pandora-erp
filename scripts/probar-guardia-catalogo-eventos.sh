#!/usr/bin/env bash
# Prueba que `verificar-catalogo-eventos.sh` DETECTE el drift, no solo que diga OK.
#
# Un chequeo que nunca fallo no es un chequeo probado: ya paso en este proyecto
# que un script imprimia un ERROR, devolvia 0 y decia "sembrado".
#
# Rompe el doc de tres formas en una copia temporal y exige que el guard grite.
set -u

cd "$(dirname "$0")/.."
DOC="${EVENT_TAXONOMY:-/mnt/c/Users/Pandora/Desktop/SRS/EVENT-TAXONOMY.md}"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

if [ ! -f "$DOC" ]; then
  echo "⚠️  no encuentro el doc en $DOC — no se puede probar el guard"
  exit 0
fi

fallos=0

esperar_que_falle() {
  local caso="$1"
  if EVENT_TAXONOMY="$TMP" bash scripts/verificar-catalogo-eventos.sh >/dev/null 2>&1; then
    echo "🔴 $caso — el guard NO lo detecto"
    fallos=$((fallos + 1))
  else
    echo "✅ $caso — detectado"
  fi
}

# 1. Un evento que esta en el codigo y no en el doc (el caso de agregar el
#    nombre a event-names.ts y olvidarse de EVENT-TAXONOMY).
sed 's/expense\.attachment_removed/expense.SE_ME_OLVIDO/' "$DOC" > "$TMP"
esperar_que_falle "evento del codigo ausente del doc"

# 2. El total declarado quedo viejo (lo que paso de verdad: decia 49 con 51).
sed 's/\*\*Total: 53 eventos auditables F0\*\*/**Total: 49 eventos auditables F0**/' "$DOC" > "$TMP"
esperar_que_falle "total declarado desactualizado"

# 3. Las dos cosas juntas.
sed -e 's/expense\.attachment_added/expense.NI_IDEA/' \
    -e 's/\*\*Total: 53 eventos auditables F0\*\*/**Total: 12 eventos auditables F0**/' \
    "$DOC" > "$TMP"
esperar_que_falle "evento ausente + total viejo"

# 4. Y que con el doc REAL siga pasando (si no, el guard grita siempre y no
#    sirve para nada).
if EVENT_TAXONOMY="$DOC" bash scripts/verificar-catalogo-eventos.sh >/dev/null 2>&1; then
  echo "✅ con el doc real: OK"
else
  echo "🔴 con el doc real el guard FALLA — esta roto o el catalogo esta desincronizado"
  fallos=$((fallos + 1))
fi

if [ "$fallos" -ne 0 ]; then
  echo "GUARDIA DEL CATALOGO: $fallos problema(s)"
  exit 1
fi
echo "GUARDIA DEL CATALOGO OK (3 mutaciones atrapadas)"
