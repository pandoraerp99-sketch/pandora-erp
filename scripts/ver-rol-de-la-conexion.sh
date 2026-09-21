#!/usr/bin/env bash
# ¿Con qué rol de Postgres se conecta Drizzle, y le aplica el RLS?
#
# La pregunta importa para decidir dónde va la guardia de "el contador no
# escribe": si la conexión es superusuario o BYPASSRLS, el RLS nunca aplicó
# a nada de esto y la única guardia posible es TypeScript.
set -euo pipefail
cd "$(dirname "$0")/.."
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

URL="$(grep -m1 '^DATABASE_URL=' .env.test | cut -d= -f2-)"
USUARIO="$(printf '%s' "$URL" | sed -E 's|^postgresql://([^:]+):.*|\1|')"

echo "usuario en DATABASE_URL: $USUARIO"
echo

URL="$URL" node --input-type=module -e "
import postgres from 'postgres';
const sql = postgres(process.env.URL, { prepare: false, max: 1 });
const [r] = await sql\`
  select current_user               as usuario,
         rolsuper                   as es_superusuario,
         rolbypassrls               as saltea_rls
    from pg_roles where rolname = current_user\`;
console.log('current_user :', r.usuario);
console.log('superusuario :', r.es_superusuario);
console.log('bypassrls    :', r.saltea_rls);
console.log();
console.log(
  r.es_superusuario || r.saltea_rls
    ? 'VEREDICTO: el RLS NO le aplica a esta conexión. La guardia tiene que ser TypeScript.'
    : 'VEREDICTO: el RLS SÍ le aplica. Hay que ver qué policies gobiernan las escrituras.'
);
await sql.end();
" 2>&1
