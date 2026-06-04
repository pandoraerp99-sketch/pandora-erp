-- =============================================================
-- Migration: Cash schema custom — CREATE TABLE cash_sessions + cash_movements
--           + UNIQUE partial + 2 triggers immutable
-- Aplicar DESPUÉS de 0006_pg_trgm_products.sql
-- Sprint 4 ROADMAP Cash context + CLAUDE.md §16.5 append-only
-- =============================================================
--
-- **Por qué SQL manual y no drizzle-kit generate:**
-- (a) Drizzle-kit 0.31.10 sigue roto por BigInt serialization
--     (workaround documentado en 0000_workaround_drizzle_kit_bigint_bug.sql).
--     cash_movements.id es bigserial → cae en el mismo bug.
-- (b) cash_sessions tampoco se generó automáticamente (advisor 2026-06-04
--     detectó el gap: drizzle-kit no se re-corrió desde Sprint 0+1).
-- (c) Drizzle NO soporta partial unique index nativo → la regla
--     "1 session abierta por (tenant, sale_point)" debe ir SQL puro.
--
-- **Orden de creación importa (FK + CHECK + trigger refs):**
-- 1. cash_sessions (CREATE TABLE + CHECKs + indexes secundarios)
-- 2. UNIQUE partial index sobre cash_sessions
-- 3. cash_movements (FK cash_session_id ya resuelve)
-- 4. cash_movements indexes
-- 5. Trigger cash_sessions immutable POST-CLOSE
-- 6. Trigger cash_movements append-only

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- (1) CREATE TABLE cash_sessions
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  sale_point integer NOT NULL,

  -- Apertura
  opened_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL DEFAULT now(),
  initial_amount numeric(19, 4) NOT NULL,

  -- Cierre (NULL hasta cerrar)
  closed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  final_amount numeric(19, 4),
  expected_amount numeric(19, 4),
  descuadre numeric(19, 4),
  discrepancy_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- CHECKs (defense layered DB capa 1, mismos del schema TS)
  CONSTRAINT cash_sessions_sale_point_positive
    CHECK (sale_point > 0),

  CONSTRAINT cash_sessions_initial_amount_non_negative
    CHECK (initial_amount >= 0),

  CONSTRAINT cash_sessions_final_amount_non_negative
    CHECK (final_amount IS NULL OR final_amount >= 0),

  CONSTRAINT cash_sessions_expected_amount_non_negative
    CHECK (expected_amount IS NULL OR expected_amount >= 0),

  -- Si closed_at NULL → resto de cierre tambien NULL.
  -- Si closed_at NOT NULL → final + expected + descuadre + closed_by TODOS llenos.
  CONSTRAINT cash_sessions_closed_consistency
    CHECK (
      (closed_at IS NULL
        AND final_amount IS NULL
        AND expected_amount IS NULL
        AND descuadre IS NULL
        AND closed_by IS NULL)
      OR
      (closed_at IS NOT NULL
        AND final_amount IS NOT NULL
        AND expected_amount IS NOT NULL
        AND descuadre IS NOT NULL
        AND closed_by IS NOT NULL)
    ),

  -- Si descuadre != 0 → discrepancy_reason no vacío.
  -- Si descuadre = 0 → discrepancy_reason puede ser NULL.
  CONSTRAINT cash_sessions_discrepancy_reason_required
    CHECK (
      descuadre IS NULL
      OR descuadre = 0
      OR (discrepancy_reason IS NOT NULL AND length(discrepancy_reason) > 0)
    )
);

CREATE INDEX IF NOT EXISTS cash_sessions_tenant_sale_point_idx
  ON cash_sessions (tenant_id, sale_point, closed_at);

CREATE INDEX IF NOT EXISTS cash_sessions_tenant_opened_idx
  ON cash_sessions (tenant_id, opened_at);

-- ─────────────────────────────────────────────────────────────
-- (2) UNIQUE partial index cash_sessions
-- ─────────────────────────────────────────────────────────────

