-- Migration 0008 — Sprint 5 ROADMAP Sales+MP context.
--
-- Cambios:
-- 1. ALTER sales ADD COLUMN cash_session_id uuid NULL + FK ON DELETE SET NULL + index partial.
-- 2. CREATE TABLE sale_payments (granular pagos per venta) + 4 CHECKs + 4 indexes + triggers append-only.
-- 3. CREATE TABLE mp_payments (tracking webhooks MercadoPago) + 2 CHECKs + 3 indexes.
--
-- Drizzle-kit broken por 7ma vez consecutiva (BigInt bug). Migration custom
-- manual con CREATE TABLE hand-written + CHECKs + indexes + triggers en
-- orden FK-resolvable. Patrón canónico Pandora (mismo que 0000, 0005, 0007).

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- (1) ALTER sales: agregar cash_session_id FK + index partial
-- ─────────────────────────────────────────────────────────────

ALTER TABLE sales
  ADD COLUMN cash_session_id uuid
  REFERENCES cash_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sales_cash_session_idx
  ON sales (cash_session_id)
  WHERE cash_session_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- (2) CREATE TABLE sale_payments (append-only post-INSERT)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,

  method text NOT NULL,
  amount numeric(19,4) NOT NULL,

  -- Relations opcionales por método
  cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL,
  mp_payment_external_id text,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- CHECK constraints (mismo patrón _common.ts SALE_PAYMENT_METHODS)
  CONSTRAINT sale_payments_method_check
    CHECK (method IN ('efectivo','tarjeta','mp_qr')),
  CONSTRAINT sale_payments_amount_positive
    CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS sale_payments_sale_idx
  ON sale_payments (sale_id);

CREATE INDEX IF NOT EXISTS sale_payments_tenant_method_idx
  ON sale_payments (tenant_id, method, created_at);

-- Partial index: solo rows con cash_session_id NOT NULL.
-- Usado por cash session close para computar expected_amount.
CREATE INDEX IF NOT EXISTS sale_payments_cash_session_idx
  ON sale_payments (cash_session_id)
  WHERE cash_session_id IS NOT NULL;

-- Partial index para lookup MP webhook → sale_payment.
CREATE INDEX IF NOT EXISTS sale_payments_mp_external_idx
  ON sale_payments (tenant_id, mp_payment_external_id)
  WHERE mp_payment_external_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- (3) Triggers append-only sale_payments (mismo patrón cash_movements)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sale_payments_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'sale_payments es INSERT-only. UPDATE/DELETE prohibidos. operation=%, table=%. Para revertir, anular la sale completa (cancelSale) o emitir mp_payments.status=refunded.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS sale_payments_no_update ON sale_payments;
DROP TRIGGER IF EXISTS sale_payments_no_delete ON sale_payments;
DROP TRIGGER IF EXISTS sale_payments_no_truncate ON sale_payments;

CREATE TRIGGER sale_payments_no_update
  BEFORE UPDATE ON sale_payments
  FOR EACH ROW
  EXECUTE FUNCTION sale_payments_immutable();

CREATE TRIGGER sale_payments_no_delete
  BEFORE DELETE ON sale_payments
  FOR EACH ROW
  EXECUTE FUNCTION sale_payments_immutable();

CREATE TRIGGER sale_payments_no_truncate
  BEFORE TRUNCATE ON sale_payments
  FOR EACH STATEMENT
  EXECUTE FUNCTION sale_payments_immutable();

-- ─────────────────────────────────────────────────────────────
-- (4) CREATE TABLE mp_payments (UPDATE permitido — estado cambia con webhooks)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mp_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  -- sale + sale_payment FK opcionales hasta conciliar
  sale_id uuid REFERENCES sales(id) ON DELETE RESTRICT,
  sale_payment_id uuid REFERENCES sale_payments(id) ON DELETE RESTRICT,

  -- ID externo MP (UNIQUE per tenant)
  mp_payment_id text NOT NULL,

  status text NOT NULL,

  amount numeric(19,4) NOT NULL,

  webhook_received_at timestamptz,
  reconciled_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mp_payments_status_check
    CHECK (status IN ('pending','approved','rejected','cancelled','refunded')),
  CONSTRAINT mp_payments_amount_positive
    CHECK (amount > 0)
);

-- UNIQUE (tenant_id, mp_payment_id) clave de negocio
CREATE UNIQUE INDEX IF NOT EXISTS mp_payments_tenant_external_unique
  ON mp_payments (tenant_id, mp_payment_id);

-- Index por status para queries de pendientes / reconciliación
CREATE INDEX IF NOT EXISTS mp_payments_status_idx
  ON mp_payments (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS mp_payments_sale_idx
  ON mp_payments (sale_id);

COMMIT;
