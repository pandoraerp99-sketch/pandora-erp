#!/usr/bin/env bash
# Insumo para poner al día el DECISION-LEDGER: commits feat/fix/refactor desde
# una fecha, y la primera línea de comentario de cada migración nueva.
# Uso: bash scripts/decisiones-desde.sh 2026-06-26 0015
set -u
cd ~/workspace/pandora-erp || exit 1
DESDE="${1:-2026-06-26}"
MIG="${2:-0015}"

echo "== commits desde $DESDE (sin docs/test/chore)"
git log --reverse --since="$DESDE" --format='%ad %h %s' --date=short \
  | grep -vE ' (docs|test|chore|style)(\(|:)'
echo "total: $(git log --since="$DESDE" --format=%h | wc -l) commits"

echo
echo "== migraciones >= $MIG"
for f in drizzle/migrations/post_initial/*.sql; do
  n=$(basename "$f" | cut -c1-4)
  if [ "$n" \> "$MIG" ] || [ "$n" = "$MIG" ]; then
    printf '%s  %s\n' "$(basename "$f")" "$(grep -m1 -E '^-- ' "$f" | cut -c1-150)"
  fi
done
