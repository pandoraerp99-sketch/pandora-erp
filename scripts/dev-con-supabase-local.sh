#!/usr/bin/env bash
# Arranca el dev server apuntando al Supabase LOCAL de Docker.
#
# ── Por qué hace falta esto ───────────────────────────────────────────────
# `.env.local` es un DUMMY de 2026-05-30 (lo dice en su propio encabezado):
# `DATABASE_URL` apunta a `localhost:5432/dummy_db`, que no existe. Con un
# `pnpm dev` pelado el server levanta igual, dice "Ready", sirve el HTML — y
# recién al intentar loguearse tira `ECONNREFUSED 127.0.0.1:5432` adentro de
# un Server Action. O sea: el login se queda en /login sin decir por qué, y
# desde afuera se ve idéntico a un bug de hidratación. Me costó un rato.
#
# El Supabase que corre de verdad es el local de Docker, y sus datos de
# conexión están en `.env.test` (127.0.0.1:34322). Esto los exporta al
# proceso: Next NO sobreescribe variables que ya vienen en el entorno, así
# que ganan sobre las dummy de `.env.local` sin tocar ese archivo.
#
# ── NODE_ENV ──────────────────────────────────────────────────────────────
# `.env.test` trae NODE_ENV=test y `next dev` necesita development. Se fuerza
# acá. Ojo que también sube LOG_LEVEL: en test es `error` y así no se ve nada
# de lo que el server hace mientras uno mira.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

if ! docker ps --format '{{.Names}}' | grep -q supabase_db; then
  echo "🔴 Supabase local no está levantado — corré: npx supabase start" >&2
  exit 1
fi

# Sólo las claves que importan para conectar. No se exporta el archivo entero
# con `set -a` para no arrastrar NODE_ENV ni LOG_LEVEL sin querer.
for clave in DATABASE_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
             SUPABASE_SERVICE_ROLE_KEY JWT_SECRET SECRETS_ENCRYPTION_KEY_V1 \
             SECRETS_ENCRYPTION_KEY_ACTIVE_VERSION; do
  valor="$(grep -m1 "^${clave}=" .env.test | cut -d= -f2-)"
  if [ -z "$valor" ]; then
    echo "🔴 falta ${clave} en .env.test" >&2
    exit 1
  fi
  export "${clave}=${valor}"
done

export NODE_ENV=development
export LOG_LEVEL=info

echo "dev server contra el Supabase local (puerto de la base: ${DATABASE_URL##*:})"
exec pnpm dev
