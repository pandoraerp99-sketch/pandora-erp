-- =============================================================
-- Migration: CREATE TABLE stock_movements + metrics_counter
-- Aplicar ANTES de:
--   - 0004_metrics_counter.sql (que define plpgsql increment_counter())
--   - 0005_stock_movements_immutable.sql (que define triggers anti-UPDATE)
-- =============================================================
--
-- **Motivo:** drizzle-kit 0.31.10 tiene bug BigInt serialization que rompe
-- `generate` y `push` cuando el schema usa `bigint`/`bigserial`. Estas dos
-- tablas (stock_movements.id bigserial, metrics_counter.count bigint) caen
-- en ese bug y NO se generan automáticamente. Workaround: SQL manual
-- exactamente equivalente al schema Drizzle TS.
--
-- **F1+ trigger:** cuando drizzle-kit publique fix BigInt, regenerar
-- migrations automáticas + eliminar este archivo.
--
-- Fuente schema TS:
--   - src/lib/db/schema/stock_movements.ts
--   - src/lib/db/schema/metrics.ts

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- stock_movements (Sprint 3 Inventory)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_movements (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  type text NOT NULL,
  qty numeric(19, 4) NOT NULL,
  reason text,
  related_sale_id uuid REFERENCES sales(id) ON DELETE RESTRICT,
  related_purchase_id uuid,  -- F1+ FK cuando exista módulo purchases
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- type del catálogo cerrado (STOCK_MOVEMENT_TYPES)
  CONSTRAINT stock_movements_type_check
    CHECK (type IN ('sale', 'purchase', 'adjustment', 'return', 'loss')),

  -- qty siempre positiva (signo deriva del type+direction en service)
  CONSTRAINT stock_movements_qty_positive
    CHECK (qty > 0),

  -- reason obligatorio para adjustment
  CONSTRAINT stock_movements_adjustment_reason
    CHECK (type != 'adjustment' OR (reason IS NOT NULL AND length(reason) > 0)),

  -- related_sale_id y related_purchase_id mutuamente exclusivos
  CONSTRAINT stock_movements_related_exclusive
    CHECK (NOT (related_sale_id IS NOT NULL AND related_purchase_id IS NOT NULL)),

  -- sale type requiere related_sale_id
  CONSTRAINT stock_movements_sale_requires_related
    CHECK (type != 'sale' OR related_sale_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS stock_movements_tenant_product_idx
  ON stock_movements (tenant_id, product_id, created_at);

CREATE INDEX IF NOT EXISTS stock_movements_sale_idx
  ON stock_movements (related_sale_id)
  WHERE related_sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS stock_movements_correlation_idx
  ON stock_movements (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- metrics_counter (Sprint 2 #5 Observability)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS metrics_counter (
  metric_name text NOT NULL,
  tenant_id uuid NOT NULL,
  tag_key text NOT NULL DEFAULT '',
  tag_value text NOT NULL DEFAULT '',
  count bigint NOT NULL DEFAULT 0,
  last_incremented_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metrics_counter_pkey
    PRIMARY KEY (metric_name, tenant_id, tag_key, tag_value)
);

CREATE INDEX IF NOT EXISTS idx_metrics_counter_tenant_recent
  ON metrics_counter (tenant_id, last_incremented_at DESC);

COMMIT;
