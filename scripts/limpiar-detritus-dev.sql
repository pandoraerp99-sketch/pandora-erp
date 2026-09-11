-- Limpieza ÚNICA del detritus acumulado en la base de DESARROLLO.
--
-- NO es parte del ciclo normal. Los tests limpian lo suyo; esto barre lo que
-- quedó de corridas interrumpidas y de teardowns que ya se arreglaron:
--   * 2 tenants `T-INV-08 Test Co` con 10.000 productos sintéticos cada uno,
--     del 2026-06-03 y con CERO ventas: un test de performance que no llegó a
--     su afterAll.
--   * 12 tenants `T-CONT-02` del 2026-09-09, de las corridas en que su
--     afterEach todavía tiraba 42809. El bug está arreglado; el residuo no.
--   * ~110 usuarios @test.local y las filas de audit_log de tenants muertos.
--
-- POR QUÉ IMPORTA: contar `products` sin `GROUP BY tenant_id` acá daba
-- "9 de 20.009 productos sin costo", y eso se reportó como un dato del
-- comercio cuando eran fixtures. Ver scripts/censo-detritus.sql.
--
-- 🔒 EL TENANT DEMO NO SE TOCA, ni el SYSTEM_TENANT_ID (eventos y métricas del
--    sistema, que no son de ningún comercio).
--
-- ── POR QUÉ RECORRE EL CATÁLOGO Y NO UNA LISTA ────────────────────────────
-- La primera versión de este script enumeraba 7 tablas a mano. Hay 26 con
-- `tenant_id`/`company_id`: habría dejado huérfanos en 17 — exactamente el
-- problema que vino a resolver. Y una lista escrita a mano se queda vieja en
-- la próxima migration sin que nadie se entere. Preguntarle a `pg_attribute`
-- no se queda viejo.
--
-- ── audit_log ─────────────────────────────────────────────────────────────
-- Es append-only con trigger de inmutabilidad, así que hace falta
-- `session_replication_role = 'replica'` para poder borrar. Que sus filas
-- SOBREVIVAN al borrado de la company NO es un bug: audit_log no tiene FK a
-- companies a propósito (§10.2 — la auditoría dura 10 años y sobrevive al
-- tenant). Por eso esto es una limpieza de dev puntual y NO algo que los
-- tests deban empezar a hacer.
--
-- Correr:  docker exec -i supabase_db_pandora-erp psql -U postgres < este.sql

\set ON_ERROR_STOP on

BEGIN;

-- Desactiva los triggers, incluido el de inmutabilidad de audit_log y los de
-- append-only de sale_items / stock_movements. Va ACÁ ARRIBA y no adentro del
-- DO: el rol `postgres` de Supabase no es superusuario, y aunque tiene el
-- permiso para este parámetro vía `GRANT SET ON PARAMETER`, un
-- `set_config()` dentro de plpgsql igual lo rechaza. `SET LOCAL` dura toda la
-- transacción, así que alcanza con ponerlo una vez y el DO lo hereda.
SET LOCAL session_replication_role = 'replica';

DO $limpieza$
DECLARE
  demo   constant text := '11111111-1111-4111-8111-111111111111';
  sistema constant text := '00000000-0000-0000-0000-000000000000';
  t      record;
  n      bigint;
  total  bigint := 0;
BEGIN
  FOR t IN
    SELECT c.relname AS tabla, a.attname AS col
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
     WHERE nsp.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND a.attname IN ('tenant_id', 'company_id')
       AND a.attnum > 0
       AND c.relname <> 'companies'
       -- Las particiones se saltean: se borra por la tabla padre.
       AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
     ORDER BY 1
  LOOP
    EXECUTE format(
      'DELETE FROM public.%I WHERE %I <> %L::uuid AND %I <> %L::uuid',
      t.tabla, t.col, demo, t.col, sistema
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    IF n > 0 THEN
      RAISE NOTICE '  % : % filas', rpad(t.tabla, 28), n;
    END IF;
  END LOOP;

  DELETE FROM companies WHERE id <> demo::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '  % : % filas', rpad('companies', 28), n;
  total := total + n;

  -- Los usuarios no cuelgan de un tenant: se los identifica por el dominio
  -- que usan todos los tests. El operador de desarrollo (@pandora.dev) NO
  -- entra en este patrón y se conserva.
  DELETE FROM users WHERE email LIKE '%@test.local';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '  % : % filas', rpad('users (@test.local)', 28), n;
  total := total + n;

  RAISE NOTICE 'TOTAL BORRADO: % filas', total;
END
$limpieza$;

COMMIT;

VACUUM ANALYZE products;
VACUUM ANALYZE audit_log;
