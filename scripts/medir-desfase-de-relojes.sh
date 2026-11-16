#!/usr/bin/env bash
# ¿Cuánto difieren el reloj de la app (Node) y el de la base (Postgres)?
#
# Hay columnas que pone Postgres (`default now()`, p. ej. cash_sessions.opened_at)
# y columnas que pone Node (`new Date()`, p. ej. sales.finalized_at). Comparar
# una contra otra compara DOS relojes. En dev son dos kernels (WSL y la VM de
# Docker); en producción, dos máquinas (Vercel y Supabase).
#
# Mide 20 veces: Node anota su hora, le pide la suya a Postgres, y anota la
# suya de nuevo. La hora de la base "debería" caer entre las dos de Node.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
URL="$(grep -m1 '^DATABASE_URL=' .env.test | cut -d= -f2-)"

URL="$URL" node --input-type=module -e "
import postgres from 'postgres';
const sql = postgres(process.env.URL, { prepare: false, max: 1 });
await sql\`select 1\`;
const muestras = [];
for (let i = 0; i < 20; i++) {
  const antes = Date.now();
  const [r] = await sql\`select (extract(epoch from clock_timestamp()) * 1000)::float8 as db\`;
  const despues = Date.now();
  const medio = (antes + despues) / 2;
  muestras.push({ desfase: r.db - medio, ida_y_vuelta: despues - antes });
}
await sql.end();
const d = muestras.map(m => m.desfase).sort((a, b) => a - b);
const rtt = muestras.map(m => m.ida_y_vuelta).sort((a, b) => a - b);
const f = (x) => x.toFixed(2) + ' ms';
console.log('base - app (desfase):  min', f(d[0]), '· mediana', f(d[10]), '· max', f(d[19]));
console.log('ida y vuelta:          mediana', f(rtt[10]));
console.log(Math.abs(d[10]) > rtt[10]
  ? 'VEREDICTO: los relojes NO coinciden: el desfase supera la ida y vuelta.'
  : 'VEREDICTO: el desfase está dentro del ruido de la ida y vuelta.');
"
