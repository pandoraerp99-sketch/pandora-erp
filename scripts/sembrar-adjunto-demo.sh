#!/usr/bin/env bash
# Deja UNA ficha de comprobante en la base de dev, a propósito SIN archivo en
# el bucket.
#
# Por qué esa y no una con archivo: el estado "la ficha está y el archivo no"
# es el que más fácil sale ilegible o directamente invisible, y es el único que
# no se puede provocar desde la pantalla. Subir uno de verdad ya se prueba en
# T-ADJ-02; esto es para poder MIRARLO.
#
# Es idempotente: si ya hay una ficha sembrada, no agrega otra.
set -u
cd ~/workspace/pandora-erp || exit 1

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -v ON_ERROR_STOP=1 -c "
  DO \$\$
  DECLARE
    g record; u uuid;
  BEGIN
    SELECT id, tenant_id INTO g FROM expenses
     WHERE total > 0 ORDER BY fecha DESC LIMIT 1;
    SELECT user_id INTO u FROM company_users WHERE company_id = g.tenant_id LIMIT 1;

    IF g.id IS NULL OR u IS NULL THEN
      RAISE EXCEPTION 'la base de dev no tiene gastos o usuarios — nada que sembrar';
    END IF;

    IF EXISTS (SELECT 1 FROM attachments WHERE expense_id = g.id AND removed_at IS NULL) THEN
      RAISE NOTICE 'ya habia una ficha en ese gasto, no se agrega otra';
      RETURN;
    END IF;

    INSERT INTO attachments (tenant_id, tipo, expense_id, nombre_original,
                             content_type, bytes, sha256, storage_path, uploaded_by)
    VALUES (g.tenant_id, 'comprobante', g.id, 'factura-fletes.pdf',
            'application/pdf', 84213, repeat('a', 64),
            g.tenant_id::text || '/' || gen_random_uuid()::text, u);

    RAISE NOTICE 'ficha sembrada en el gasto % (sin archivo en el bucket, a proposito)', g.id;
  END
  \$\$;
" || exit 1
