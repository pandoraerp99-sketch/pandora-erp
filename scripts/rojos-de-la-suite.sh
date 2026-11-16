#!/usr/bin/env bash
# Qué tests fallaron en la última corrida de suite-completa.sh.
# suite-completa.sh imprime sólo el resumen; el detalle de vitest queda en
# los logs que ella misma escribe. Esto los encuentra y saca sólo los rojos.
set -u
cd ~/workspace/pandora-erp || exit 1

echo "== logs que escribe suite-completa.sh =="
grep -oE '/tmp/[a-z0-9_.-]+\.log' scripts/suite-completa.sh | sort -u

for f in $(grep -oE '/tmp/[a-z0-9_.-]+\.log' scripts/suite-completa.sh | sort -u); do
  [ -f "$f" ] || continue
  echo
  echo "### $f ($(date -r "$f" '+%H:%M'))"
  # Archivos y casos en rojo, sin el ruido del stack trace.
  grep -nE '^ (FAIL|❯) |×|AssertionError|Error: [A-Z]' "$f" \
    | grep -vE '0 failed|AggregateError' | cut -c1-220 | head -30
done
