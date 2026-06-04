-- =============================================================
-- Migration: Trigger anti-UPDATE / anti-DELETE en stock_movements
-- Aplicar DESPUÉS de 0004_metrics_counter.sql
-- Sprint 3 ROADMAP Inventory + CLAUDE.md §16.5 append-only
-- =============================================================
--
-- stock_movements es bitácora append-only — la "cancelación" de un
-- movimiento NO es UPDATE sino INSERT de movimiento inverso
-- (type='return' o type='adjustment' con reason explícito).
--
-- Pattern: mismo que audit_log (0002_immutable_triggers.sql).

BEGIN;

CREATE OR REPLACE FUNCTION stock_movements_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements es INSERT-only. UPDATE/DELETE prohibidos. operation=%, table=%. Usar movimiento inverso (type=return/adjustment) para revertir.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS stock_movements_no_update ON stock_movements;
DROP TRIGGER IF EXISTS stock_movements_no_delete ON stock_movements;
DROP TRIGGER IF EXISTS stock_movements_no_truncate ON stock_movements;

CREATE TRIGGER stock_movements_no_update
  BEFORE UPDATE ON stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION stock_movements_immutable();

CREATE TRIGGER stock_movements_no_delete
  BEFORE DELETE ON stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION stock_movements_immutable();

CREATE TRIGGER stock_movements_no_truncate
  BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT
  EXECUTE FUNCTION stock_movements_immutable();

COMMIT;
