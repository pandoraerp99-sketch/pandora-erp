-- =============================================================
-- Migration: Trigger anti-UPDATE / anti-DELETE en fiscal_snapshots
-- Aplicar DESPUÉS de 0009_sales_sale_point.sql
-- Mini-audit pre-Sprint 6 fiscal + CLAUDE.md §8.2 + §16.5 + ADR-0022
-- =============================================================
--
-- fiscal_snapshots es registro INMUTABLE por factura emitida — el
-- comentario del schema (fiscal_snapshots.ts:7) lo declara desde Sprint 5
-- pero la migration nunca se creó ("aplicar via migración SQL custom en B5"
-- → B5 nunca llegó). Mini-audit pre-Sprint 6 detectó el gap.
--
-- Patrón idéntico a stock_movements_immutable (0005). fiscal_snapshots
-- NO admite estado "post-close" como cash_sessions: desde el momento
-- que se inserta el snapshot (= se persistió respuesta AFIP, sea CAE OK
-- o rechazo o timeout), TODO el contenido es inmutable.
--
-- Reproducibilidad histórica (ADR-0022 §Fiscal Snapshot): dada (sale_id,
-- snapshot) años después, el motor debe reconstruir payload AFIP idéntico.
-- Sin este trigger, un UPDATE accidental rompe esa garantía.

BEGIN;

CREATE OR REPLACE FUNCTION fiscal_snapshots_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fiscal_snapshots es INSERT-only. UPDATE/DELETE prohibidos. operation=%, table=%. Para corregir CAE/datos fiscales, abrir nuevo snapshot via NC (F1+) o resolución manual con audit explícito.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS fiscal_snapshots_no_update ON fiscal_snapshots;
DROP TRIGGER IF EXISTS fiscal_snapshots_no_delete ON fiscal_snapshots;
DROP TRIGGER IF EXISTS fiscal_snapshots_no_truncate ON fiscal_snapshots;

CREATE TRIGGER fiscal_snapshots_no_update
  BEFORE UPDATE ON fiscal_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION fiscal_snapshots_immutable();

CREATE TRIGGER fiscal_snapshots_no_delete
  BEFORE DELETE ON fiscal_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION fiscal_snapshots_immutable();

CREATE TRIGGER fiscal_snapshots_no_truncate
  BEFORE TRUNCATE ON fiscal_snapshots
  FOR EACH STATEMENT
  EXECUTE FUNCTION fiscal_snapshots_immutable();

COMMIT;
