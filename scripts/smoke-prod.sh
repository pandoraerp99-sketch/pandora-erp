#!/usr/bin/env bash
# Humo del build de PRODUCCIÓN: levanta `next start` en otro puerto y pide las
# rutas. Compilar no alcanza — hay que ver que sirva.
#
# Compila y levanta con las MISMAS variables que el dev server: las de
# `.env.test` (Supabase local, puertos 3432x). `.env.local` es una plantilla con
# un Supabase ficticio, y las NEXT_PUBLIC_* se incrustan AL COMPILAR: un build
# hecho sin estas variables apunta al host dummy y el login no funciona.
#
# 🔴 NODE_ENV se DESCARTA después de cargar el archivo. Exportado (development
# o test) rompe el prerender del build: `useContext` null en /_global-error.
# Ese error se leyó durante meses como "el build de prod falla"; el build está
# sano, lo que fallaba era la invocación.
#
# Uso: bash scripts/smoke-prod.sh [--sin-build]
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
set -a; . ./.env.test; set +a
unset NODE_ENV
PUERTO=3100

if [ "${1:-}" != "--sin-build" ]; then
  echo "==> pnpm build"
  if ! pnpm build > /tmp/smoke-build.log 2>&1; then
    echo "  FALLA el build — ver /tmp/smoke-build.log"; tail -15 /tmp/smoke-build.log; exit 1
  fi
  echo "  OK"
fi

pnpm exec next start -p "$PUERTO" > /tmp/smoke-prod.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:$PUERTO/api/health" && break
  sleep 0.5
done

FALLAS=0
pedir() {
  local ruta="$1" esperado="$2"
  local codigo
  codigo=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PUERTO$ruta")
  if [ "$codigo" = "$esperado" ]; then
    echo "  OK    $ruta -> $codigo"
  else
    echo "  FALLA $ruta -> $codigo (esperado $esperado)"
    FALLAS=$((FALLAS + 1))
  fi
}

echo "==> next start (producción) en :$PUERTO"
pedir /api/health 200
pedir /login 200
# Sin sesión, las pantallas redirigen al login: un 307 prueba que el server
# renderiza y aplica auth; un 500 sería el build roto.
pedir /panel 307
pedir /pos 307
pedir /productos 307

echo "==> Errores en el log del server:"
grep -a -i -E "error|TypeError" /tmp/smoke-prod.log | head -5 || true

if [ -n "${MANTENER:-}" ] && [ "$FALLAS" -eq 0 ]; then
  echo "==> MANTENER=$MANTENER: el server queda arriba ${MANTENER}s para capturas (BASE=http://localhost:$PUERTO)"
  sleep "$MANTENER"
fi

[ "$FALLAS" -eq 0 ] && { echo "==> humo OK"; exit 0; }
echo "==> $FALLAS falla(s)"; exit 1
