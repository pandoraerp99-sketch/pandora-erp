-- =============================================================
-- Migration: metrics_counter table + atomic increment function
-- Aplicar DESPUES de 0003_rls_policies.sql
-- EVENT-TAXONOMY.md §4 v2.0.2 + CLAUDE.md §10.4
-- =============================================================
--
-- F0: writer TS hace INSERT ... ON CONFLICT DO UPDATE directamente.
-- Esta funcion plpgsql queda DISPONIBLE para F1+ optimization si
-- performance lo amerita (~1 roundtrip menos por increment) o para
-- llamadas desde plpgsql triggers (Sprint 6 fiscal si aplica).
-- =============================================================

BEGIN;

-- Drizzle-kit crea la tabla. Verificamos que existe + no esta vacia con
-- definicion incorrecta. Si no esta, es bug del flow de drizzle-kit antes
-- de esta migracion.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'metrics_counter'
  ) THEN
    RAISE EXCEPTION 'Tabla metrics_counter no existe. Ejecutar drizzle-kit primero.';
  END IF;
END $$;

-- ----------------------------------------------------------------
-- Atomic increment helper (F1+ optimization disponible).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_counter(
  p_metric text,
  p_tenant uuid,             -- NOT NULL — usar SYSTEM_TENANT_ID si aplica
  p_tag_key text DEFAULT '',
  p_tag_value text DEFAULT '',
  p_amount bigint DEFAULT 1
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO metrics_counter (
    metric_name, tenant_id, tag_key, tag_value, count, last_incremented_at
  )
  VALUES (p_metric, p_tenant, p_tag_key, p_tag_value, p_amount, now())
  ON CONFLICT (metric_name, tenant_id, tag_key, tag_value)
  DO UPDATE SET
    count = metrics_counter.count + p_amount,
    last_incremented_at = now();
END;
$$;

-- ----------------------------------------------------------------
-- RLS NO se aplica a metrics_counter F0.
-- Razon: scope='system' rows usan SYSTEM_TENANT_ID sentinel. Si aplicamos
-- RLS por tenant_id, system metrics quedan inaccesibles desde tenant
-- requests. Acceso esta gateado a nivel TS (writer + reader services).
-- F1+ trigger: si emerge un caso donde RLS aporta defense layered (ej:
-- dashboards expuestos directo a clientes), agregar policy entonces.
-- ----------------------------------------------------------------

COMMIT;
