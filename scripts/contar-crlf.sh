#!/usr/bin/env bash
# Cuántas líneas terminan en CRLF en cada archivo cambiado, y cuántas tenía en
# HEAD. Editar por la ruta \\wsl.localhost desde Windows puede meter CRLF y
# ensuciar el diff con cambios que no son del código.
set -u
cd ~/workspace/pandora-erp || exit 1
CR=$(printf '\r')
{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u | while read -r f; do
  [ -f "$f" ] || continue
  ahora=$(grep -c "${CR}\$" "$f" || true)
  total=$(wc -l < "$f")
  antes=$(git show "HEAD:$f" 2>/dev/null | grep -c "${CR}\$" || true)
  echo "ahora=${ahora}/${total} head=${antes:-nuevo}  $f"
done
