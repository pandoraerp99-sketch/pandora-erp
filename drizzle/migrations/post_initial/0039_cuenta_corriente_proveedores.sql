-- 0039 — Cuenta corriente de PROVEEDORES (ítem 9 del pedido de la contadora).
--
-- Espejo de 0024, del otro lado del mostrador. Hasta acá todo gasto en Pandora
-- nacía pagado (`expenses.medio_pago` es NOT NULL y sus cinco valores son
-- formas de pagar), así que:
--
--   1. no se podía decir cuánto se le debe a cada proveedor al cierre, que es
--      literalmente lo que pide el ítem 9 ("razón social, CUIT e importe"); y
--   2. no se podía registrar una compra a 30 días — que en un comercio no es
--      un caso raro, es como se compra la mercadería.
--
-- ── POR QUÉ LA DEUDA NACE CON EL GASTO Y NO CON EL PAGO ───────────────────
-- Una compra de mercadería ES un `expenses` con categoria='mercaderia', y el
-- LOTE (`expense_items`) cuelga de esa fila: de ahí salen la fecha de
-- adquisición y el importe de compra del ítem 8, que ya está entregado.
--
-- Si la fila del gasto recién apareciera al pagar, la mercadería entraría al
-- stock sin lote y el inventario valorizado informaría "sin compra asociada"
-- en TODA compra a crédito — o sea, en casi todas. Un ítem terminado se
-- degradaría a su tercer estado sin que nadie lo note.
--
-- Entonces: la obligación se registra cuando se contrae, y el pago es un
-- evento posterior. Igual que la venta fiada en 0024.

-- ── El gasto que todavía no se pagó ───────────────────────────────────────
-- ⚠️ El CHECK de la 0026 se llama `expenses_medio_check`, NO
-- `expenses_medio_pago_check`. La primera versión de esta migración dropeó el
-- segundo nombre —que no existía—, creó uno nuevo con la lista ampliada, y
-- después "verificó" que ESE aceptara 'cuenta_corriente'. Daba true, y el
-- INSERT seguía fallando contra el otro, que nadie había mirado. Once tests
-- rojos con un mensaje que no menciona ninguno de los dos nombres.
--
-- Se dropean los DOS y queda uno solo, con el nombre original.
-- Ver scripts/checks-de-medio-pago.sh: lista TODOS los checks de la columna,
-- que es la pregunta correcta.
--
-- El tercer lugar donde vive esta lista es la const TS
-- EXPENSE_PAYMENT_METHODS en src/lib/db/schema/expenses.ts.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_medio_pago_check;
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_medio_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_medio_check
  CHECK (medio_pago IN ('efectivo', 'transferencia', 'debito', 'credito', 'otro', 'cuenta_corriente'));

-- Un gasto a cuenta corriente SIN proveedor identificado es una deuda sin
-- acreedor: no se podría cobrar ni informar. `payee_name` como texto suelto no
-- alcanza — dos tipeos distintos del mismo nombre serían dos acreedores.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_cta_cte_needs_tercero;
ALTER TABLE expenses ADD CONSTRAINT expenses_cta_cte_needs_tercero
  CHECK (medio_pago <> 'cuenta_corriente' OR tercero_id IS NOT NULL);

-- El CHECK existente `cash_movement_id IS NULL OR medio_pago = 'efectivo'`
-- sigue valiendo y no hay que tocarlo: un gasto impago no mueve la caja.

-- ── El libro ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_account_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  -- El proveedor. `terceros` ya venía preparada para esto: su propio comentario
  -- dice que el módulo de compras la reutiliza con type='proveedor'.
  tercero_id uuid NOT NULL REFERENCES terceros(id) ON DELETE RESTRICT,

  -- charge = compra a crédito · payment = le pagamos · adjustment = corrección
  type text NOT NULL,

  -- SIEMPRE positivo. El signo lo da el `type`.
  amount numeric(19,4) NOT NULL,

  -- ── LA FECHA DEL HECHO, NO LA DE LA CARGA ───────────────────────────────
  -- El ítem 5 (deudores) salió con un caveat declarado: su corte usa la fecha
  -- de registración porque el libro de clientes no guarda la de la operación,
  -- así que un fiado del 30/07 cargado el 02/08 cae en el ejercicio siguiente.
  -- Acá se guarda desde el día uno para no repetir ese caveat: el corte al
  -- cierre es `fecha <= cierre`, no `created_at <= cierre`.
  fecha date NOT NULL,

  -- De qué gasto salió el cargo. NULL en pagos y ajustes.
  expense_id uuid REFERENCES expenses(id) ON DELETE RESTRICT,

  -- Con qué le pagamos. Sólo en 'payment'. El efectivo ademas genera un
  -- cash_movements type='provider_payment' ligado a la sesión abierta — ese
  -- tipo YA existe desde 0024 y el cierre de caja ya lo resta del esperado.
  -- Transferencia y tarjeta NO tocan la caja.
  payment_method text,
  -- bigint, no uuid: cash_movements usa bigserial.
  cash_movement_id bigint REFERENCES cash_movements(id) ON DELETE RESTRICT,

  -- Obligatorio en 'adjustment'.
  reason text,

  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE supplier_account_movements
  DROP CONSTRAINT IF EXISTS sam_type_check;
