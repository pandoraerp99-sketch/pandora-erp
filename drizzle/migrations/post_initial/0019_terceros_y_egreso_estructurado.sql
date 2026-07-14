-- Migration 0019 — Egreso de caja estructurado: concepto + beneficiario (tercero).
--
-- Rehace bien el retiro/gasto (la 1ra versión hacía tipear el concepto):
-- 1. cash_withdrawal_reasons += beneficiario_tipo (qué tercero pide el concepto)
--    + BACKFILL de los 3 conceptos ya sembrados (0018).
-- 2. CREATE TABLE terceros (empleados/proveedores, owner-managed, soft-delete) + RLS.
-- 3. cash_movements += concept_id/payee_id/payee_type/payee_name/notes (egreso
--    estructurado). Son columnas nuevas nullable → el trigger append-only no aplica
--    (es DDL, no UPDATE de filas).
--
-- Idempotente (IF NOT EXISTS + guards). db-apply-all re-corre. drizzle-kit roto (BigInt).

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- (1) cash_withdrawal_reasons.beneficiario_tipo + backfill
-- ─────────────────────────────────────────────────────────────

ALTER TABLE cash_withdrawal_reasons
  ADD COLUMN IF NOT EXISTS beneficiario_tipo text NOT NULL DEFAULT 'ninguno';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_withdrawal_reasons_beneficiario_tipo_check'
  ) THEN
    ALTER TABLE cash_withdrawal_reasons
      ADD CONSTRAINT cash_withdrawal_reasons_beneficiario_tipo_check
      CHECK (beneficiario_tipo IN ('ninguno','empleado','proveedor'));
  END IF;
END $$;

-- Backfill de los conceptos sembrados en 0018 (solo si siguen en 'ninguno').
UPDATE cash_withdrawal_reasons SET beneficiario_tipo = 'proveedor'
  WHERE label = 'Pago de proveedor' AND beneficiario_tipo = 'ninguno';
UPDATE cash_withdrawal_reasons SET beneficiario_tipo = 'empleado'
  WHERE label = 'Pago de sueldo' AND beneficiario_tipo = 'ninguno';
UPDATE cash_withdrawal_reasons SET beneficiario_tipo = 'proveedor'
  WHERE label = 'Pago de mercadería' AND beneficiario_tipo = 'ninguno';

-- ─────────────────────────────────────────────────────────────
-- (2) CREATE TABLE terceros + RLS (patrón products)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS terceros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  type text NOT NULL,
  name text NOT NULL,
  doc text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT terceros_type_check CHECK (type IN ('empleado','proveedor')),
  CONSTRAINT terceros_name_not_empty CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS terceros_tenant_type_active_idx
  ON terceros (tenant_id, type, is_active, sort_order);

ALTER TABLE terceros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS terceros_select ON terceros;
CREATE POLICY terceros_select ON terceros
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS terceros_insert ON terceros;
CREATE POLICY terceros_insert ON terceros
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS terceros_update ON terceros;
CREATE POLICY terceros_update ON terceros
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ─────────────────────────────────────────────────────────────
-- (3) cash_movements: columnas de egreso estructurado
-- ─────────────────────────────────────────────────────────────

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS concept_id uuid,
  ADD COLUMN IF NOT EXISTS payee_id uuid,
  ADD COLUMN IF NOT EXISTS payee_type text,
  ADD COLUMN IF NOT EXISTS payee_name text,
  ADD COLUMN IF NOT EXISTS notes text;

-- FKs (guardadas). ON DELETE no aplica realmente: los catálogos son soft-delete.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_movements_concept_id_fkey') THEN
    ALTER TABLE cash_movements
      ADD CONSTRAINT cash_movements_concept_id_fkey
      FOREIGN KEY (concept_id) REFERENCES cash_withdrawal_reasons(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_movements_payee_id_fkey') THEN
    ALTER TABLE cash_movements
      ADD CONSTRAINT cash_movements_payee_id_fkey
      FOREIGN KEY (payee_id) REFERENCES terceros(id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