-- Solo 1 cash_session ABIERTA (closed_at IS NULL) por (tenant_id, sale_point).
-- Si comerciante intenta abrir una segunda → Postgres rechaza con
-- duplicate_key_violation (ERRCODE 23505) → service convierte a
-- ActiveSessionAlreadyOpenError tipado.
--
-- Sessions cerradas (closed_at NOT NULL) NO entran al index → pueden haber
-- miles para el mismo (tenant, sale_point) sin conflicto.
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_open_unique_partial
  ON cash_sessions (tenant_id, sale_point)
  WHERE closed_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- (3) CREATE TABLE cash_movements
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cash_movements (
  id bigserial PRIMARY KEY,
  cash_session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
  type text NOT NULL,
  amount numeric(19, 4) NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cash_movements_type_check
    CHECK (type IN ('withdraw', 'deposit', 'provider_payment')),

  CONSTRAINT cash_movements_amount_positive
    CHECK (amount > 0),

  CONSTRAINT cash_movements_reason_not_empty
    CHECK (length(reason) > 0)
);

CREATE INDEX IF NOT EXISTS cash_movements_session_idx
  ON cash_movements (cash_session_id, created_at);

CREATE INDEX IF NOT EXISTS cash_movements_correlation_idx
  ON cash_movements (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- (4) Trigger cash_sessions immutable POST-CLOSE
-- ─────────────────────────────────────────────────────────────
--
-- **Per advisor 2026-06-04**: el schema doc decía "una vez closed_at NOT NULL,
-- todos los campos del cierre son inmutables" pero NO había trigger que lo
-- enforce. Sin esto, alguien con write access podría UPDATE descuadre/reason
-- post-cierre y romper auditabilidad.
--
-- Condicional: solo bloquea UPDATEs cuando la fila YA estaba cerrada (OLD).
-- La transición close (closed_at NULL → NOT NULL) pasa porque OLD.closed_at
-- es NULL → trigger no se dispara.
--
-- Modificación post-cierre = abrir nueva session de ajuste (F1+ con trigger
-- objetivo + ADR).

CREATE OR REPLACE FUNCTION cash_sessions_immutable_after_close()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cash_sessions ya cerrada (closed_at=%) es INMUTABLE. UPDATE/DELETE prohibidos post-cierre. Para corrección, abrir nueva session de ajuste con audit explícito.',
    OLD.closed_at
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS cash_sessions_no_update_after_close ON cash_sessions;
DROP TRIGGER IF EXISTS cash_sessions_no_delete_after_close ON cash_sessions;

CREATE TRIGGER cash_sessions_no_update_after_close
  BEFORE UPDATE ON cash_sessions
  FOR EACH ROW
  WHEN (OLD.closed_at IS NOT NULL)
  EXECUTE FUNCTION cash_sessions_immutable_after_close();

CREATE TRIGGER cash_sessions_no_delete_after_close
  BEFORE DELETE ON cash_sessions
  FOR EACH ROW
  WHEN (OLD.closed_at IS NOT NULL)
  EXECUTE FUNCTION cash_sessions_immutable_after_close();

-- ─────────────────────────────────────────────────────────────
-- (5) Trigger cash_movements append-only (mismo patrón stock_movements)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cash_movements_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cash_movements es INSERT-only. UPDATE/DELETE prohibidos. operation=%, table=%. Usar movimiento inverso (withdraw <-> deposit) para revertir.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS cash_movements_no_update ON cash_movements;
DROP TRIGGER IF EXISTS cash_movements_no_delete ON cash_movements;
DROP TRIGGER IF EXISTS cash_movements_no_truncate ON cash_movements;

CREATE TRIGGER cash_movements_no_update
  BEFORE UPDATE ON cash_movements
  FOR EACH ROW
  EXECUTE FUNCTION cash_movements_immutable();

CREATE TRIGGER cash_movements_no_delete
  BEFORE DELETE ON cash_movements
  FOR EACH ROW
  EXECUTE FUNCTION cash_movements_immutable();

CREATE TRIGGER cash_movements_no_truncate
  BEFORE TRUNCATE ON cash_movements
  FOR EACH STATEMENT
  EXECUTE FUNCTION cash_movements_immutable();

COMMIT;
