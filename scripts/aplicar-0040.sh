#!/usr/bin/env bash
# Aplica SOLO la migración 0040 (adjuntos del comprobante) y verifica que quedó.
#
# Va en script y no inline por la regla de siempre: un chequeo escrito a mano
# cada vez es un chequeo que un día sale distinto.
#
# La verificación NO pregunta "¿existe lo que acabo de crear?" —eso siempre da
# que sí— sino las cosas que pueden quedar a medias sin avisar: que el bucket
# sea PRIVADO, que el RLS del bucket exista (es otra superficie que el de la
# tabla), y que los CHECKs rechacen de verdad las filas imposibles.
set -u
cd ~/workspace/pandora-erp || exit 1
set -a; . ./.env.test 2>/dev/null || true; set +a

CONT=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
if [ -z "$CONT" ]; then echo "🔴 no hay container supabase_db levantado"; exit 1; fi

docker exec -i "$CONT" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < drizzle/migrations/post_initial/0040_adjuntos_comprobantes.sql || exit 1

echo "== verificación =="
docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -v ON_ERROR_STOP=1 -c "
  SELECT 'bucket privado: ' || (NOT public)::text ||
         ' · limite: ' || file_size_limit::text ||
         ' · tipos: ' || array_length(allowed_mime_types, 1)::text
    FROM storage.buckets WHERE id = 'comprobantes';

  -- El RLS del BUCKET es otra superficie que el de la tabla: con la tabla
  -- protegida y el bucket abierto, los bytes del vecino se bajan igual.
  SELECT 'policies en storage.objects: ' || count(*)::text
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'comprobantes_%';

  SELECT 'rls tabla: ' || relrowsecurity::text FROM pg_class
   WHERE relname = 'attachments';

  SELECT 'triggers: ' || count(*)::text FROM pg_trigger
   WHERE tgrelid = 'attachments'::regclass AND NOT tgisinternal;
" || exit 1

echo "== los CHECK rechazan de verdad (no alcanza con que existan) =="
docker exec -i "$CONT" psql -U postgres -d postgres -P pager=off -c "
  DO \$\$
  DECLARE
    t uuid; u uuid; e uuid; ok int := 0;
  BEGIN
    SELECT id INTO t FROM companies LIMIT 1;
    SELECT id INTO u FROM users LIMIT 1;
    SELECT id INTO e FROM expenses WHERE tenant_id = t LIMIT 1;
    IF t IS NULL OR u IS NULL OR e IS NULL THEN
      RAISE NOTICE 'sin datos de dev para probar los CHECK (saltado)';
      RETURN;
    END IF;

    -- 1. un 'contrato' colgado de un GASTO no puede existir
    BEGIN
      INSERT INTO attachments (tenant_id, tipo, expense_id, nombre_original,
                               content_type, bytes, sha256, storage_path, uploaded_by)
      VALUES (t, 'contrato', e, 'x.pdf', 'application/pdf', 10, 'h', t::text||'/k1', u);
      RAISE WARNING '🔴 acepto un contrato colgado de un gasto';
    EXCEPTION WHEN check_violation THEN ok := ok + 1;
    END;

    -- 2. vigencia en un comprobante no significa nada
    BEGIN
      INSERT INTO attachments (tenant_id, tipo, expense_id, nombre_original,
                               content_type, bytes, sha256, storage_path,
                               uploaded_by, vigencia_desde)
      VALUES (t, 'comprobante', e, 'x.pdf', 'application/pdf', 10, 'h',
              t::text||'/k2', u, '2026-01-01');
      RAISE WARNING '🔴 acepto vigencia en un comprobante';
    EXCEPTION WHEN check_violation THEN ok := ok + 1;
    END;

    -- 3. baja a medias (fecha sin autor) no se puede auditar
    BEGIN
      INSERT INTO attachments (tenant_id, tipo, expense_id, nombre_original,
                               content_type, bytes, sha256, storage_path,
                               uploaded_by, removed_at)
      VALUES (t, 'comprobante', e, 'x.pdf', 'application/pdf', 10, 'h',
              t::text||'/k3', u, now());
      RAISE WARNING '🔴 acepto una baja sin autor';
    EXCEPTION WHEN check_violation THEN ok := ok + 1;
    END;

    RAISE NOTICE 'CHECKs que rechazaron: %/3', ok;
  END
  \$\$;
"
echo "0040 aplicada"
