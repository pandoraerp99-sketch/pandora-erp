-- Migration 0009 — Sprint 5 Bloque 3a: sales.sale_point para vincular ventas con cash_sessions.
--
-- Por qué:
--   cash_sessions tiene UNIQUE partial (tenant_id, sale_point) WHERE closed_at IS NULL.
--   Para que finalizeSale pueda lookup la cash_session activa cuando hay pago en
--   efectivo, sales necesita su propio sale_point — sin esto el linkage Sales→Cash
--   es ambiguo (¿cuál de las cash_sessions activas del tenant?).
--
-- F0 default 1:
--   Retail TDF típico tiene 1 caja por comercio. createDraftSale acepta opcional
--   sale_point (default 1). F1+ trigger cuando comerciante con 2+ cajas requiera
--   asignación per-cajero.
--
-- CHECK constraint: mismo guard que cash_sessions_sale_point_positive (Sprint 4).
-- Index parcial: por ahora todas las rows tienen sale_point=1 (no vale full index).

BEGIN;

ALTER TABLE sales
  ADD COLUMN sale_point integer NOT NULL DEFAULT 1;

ALTER TABLE sales
  ADD CONSTRAINT sales_sale_point_positive
  CHECK (sale_point > 0);

-- Index: queries típicas filtran por (tenant_id, sale_point) para encontrar
-- sales de una caja específica. Composite con tenant_id matchea pattern
-- existente sales_tenant_idx pero más específico.
CREATE INDEX IF NOT EXISTS sales_tenant_sale_point_idx
  ON sales (tenant_id, sale_point, created_at);

COMMIT;
