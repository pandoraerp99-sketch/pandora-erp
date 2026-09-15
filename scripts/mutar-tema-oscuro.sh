#!/usr/bin/env bash
# Prueba que tests/unit/tema-oscuro-pantallas.test.ts FALLA ante las dos
# regresiones que cuida. Cada mutación se aplica sobre una copia de respaldo y
# se restaura siempre (trap), aunque el test explote.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
TEST=tests/unit/tema-oscuro-pantallas.test.ts
BK=$(mktemp -d)
restaurar() { for r in "$BK"/*.ruta; do [ -e "$r" ] || continue; cp "${r%.ruta}" "$(cat "$r")"; done; }
trap restaurar EXIT

ok=0; total=0
mutar() { # $1 descripcion, $2 archivo, $3 expresion sed
  total=$((total+1))
  local b="$BK/$(echo "$2" | tr / _)"
  [ -e "$b" ] || { cp "$2" "$b"; echo "$2" > "$b.ruta"; }
  cp "$b" "$2"
  sed -i "$3" "$2"
  if cmp -s "$b" "$2"; then echo "  ?? $1: la mutacion no cambio nada"; cp "$b" "$2"; return; fi
  if pnpm vitest run "$TEST" >/dev/null 2>&1; then echo "  VIVE  $1"; else echo "  muere $1"; ok=$((ok+1)); fi
  cp "$b" "$2"
}

mutar "productos sin bloque oscuro" src/app/productos/productosCss.ts 's/ + OSCURO_NUCLEO + OSCURO_GESTION + `/ + `/'
mutar "contador sin bloque oscuro" src/app/contador/contadorCss.ts 's/ + OSCURO_NUCLEO + OSCURO_GESTION + `/ + `/'
mutar "clientes sin bloque oscuro" src/app/clientes/clientesCss.ts 's/^` + OSCURO_NUCLEO + OSCURO_GESTION + `$/` + `/'
mutar "color inline en contador" src/app/contador/ContadorClient.tsx "s|<p className=\"label-sm err\">|<p className=\"label-sm\" style={{ color: '#c0384a' }}>|"
mutar "rubro inline en productos" src/app/productos/ProductosClient.tsx 's|style={estiloRubro(color)}|style={{ color, background: `${color}14` }}|'
mutar "color de icono inline en productos" src/app/productos/ProductosClient.tsx "s|className=\"ic repo-ic\"|className=\"ic\" style={{ color: '#b96c1a' }}|"
mutar "color inline en el panel" src/app/panel/PanelClient.tsx "s|<span className=\"v t-deuda\" style={{ fontSize: 18 }}>|<span className=\"v\" style={{ fontSize: 18, color: '#c0384a' }}>|"
mutar "color por variable en pendientes" src/components/tasks/Pendientes.tsx 's|<span className={`todo-tag ${claseTipo(t.tipo)}`}>|<span className="todo-tag" style={{ color: fg }}>|'
mutar "panel con su propia copia del .cta" src/app/panel/panelCss.ts 's|^` + OSCURO_CTA + `$|html[data-theme="dark"] .cta{ background:#5f53f5; }|'
mutar "color inline en gastos" src/app/gastos/GastosClient.tsx "s|<div className=\"g-error\">|<div style={{ color: '#c0384a' }}>|"

echo "mutaciones muertas: $ok/$total"
[ "$ok" -eq "$total" ]
