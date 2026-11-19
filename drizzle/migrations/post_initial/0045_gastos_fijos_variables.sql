-- 0045 — Gastos fijos, variables y mixtos (Compras y gastos, V1 paso 1).
-- Propuesta: RESEARCH-BRIEF-costos-gastos-compras.md (repo SRS), §3.
--
-- Clasificar un gasto como fijo/variable/mixto es una decisión de GESTIÓN
-- ("si vendo el doble, ¿esto sube?"), distinta de la categoría contable que
-- pidió la contadora. Por eso no es una categoría más: es un atributo aparte.
--
-- ── POR QUÉ UNA TABLA Y NO UNA COLUMNA EN expenses ──────────────────────────
-- `expenses` es append-only por trigger (0026): un gasto cargado no se
-- edita. Pero la clasificación sí tiene que poder cambiarse —un gasto viejo
-- sin clasificar, o uno mal marcado— y anular y recargar el gasto por una
-- etiqueta de gestión sería desproporcionado.
--
-- Entonces la clasificación es un LIBRO propio, también append-only: cada
-- cambio es una fila nueva y la vigente es la más reciente. Queda la historia
-- de quién la cambió y cuándo, sin tocar el gasto.
--
-- Un gasto SIN fila usa el valor por defecto de su categoría (ver
-- src/lib/domain/comportamiento-costo.ts). La mercadería no se clasifica: no
-- es un gasto del mes, es una compra que va al stock.

CREATE TABLE IF NOT EXISTS expense_cost_behaviour (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  expense_id uuid NOT NULL,
  comportamiento text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE expense_cost_behaviour DROP CONSTRAINT IF EXISTS ecb_comportamiento_check;
ALTER TABLE expense_cost_behaviour ADD CONSTRAINT ecb_comportamiento_check
  CHECK (comportamiento IN ('fijo', 'variable', 'mixto'));

-- FK compuesta "mismo comercio" (la unicidad (id, tenant_id) de expenses la
-- creó la 0041).
ALTER TABLE expense_cost_behaviour DROP CONSTRAINT IF EXISTS ecb_gasto_mismo_tenant;
ALTER TABLE expense_cost_behaviour ADD CONSTRAINT ecb_gasto_mismo_tenant
  FOREIGN KEY (expense_id, tenant_id) REFERENCES expenses (id, tenant_id) ON DELETE RESTRICT;

-- La vigente es la más reciente: el índice sirve para el DISTINCT ON.
CREATE INDEX IF NOT EXISTS ecb_gasto_reciente_idx
  ON expense_cost_behaviour (expense_id, created_at DESC);

CREATE OR REPLACE FUNCTION expense_cost_behaviour_inmutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'expense_cost_behaviour es INSERT-only: para cambiar la '
    'clasificación se agrega una fila nueva. operation=%', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ecb_inmutable ON expense_cost_behaviour;
CREATE TRIGGER ecb_inmutable BEFORE UPDATE OR DELETE ON expense_cost_behaviour
  FOR EACH ROW EXECUTE FUNCTION expense_cost_behaviour_inmutable();

ALTER TABLE expense_cost_behaviour ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ecb_tenant_isolation ON expense_cost_behaviour;
CREATE POLICY ecb_tenant_isolation ON expense_cost_behaviour FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

COMMENT ON TABLE expense_cost_behaviour IS
  'Fijo/variable/mixto de cada gasto (gestión, no contable). Append-only: la '
  'vigente es la más reciente; sin fila vale el default de la categoría.';