ALTER TABLE supplier_account_movements ADD CONSTRAINT sam_type_check
  CHECK (type IN ('charge', 'payment', 'adjustment'));

ALTER TABLE supplier_account_movements
  DROP CONSTRAINT IF EXISTS sam_amount_positive;
ALTER TABLE supplier_account_movements ADD CONSTRAINT sam_amount_positive
  CHECK (amount > 0);

-- Un cargo viene de un gasto; un pago, no.
ALTER TABLE supplier_account_movements
  DROP CONSTRAINT IF EXISTS sam_charge_needs_expense;
ALTER TABLE supplier_account_movements ADD CONSTRAINT sam_charge_needs_expense
  CHECK (type <> 'charge' OR expense_id IS NOT NULL);

-- Un pago dice con qué se pagó; los demás no llevan medio.
ALTER TABLE supplier_account_movements
  DROP CONSTRAINT IF EXISTS sam_payment_needs_method;
ALTER TABLE supplier_account_movements ADD CONSTRAINT sam_payment_needs_method
  CHECK (
    (type = 'payment' AND payment_method IS NOT NULL)
    OR (type <> 'payment' AND payment_method IS NULL)
  );

-- Los mismos medios con los que se puede cancelar una cuenta del lado cliente.
ALTER TABLE supplier_account_movements
  DROP CONSTRAINT IF EXISTS sam_payment_method_check;
ALTER TABLE supplier_account_movements ADD CONSTRAINT sam_payment_method_check
  CHECK (
    payment_method IS NULL
    OR payment_method IN ('efectivo', 'transferencia', 'debito', 'credito')
  );

-- Un ajuste sin motivo no se puede auditar.
ALTER TABLE supplier_account_movements
  DROP CONSTRAINT IF EXISTS sam_adjustment_needs_reason;
ALTER TABLE supplier_account_movements ADD CONSTRAINT sam_adjustment_needs_reason
  CHECK (type <> 'adjustment' OR (reason IS NOT NULL AND length(btrim(reason)) >= 3));

-- Sólo un pago en efectivo puede estar ligado a un movimiento de caja.
ALTER TABLE supplier_account_movements
  DROP CONSTRAINT IF EXISTS sam_cash_only_for_cash_payment;
ALTER TABLE supplier_account_movements ADD CONSTRAINT sam_cash_only_for_cash_payment
  CHECK (
    cash_movement_id IS NULL
    OR (type = 'payment' AND payment_method = 'efectivo')
  );

-- Un gasto genera UNA deuda. Sin esto, un doble click deja al proveedor
-- debiéndole dos veces la misma factura.
CREATE UNIQUE INDEX IF NOT EXISTS sam_one_charge_per_expense
  ON supplier_account_movements (expense_id)
  WHERE type = 'charge';

CREATE INDEX IF NOT EXISTS sam_tenant_tercero_idx
  ON supplier_account_movements (tenant_id, tercero_id, fecha DESC);

-- El corte al cierre filtra por `fecha`: que el índice la tenga primero evita
-- un seq scan sobre todo el libro en el reporte del ejercicio.
CREATE INDEX IF NOT EXISTS sam_tenant_fecha_idx
  ON supplier_account_movements (tenant_id, fecha);

-- ── Append-only, por trigger ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supplier_account_movements_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'supplier_account_movements es INSERT-only. Para corregir, '
    'agregar un movimiento de tipo adjustment con su motivo. '
    'operation=%, table=%', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sam_no_update ON supplier_account_movements;
CREATE TRIGGER sam_no_update BEFORE UPDATE ON supplier_account_movements
  FOR EACH ROW EXECUTE FUNCTION supplier_account_movements_immutable();

DROP TRIGGER IF EXISTS sam_no_delete ON supplier_account_movements;
CREATE TRIGGER sam_no_delete BEFORE DELETE ON supplier_account_movements
  FOR EACH ROW EXECUTE FUNCTION supplier_account_movements_immutable();

-- ── RLS desde el minuto cero ──────────────────────────────────────────────
ALTER TABLE supplier_account_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sam_tenant_isolation ON supplier_account_movements;
CREATE POLICY sam_tenant_isolation ON supplier_account_movements
  FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

COMMENT ON TABLE supplier_account_movements IS
  'Libro append-only de la cuenta corriente de proveedores (item 9 del pedido '
  'de la contadora). El saldo NO se guarda: se calcula sum(charge) - '
  'sum(payment) +/- adjustment. Guarda `fecha` de negocio propia para que el '
  'corte al cierre no dependa de cuando se cargo.';
