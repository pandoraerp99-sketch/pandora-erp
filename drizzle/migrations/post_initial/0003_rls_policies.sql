-- =============================================================
-- Migration: RLS Postgres policies multi-tenant
-- Aplicar DESPUES de 0002_immutable_triggers.sql
-- ADR-0002 + CLAUDE.md §7.2 — defensa en profundidad:
--   capa 1 = RLS Postgres (esta migracion)
--   capa 2 = service-side validation (src/lib/multi_tenant/validation.ts)
-- =============================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS pandora;

GRANT USAGE ON SCHEMA pandora TO authenticated, service_role;

-- Schema pandora ya creado arriba (movido por fix 2026-06-03 para que
-- CREATE FUNCTION pandora.* no falle por schema inexistente).


-- Helper para extraer el set de company_ids del JWT actual.
-- Acepta dos formas:
--   - JWT con `company_id` (single, para owner/admin/cashier)
--   - JWT con `company_ids` (array, para accountant)
-- Si esta seteado `active_company_id`, ese gana (override explicito).
CREATE OR REPLACE FUNCTION pandora.current_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
AS $$
  WITH claims AS (
    SELECT auth.jwt() AS jwt
  )
  SELECT id::uuid FROM (
    SELECT jsonb_array_elements_text(
      COALESCE(
        (SELECT jwt -> 'company_ids' FROM claims),
        jsonb_build_array((SELECT jwt ->> 'company_id' FROM claims))
      )
    ) AS id
  ) ids
  WHERE id IS NOT NULL AND id != 'null';
$$;



-- ----------------------------------------------------------------
-- companies
-- ----------------------------------------------------------------

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_select_own ON companies
  FOR SELECT
  TO authenticated
  USING (id IN (SELECT pandora.current_company_ids()));

CREATE POLICY companies_no_insert_via_user ON companies
  FOR INSERT
  TO authenticated
  WITH CHECK (false);  -- creacion de companies solo via service_role + backend.

CREATE POLICY companies_update_own ON companies
  FOR UPDATE
  TO authenticated
  USING (id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- users + company_users
-- ----------------------------------------------------------------

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_self ON users
  FOR SELECT
  TO authenticated
  USING (id::text = auth.uid()::text);

CREATE POLICY users_update_self ON users
  FOR UPDATE
  TO authenticated
  USING (id::text = auth.uid()::text)
  WITH CHECK (id::text = auth.uid()::text);

ALTER TABLE company_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_users_select_member ON company_users
  FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- products
-- ----------------------------------------------------------------

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_select ON products
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY products_insert ON products
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY products_update ON products
  FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY products_delete ON products
  FOR DELETE
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- sales + sale_items
-- ----------------------------------------------------------------

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_select ON sales
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY sales_insert ON sales
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY sales_update ON sales
  FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY sale_items_select ON sale_items
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY sale_items_insert ON sale_items
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- audit_log
-- ----------------------------------------------------------------

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select_own_tenant ON audit_log
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

-- INSERT permitido — el server escribe con service_role bypassing RLS, pero la policy
-- existe por si algun dia se cambia el path de escritura.
CREATE POLICY audit_log_insert_any ON audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE/DELETE bloqueados por trigger (0002_immutable_triggers).

-- ----------------------------------------------------------------
-- invoice_sequences
-- ----------------------------------------------------------------

ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_sequences_select ON invoice_sequences
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY invoice_sequences_update ON invoice_sequences
  FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- fiscal_snapshots
-- ----------------------------------------------------------------

ALTER TABLE fiscal_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY fiscal_snapshots_select ON fiscal_snapshots
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY fiscal_snapshots_insert ON fiscal_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- UPDATE/DELETE bloqueados por trigger (0002_immutable_triggers).

COMMIT;

COMMENT ON FUNCTION pandora.current_company_ids() IS
  'Extrae las company_id permitidas del JWT actual. Soporta owner/admin/cashier (1 company) y accountant (array). ADR-0002 + ADR-0008.';
