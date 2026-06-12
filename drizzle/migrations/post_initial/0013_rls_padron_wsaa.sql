-- =============================================================
-- Migration: RLS policies para padron_a5_cache + wsaa_tokens
-- Aplicar DESPUÉS de 0012_wsaa_tokens.sql
-- Mini-audit pre-Sprint 6 fiscal (advisor catch) + ADR-0002 + CLAUDE.md §7.2/§7.6
-- =============================================================
--
-- Las migrations 0011/0012 crearon padron_a5_cache + wsaa_tokens con
-- tenant_id pero SIN ENABLE RLS. Esto rompe la consistencia con el
-- resto del schema (companies/products/sales/audit_log/invoice_sequences/
-- fiscal_snapshots todas tienen RLS desde 0003_rls_policies.sql).
--
-- CLAUDE.md §7.2 (RLS Postgres como capa primaria) + §7.6 ("NO shared
-- secrets entre tenants") + §11.10 threat model "comerciante competidor
-- → cross-tenant leak → mitigation: RLS" requieren RLS en TODA tabla
-- tenant-aware.
--
-- Particularmente CRÍTICO para wsaa_tokens: token + sign son SECRETS
-- plaintext (CLAUDE.md §11.8 las trata como cache-not-vault). Sin RLS,
-- un SELECT mal escrito (sin WHERE tenant_id) en path admin/support
-- expondría tokens de otros tenants. RLS es la única protección at-rest.
--
-- Para padron_a5_cache: lectura en hot path pre-emisión factura A
-- (CUIT lookup) corre con tenant context → RLS protege que el lookup
-- no devuelva por accidente cache de otro tenant.
--
-- **Pattern de policies** (idéntico a fiscal_snapshots/invoice_sequences):
-- - SELECT: tenant_id IN current_company_ids() (incluye accountant array)
-- - INSERT: WITH CHECK tenant_id IN current_company_ids()
-- - UPDATE: USING + WITH CHECK tenant_id IN current_company_ids()
-- - DELETE: NO policy — solo service_role (cleanup TTL cron) bypass RLS
--
-- **service_role bypass**: cron jobs (TTL cleanup padron > 7d, refresh
-- WSAA token expired) corren con service_role que bypassa RLS por design
-- (CLAUDE.md §7.7 "support_user policy" + §17.2 cron cache workers).

BEGIN;

-- ----------------------------------------------------------------
-- padron_a5_cache
-- ----------------------------------------------------------------

ALTER TABLE padron_a5_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY padron_a5_cache_select ON padron_a5_cache
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY padron_a5_cache_insert ON padron_a5_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY padron_a5_cache_update ON padron_a5_cache
  FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- DELETE intencionalmente sin policy — solo service_role (cron TTL cleanup)
-- puede borrar entries viejos. Path autenticado NO necesita borrar.

-- ----------------------------------------------------------------
-- wsaa_tokens
-- ----------------------------------------------------------------

ALTER TABLE wsaa_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY wsaa_tokens_select ON wsaa_tokens
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY wsaa_tokens_insert ON wsaa_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY wsaa_tokens_update ON wsaa_tokens
  FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- DELETE intencionalmente sin policy — refresh proactivo es UPSERT
-- (mismo row, nuevo token + sign + expires_at). Cleanup catastrófico
-- (tenant deleted) corre con service_role bypass.

COMMIT;
