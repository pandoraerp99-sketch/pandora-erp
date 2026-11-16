#!/usr/bin/env bash
# Inventario de los services que ESCRIBEN en la base: qué exportan y cómo
# obtienen el contexto (tenant/usuario/rol). Es el insumo de H-01: una
# guardia de rol única tiene que entrar en cada uno de estos.
#
# Excluye infraestructura que escribe por diseño sin usuario (audit writer,
# jobs_queue, idempotency, métricas, webhooks de MP, fiscal) — esas tienen su
# propia puerta (HMAC, cron secret) y no son el problema de H-01.
set -u
cd ~/workspace/pandora-erp || exit 1

grep -rlE '\.insert\(|\.update\(|\.delete\(|INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM' \
    src/lib --include='*.ts' \
  | grep -v '\.test\.' \
  | grep -vE 'db/schema|db/client|jobs_queue|audit/|observability|idempotency|security|integrations/mercadopago|fiscal/' \
  | sort \
  | while read -r f; do
      echo "### $f"
      grep -nE '^export (async )?function [a-zA-Z]+' "$f" | cut -c1-100
      echo "  ctx: $(grep -cE 'requireTracingContext|requireTenantId|getTracingContext' "$f")  rol: $(grep -cE 'actorRole|UserRole|company_users' "$f")  actor_type: $(grep -c 'actor_type' "$f")"
    done
