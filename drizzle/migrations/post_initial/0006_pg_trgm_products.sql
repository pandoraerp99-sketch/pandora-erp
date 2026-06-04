-- =============================================================
-- Migration: pg_trgm extension + GIN trigram index on products.name
-- Aplicar DESPUÉS de 0005_stock_movements_immutable.sql
-- Sprint 3 ROADMAP Inventory § "Búsqueda typeahead < 100ms con 10k productos"
-- =============================================================
--
-- Trigram permite búsqueda fuzzy ("toaval" matchea "Toallon") con índice GIN
-- eficiente. Patrón típico de POS donde cajero teclea parcial.
-- Target P95 < 100ms con 10k productos (T-INV-03).

BEGIN;

-- Extension idempotente — IF NOT EXISTS evita fallar en re-run.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index GIN trigram en name — para search fuzzy de typeahead.
-- gin_trgm_ops es el operador de pg_trgm para % (similarity) y ILIKE.
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops);

-- Index GIN trigram en description — F1+ si emerge necesidad de buscar
-- en descripción. Por ahora solo name (típico POS).
-- CREATE INDEX IF NOT EXISTS idx_products_description_trgm
--   ON products USING gin (description gin_trgm_ops) WHERE description IS NOT NULL;

COMMIT;
