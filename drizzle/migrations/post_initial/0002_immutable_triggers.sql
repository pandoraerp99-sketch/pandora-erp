-- =============================================================
-- Migration: Triggers anti-UPDATE / anti-DELETE sobre tablas inmutables
-- Aplicar DESPUES de 0001_partition_audit_log.sql
-- CLAUDE.md §16.5 + EVENT-TAXONOMY §5 + ADR-0022 (Fiscal Snapshot inmutable)
-- =============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1) audit_log inmutable
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es INSERT-only. UPDATE/DELETE prohibidos. operation=%, table=%',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_log_immutable();

-- ----------------------------------------------------------------
-- 2) fiscal_snapshots inmutable
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION fiscal_snapshots_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fiscal_snapshots es INSERT-only. Snapshot fiscal inmutable post-emision. operation=%',
    TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS fiscal_snapshots_no_update ON fiscal_snapshots;
DROP TRIGGER IF EXISTS fiscal_snapshots_no_delete ON fiscal_snapshots;

CREATE TRIGGER fiscal_snapshots_no_update
  BEFORE UPDATE ON fiscal_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION fiscal_snapshots_immutable();

CREATE TRIGGER fiscal_snapshots_no_delete
  BEFORE DELETE ON fiscal_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION fiscal_snapshots_immutable();

-- ----------------------------------------------------------------
-- 3) sale_items inmutables (forman parte del comprobante fiscal)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION sale_items_immutable_after_finalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_finalized timestamptz;
BEGIN
  SELECT finalized_at INTO parent_finalized
    FROM sales
    WHERE id = OLD.sale_id;

  IF parent_finalized IS NOT NULL THEN
    RAISE EXCEPTION 'sale_items inmutables tras finalizacion de la venta. sale_id=%',
      OLD.sale_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS sale_items_no_update_after_finalize ON sale_items;
DROP TRIGGER IF EXISTS sale_items_no_delete_after_finalize ON sale_items;

CREATE TRIGGER sale_items_no_update_after_finalize
  BEFORE UPDATE ON sale_items
  FOR EACH ROW
  EXECUTE FUNCTION sale_items_immutable_after_finalize();

CREATE TRIGGER sale_items_no_delete_after_finalize
  BEFORE DELETE ON sale_items
  FOR EACH ROW
  EXECUTE FUNCTION sale_items_immutable_after_finalize();

-- ----------------------------------------------------------------
-- 4) sales.customer_*_snapshot inmutable post-finalizacion
--    Fix I-1 (auditoria focal 2026-05-31 Paquete A).
--    ADR-0022 + CLAUDE.md §1.5 — customer snapshot inmutable post-emision.
--    sale_items ya tiene trigger propio. sales tiene columnas customer_*
--    que tambien deben quedar congeladas cuando finalized_at IS NOT NULL.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION sales_customer_snapshot_immutable_after_finalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Solo aplica si la venta YA estaba finalizada ANTES de este UPDATE.
  -- La transicion legitima OLD.finalized_at IS NULL -> NEW.finalized_at = now()
  -- (al finalizar la venta) puede setear los snapshots por primera/unica vez.
  IF OLD.finalized_at IS NOT NULL THEN
    IF NEW.customer_doc_type IS DISTINCT FROM OLD.customer_doc_type OR
       NEW.customer_doc_number IS DISTINCT FROM OLD.customer_doc_number OR
       NEW.customer_name_snapshot IS DISTINCT FROM OLD.customer_name_snapshot OR
       NEW.customer_tax_condition_snapshot IS DISTINCT FROM OLD.customer_tax_condition_snapshot THEN
      RAISE EXCEPTION
        'customer snapshot fields inmutables tras finalizacion de la venta (ADR-0022). sale_id=%, finalized_at=%',
        OLD.id, OLD.finalized_at
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_customer_snapshot_no_update_after_finalize ON sales;

CREATE TRIGGER sales_customer_snapshot_no_update_after_finalize
  BEFORE UPDATE ON sales
  FOR EACH ROW
  EXECUTE FUNCTION sales_customer_snapshot_immutable_after_finalize();

COMMIT;

COMMENT ON FUNCTION audit_log_immutable() IS
  'Bloquea UPDATE/DELETE/TRUNCATE sobre audit_log. CLAUDE.md §10.2.';
COMMENT ON FUNCTION fiscal_snapshots_immutable() IS
  'Bloquea UPDATE/DELETE sobre fiscal_snapshots. ADR-0022.';
COMMENT ON FUNCTION sale_items_immutable_after_finalize() IS
  'Bloquea modificar items de una venta finalizada (post-CAE). Modificaciones requieren NC.';
COMMENT ON FUNCTION sales_customer_snapshot_immutable_after_finalize() IS
  'Bloquea modificar customer_*_snapshot de una venta finalizada (ADR-0022). Fix I-1 auditoria focal 2026-05-31.';
