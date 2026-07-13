-- Migration 0018 — Catálogo de motivos de retiro/gasto de caja por tenant.
--
-- Tabla mutable de config (NO append-only): el DUEÑO (role='owner') administra la
-- lista de motivos (crear/renombrar/desactivar). El cajero la consume al registrar
-- un retiro/gasto (cash_movements.type='provider_payment'). Baja lógica via
-- is_active=false; los movimientos históricos guardan el motivo como texto (reason),
-- no FK → renombrar/borrar no reescribe la historia.
--
-- Incluye seed de 3 motivos por defecto para los tenants EXISTENTES (idempotente).
-- El gate owner-only vive en la app (server actions + dominio), no en la DB.
--
-- drizzle-kit roto (BigInt) → migración hand-written. Idempotente (db-apply-all re-corre).

BEGIN;

CREATE TABLE IF NOT EXISTS cash_withdrawal_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cash_withdrawal_reasons_label_not_empty
    CHECK (length(trim(label)) > 0)
);

CREATE INDEX IF NOT EXISTS cash_withdrawal_reasons_tenant_active_idx
  ON cash_withdrawal_reasons (tenant_id, is_active, sort_order);

-- RLS (mismo patrón que products). Sin DELETE: la baja es lógica (is_active=false).
ALTER TABLE cash_withdrawal_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_withdrawal_reasons_select ON cash_withdrawal_reasons;
CREATE POLICY cash_withdrawal_reasons_select ON cash_withdrawal_reasons
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS cash_withdrawal_reasons_insert ON cash_withdrawal_reasons;
CREATE POLICY cash_withdrawal_reasons_insert ON cash_withdrawal_reasons
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS cash_withdrawal_reasons_update ON cash_withdrawal_reasons;
CREATE POLICY cash_withdrawal_reasons_update ON cash_withdrawal_reasons
  FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- Seed defaults por tenant existente (idempotente: solo si el tenant no tiene ese label).
INSERT INTO cash_withdrawal_reasons (tenant_id, label, sort_order)
SELECT c.id, d.label, d.sort_order
FROM companies c
CROSS JOIN (VALUES
  ('Pago de proveedor', 1),
  ('Pago de sueldo', 2),
  ('Pago de mercadería', 3)
) AS d(label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM cash_withdrawal_reasons r
  WHERE r.tenant_id = c.id AND r.label = d.label
);

COMMIT;
