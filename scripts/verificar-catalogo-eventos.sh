#!/usr/bin/env bash
# Verifica que el catalogo de eventos del CODIGO coincida con el DOC.
#
# Por que existe: `event-names.ts` decia "Total: 49 eventos" con 51 adentro, y
# CLAUDE.md + DECISION-LEDGER + EVENT-TAXONOMY declaraban v2.1.0 / 49 cuando el
# codigo ya iba por 51 — dos versiones de drift. La suite pasaba en verde todo
# ese tiempo: T-AUDIT-02 compara el codigo contra si mismo, y el doc vive en el
# filesystem de Windows, asi que NADA verificaba el "coincide exacto" que los
# tres documentos afirmaban.
#
# Chequea dos cosas, las dos en la direccion que falla de verdad:
#   1. cada event_name del codigo aparece en EVENT-TAXONOMY.md
#   2. el "Total: N eventos" declarado en el doc == cantidad real del codigo
#
# NO chequea doc->codigo a proposito: el doc nombra eventos EXCLUIDOS con su
# motivo (`customer.account.charged`, `supplier.account.charged`), y exigir que
# existan en el codigo daria un error donde hay una decision bien documentada.
set -u

cd "$(dirname "$0")/.."
CODIGO="src/lib/audit/event-names.ts"
DOC="${EVENT_TAXONOMY:-/mnt/c/Users/Pandora/Desktop/SRS/EVENT-TAXONOMY.md}"

if [ ! -f "$DOC" ]; then
  # El doc vive fuera del repo. Si no esta montado no se puede verificar, y eso
  # se DICE: un chequeo que no corrio no es un chequeo que paso.
  echo "⚠️  no encuentro EVENT-TAXONOMY.md en: $DOC"
  echo "   (pasá la ruta en EVENT_TAXONOMY=... si esta en otro lado)"
  echo "SIN VERIFICAR — el catalogo NO se comparo contra el doc"
  exit 0
fi

# Los nombres del codigo: lineas que son solo 'dominio.algo', dentro del array.
nombres=$(grep -oE "^  '[a-z_]+\.[a-z_.]+'," "$CODIGO" | tr -d " ',")
total_codigo=$(printf '%s\n' "$nombres" | grep -c .)

faltan=""
for n in $nombres; do
  grep -qF "\`$n\`" "$DOC" || faltan="$faltan $n"
done

# El total declarado en el doc ("**Total: 53 eventos auditables F0**").
total_doc=$(grep -oE '\*\*Total: [0-9]+ eventos auditables F0\*\*' "$DOC" |
            grep -oE '[0-9]+' | head -1)

echo "codigo: $total_codigo eventos · doc declara: ${total_doc:-?}"

fallo=0
if [ -n "$faltan" ]; then
  echo "🔴 en el CODIGO y NO en el doc:$faltan"
  fallo=1
fi
if [ "${total_doc:-0}" != "$total_codigo" ]; then
  echo "🔴 el total declarado en el doc (${total_doc:-?}) no es la cantidad real ($total_codigo)"
  fallo=1
fi

if [ "$fallo" -ne 0 ]; then
  echo "CATALOGO DESINCRONIZADO (regla J1: agregar un evento toca el doc TAMBIEN)"
  exit 1
fi

echo "CATALOGO OK"
