#!/usr/bin/env bash
# Los números que la documentación declara, CONTADOS (H-10 de la auditoría).
#
# CLAUDE.md, el README y el DECISION-LEDGER repiten cifras ("186 commits",
# "migrations hasta 0038", "42 eventos", "53 eventos") que se escribieron a
# mano y quedaron viejas sin que nadie lo notara: el doc vive en Windows y el
# código en WSL. Cuando un doc necesite un número, se saca de acá.
set -u
cd ~/workspace/pandora-erp || exit 1

mig_ultima=$(ls drizzle/migrations/post_initial/*.sql | sed 's|.*/||' | sort | tail -1)
mig_total=$(ls drizzle/migrations/post_initial/*.sql | wc -l)
eventos=$(grep -cE "^  '[a-z_]+\.[a-z_.]+',?" src/lib/audit/event-names.ts)
commits=$(git rev-list --count HEAD)
sin_push=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo '?')
t_unit=$(ls tests/unit/*.test.ts | wc -l)
t_int=$(ls tests/integration/*.test.ts | wc -l)
t_xt=$(ls tests/cross-tenant/*.test.ts 2>/dev/null | wc -l)
pantallas=$(find src/app -name page.tsx -not -path '*/api/*' | wc -l)

echo "commits:                 $commits ($sin_push sin pushear)"
echo "migraciones post_initial: $mig_total (última: $mig_ultima)"
echo "eventos de audit_log:     $eventos (src/lib/audit/event-names.ts)"
echo "archivos de test:         $t_unit unit · $t_int integración · $t_xt cross-tenant"
echo "pantallas (page.tsx):     $pantallas"
