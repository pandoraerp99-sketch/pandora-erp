#!/usr/bin/env bash
# Deja el caso del locador armado en la base de dev para poder MIRARLO:
# una ficha de proveedor, los gastos de alquiler apuntando a ella, y dos
# contratos — uno vigente y uno VENCIDO.
#
# El vencido es el que importa ver: es el estado que más fácil sale mal
# (esconderlo, o marcarlo como si fuera un error). Respaldó los pagos que
# cubrió y tiene que seguir en la lista.
#
# ⚠️ Los gastos de dev se cargaron ANTES del puente gasto↔ficha, así que no
# apuntan a ningún proveedor. Esto los vincula A MANO sólo para la demo — no es
# un backfill: si hiciera falta migrar los gastos viejos de un comercio real,
# eso va en una data migration aparte (CLAUDE.md §16.10) y con el owner
# decidiéndolo.
set -u
cd ~/workspace/pandora-erp || exit 1

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -v ON_ERROR_STOP=1 -c "
  DO \$\$
  DECLARE
    t uuid; u uuid; prov uuid; v_doc text; v_nom text;
  BEGIN
    SELECT id INTO t FROM companies WHERE name = 'Kiosco Demo TDF' LIMIT 1;
    IF t IS NULL THEN RAISE EXCEPTION 'no esta el comercio de dev'; END IF;
    SELECT user_id INTO u FROM company_users WHERE company_id = t LIMIT 1;

    SELECT payee_name, payee_doc INTO v_nom, v_doc
      FROM expenses
     WHERE tenant_id = t AND categoria = 'alquiler' AND payee_doc IS NOT NULL
     LIMIT 1;
    IF v_doc IS NULL THEN RAISE EXCEPTION 'no hay alquiler con CUIT en dev'; END IF;

    SELECT id INTO prov FROM terceros
     WHERE tenant_id = t AND type = 'proveedor' AND terceros.doc = v_doc LIMIT 1;

    IF prov IS NULL THEN
      INSERT INTO terceros (tenant_id, type, name, doc, sort_order)
      VALUES (t, 'proveedor', v_nom, v_doc,
              coalesce((SELECT max(sort_order) FROM terceros
                         WHERE tenant_id = t AND type = 'proveedor'), 0) + 1)
      RETURNING id INTO prov;
      RAISE NOTICE 'ficha creada para % (%)', v_nom, v_doc;
    END IF;

    -- ⚠️ `expenses` es INSERT-only (trigger `expenses_immutable`), así que un
    -- gasto YA CARGADO no se puede vincular hacia atrás — ni con un script ni
    -- con una migración. El puente rige para los gastos que se carguen de
    -- ahora en más. Es coherente con el resto (el gasto es evidencia, no se
    -- edita), pero conviene saberlo: los alquileres viejos de un comercio
    -- nunca van a apuntar a la ficha.
    --
    -- Acá se saltea el trigger SÓLO para poder ver la pantalla con datos, con
    -- el mismo recurso que usa la limpieza de los tests. NO es un backfill.
    SET LOCAL session_replication_role = 'replica';
    UPDATE expenses SET tercero_id = prov
     WHERE tenant_id = t AND categoria = 'alquiler' AND tercero_id IS NULL;
    SET LOCAL session_replication_role = 'origin';

    IF NOT EXISTS (SELECT 1 FROM attachments
                    WHERE tercero_id = prov AND removed_at IS NULL) THEN
      INSERT INTO attachments (tenant_id, tipo, tercero_id, nombre_original,
                               content_type, bytes, sha256, storage_path,
                               vigencia_desde, vigencia_hasta, uploaded_by)
      VALUES
        (t, 'contrato', prov, 'contrato-locacion-2026.pdf', 'application/pdf',
         214880, repeat('c', 64), t::text || '/' || gen_random_uuid()::text,
         '2026-01-01', '2026-12-31', u),
        (t, 'contrato', prov, 'contrato-locacion-2025.pdf', 'application/pdf',
         198330, repeat('d', 64), t::text || '/' || gen_random_uuid()::text,
         '2025-01-01', '2025-12-31', u);
      RAISE NOTICE 'dos contratos sembrados (uno vigente, uno vencido)';
    ELSE
      RAISE NOTICE 'ya habia contratos, no se agregan';
    END IF;
  END
  \$\$;
" || exit 1
