#!/usr/bin/env bash
# Pasa a LF los archivos dados y reporta cuántas líneas CRLF quedan en lo que
# ya está commiteado (HEAD) bajo src/, tests/, scripts/ y drizzle/.
set -u
cd ~/workspace/pandora-erp || exit 1
for f in "$@"; do
  sed -i 's/\r$//' "$f"
  echo "normalizado: $f"
done
CR=$(printf '\r')
echo "=== archivos con CRLF en HEAD ==="
git grep -l -I "${CR}\$" HEAD -- src tests scripts drizzle | sed 's/^HEAD://' || echo "(ninguno)"
echo "=== diff despues de normalizar ==="
git diff --stat
