-- 0034 — La compra de mercaderia dice QUE entro, cuanto y a que costo.
--
-- Slice 2 de RESEARCH-BRIEF-compras-y-lotes.md. Cierra la mitad que falta del
-- item 8 del pedido de la contadora: "Inventario de bienes de cambio
-- VALORIZADO al cierre (fecha adq., detalle, importe de compra)".
--
-- ── POR QUE UNA LINEA DE GASTO Y NO UNA TABLA `purchases` ─────────────────
-- Todo lo que la cabecera de una compra necesita YA existe en `expenses`:
-- fecha, proveedor con CUIT (`tercero_id` + snapshot), tipo y numero de
-- comprobante, neto/IVA/total, medio de pago, y el asiento de caja si se pago
-- en efectivo. Una tabla nueva duplicaria todo eso y ademas obligaria a decidir
-- si una compra *tambien* genera un gasto.
--
-- Lo unico que faltaba es el detalle: que producto, cuantas unidades, a que
-- costo. Eso es el LOTE, y es lo que esta tabla agrega.
--
-- ── EL LOTE ES LA LINEA; NO SE GUARDA CUANTO QUEDA ────────────────────────
-- No hay columna de remanente. Bajo PEPS las unidades que quedan en stock SON
-- las de las compras mas recientes, asi que la valuacion al cierre se deriva
-- caminando las compras hacia atras desde el stock a esa fecha — que es
-- computable desde el ledger porque `stock_movements` ya guarda el signo
-- (migration 0032).
--
-- Una columna `remaining_qty` daria el MISMO numero y seria la unica pieza
-- mutable de una cadena que es append-only de punta a punta. Mismo principio
-- que ADR-0027: el saldo se calcula, nunca se guarda.
--
-- ── APPEND-ONLY, COMO TODO LO DEMAS ──────────────────────────────────────
-- `expenses`, `cash_movements`, `stock_movements`, `sale_payments` y
-- `audit_log` son todas INSERT-only por trigger. Si las lineas fueran
-- editables serian la unica superficie mutable de la cadena — y la anulacion
-- por supersede (migration 0033) asume que las lineas del comprobante
-- anulado quedan congeladas tal como se cargaron.
--
-- ── `unit_cost` ES NETO DE IVA RECUPERABLE ────────────────────────────────
-- Las lineas reconcilian contra `neto` cuando el IVA esta discriminado, y
-- contra `total` cuando no lo esta. No es un detalle: el IVA NO discriminado
-- no da credito fiscal, asi que es parte del costo de la mercaderia; el
-- discriminado se recupera y no lo es.
--
-- Importa porque `products.cost` se actualiza desde este numero y
-- `unit_cost_snapshot` (migration 0031) lo lee al vender: un costo en bruto
-- haria que TODOS los margenes de ahi en adelante quedaran ~21% subestimados,
-- con un numero que parece perfectamente razonable.

BEGIN;

CREATE TABLE IF NOT EXISTS expense_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,

  -- Cuantas unidades entraron. Decimal por los productos que se venden por
  -- kilo/metro/litro, igual que `stock_movements.qty`.
  qty numeric(19, 4) NOT NULL,

  -- Costo unitario NETO de IVA recuperable. Ver el encabezado.
  unit_cost numeric(19, 4) NOT NULL,

  -- Snapshot: la historia no se reescribe si despues renombran el producto.
  -- Mismo criterio que `sale_items.product_name_snapshot` y que
  -- `expenses.payee_name`.
  product_name_snapshot text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT expense_items_qty_positive CHECK (qty > 0),
  CONSTRAINT expense_items_cost_no_negativo CHECK (unit_cost >= 0)
);

COMMENT ON TABLE expense_items IS
  'Detalle de una compra de mercaderia: el LOTE. Append-only. unit_cost es NETO de IVA recuperable.';

CREATE INDEX IF NOT EXISTS expense_items_expense_idx
  ON expense_items (expense_id);

-- Para la valuacion al cierre: las compras de un producto, de la mas nueva a
-- la mas vieja, es exactamente como se camina el lote hacia atras.
CREATE INDEX IF NOT EXISTS expense_items_tenant_product_idx
  ON expense_items (tenant_id, product_id);

-- ── Inmutabilidad ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION expense_items_immutable()
RETURNS trigger AS $inmutable$
BEGIN
  RAISE EXCEPTION
    'expense_items es INSERT-only. UPDATE/DELETE prohibidos. Para corregir una compra, anular el gasto (corrects_id) y volver a cargarlo. operation=%, table=expense_items',
    TG_OP;
END;
$inmutable$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS expense_items_no_update ON expense_items;
CREATE TRIGGER expense_items_no_update
  BEFORE UPDATE ON expense_items
  FOR EACH ROW EXECUTE FUNCTION expense_items_immutable();

DROP TRIGGER IF EXISTS expense_items_no_delete ON expense_items;
CREATE TRIGGER expense_items_no_delete
  BEFORE DELETE ON expense_items
  FOR EACH ROW EXECUTE FUNCTION expense_items_immutable();

-- ── `related_expense_id` reemplaza a `related_purchase_id` ────────────────
-- `related_purchase_id` era un uuid SIN FK, con el comentario "F1+ cuando
-- exista modulo compras". Ese modulo no va a existir: la compra es un gasto.
-- Dejar la columna vieja apuntando a `expenses` seria un nombre que miente
-- sobre a que referencia — la misma clase de deuda silenciosa que los
-- comentarios corregidos en 0032, pero mas dificil de ver por estar en el
-- schema.
--
-- Se puede dropear sin cuidado: 0 filas la usan (medido) y ningun caller la
-- escribe.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_related_exclusive;
ALTER TABLE stock_movements DROP COLUMN IF EXISTS related_purchase_id;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS related_expense_id uuid
  REFERENCES expenses(id) ON DELETE RESTRICT;

COMMENT ON COLUMN stock_movements.related_expense_id IS
  'Comprobante de compra que origino este movimiento (type=purchase). FK real a expenses.';

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_related_exclusive
  CHECK (NOT (related_sale_id IS NOT NULL AND related_expense_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS stock_movements_expense_idx
  ON stock_movements (related_expense_id)
  WHERE related_expense_id IS NOT NULL;

COMMIT;
