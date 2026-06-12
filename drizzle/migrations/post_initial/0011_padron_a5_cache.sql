-- =============================================================
-- Migration: CREATE TABLE padron_a5_cache (cache 24h respuestas ARCA)
-- Aplicar DESPUÉS de 0010_fiscal_snapshots_immutable.sql
-- Mini-audit pre-Sprint 6 fiscal + CLAUDE.md §17.2 + §3.5 (A-4)
-- =============================================================
--
-- **Por qué SQL manual y no drizzle-kit generate:**
-- (a) drizzle-kit 0.31.10 sigue roto por BigInt serialization (workaround
--     documentado en 0000_workaround_drizzle_kit_bigint_bug.sql).
-- (b) Pattern del repo: tablas nuevas con CREATE TABLE IF NOT EXISTS +
--     mismas constraints que el schema TS (Drizzle parse del schema TS
--     da los tipos para queries, esto da los tipos en DB).
--
-- **Política caché 24h (CLAUDE.md §17.2):** pendiente cierre exacto A-4
-- contadora (estricto vs permisivo + tolerancia timeout). Hasta entonces,
-- hot path fiscal = fail-closed strict si stale > 24h.

BEGIN;

CREATE TABLE IF NOT EXISTS padron_a5_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  cuit text NOT NULL,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT padron_a5_cache_tenant_cuit_unique UNIQUE (tenant_id, cuit)
);

-- Index por (tenant_id, fetched_at) — usado por cron cleanup TTL + service
-- staleness check sin scan full.
CREATE INDEX IF NOT EXISTS padron_a5_cache_tenant_fetched_idx
  ON padron_a5_cache (tenant_id, fetched_at);

COMMIT;
