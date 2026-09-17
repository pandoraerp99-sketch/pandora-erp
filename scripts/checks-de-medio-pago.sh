#!/usr/bin/env bash
# TODOS los CHECK de `expenses` que nombran `medio_pago`.
#
# Existe por un error propio: la migración 0039 dropeaba
# `expenses_medio_pago_check` y creaba el suyo, y después "verificaba" que ESE
# aceptara 'cuenta_corriente'. Daba true — pero el que rechazaba el INSERT se
# llama `expenses_medio_check`, y nunca lo miré.
#
# Verificar la existencia de lo que uno acaba de crear no es verificar nada.
# Lo que hay que preguntar es qué OTROS checks gobiernan la misma columna.
set -u
cd ~/workspace/pandora-erp || exit 1

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres -c \
  "SELECT conname, pg_get_constraintdef(oid) AS definicion
     FROM pg_constraint
    WHERE conrelid = 'expenses'::regclass
      AND pg_get_constraintdef(oid) LIKE '%medio_pago%'
    ORDER BY conname;"
