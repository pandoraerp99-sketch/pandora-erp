-- 0024 — Cuenta corriente de clientes (ADR-0027).
--
-- El "fiado": el cliente se lleva la mercadería y paga después. En un comercio
-- de barrio no es una excepción, es parte del negocio diario.
--
-- ── LA DEUDA ES UN LIBRO, NO UN CAMPO ─────────────────────────────────────
-- NO existe `customers.saldo`. El saldo se CALCULA:
--     sum(charge) − sum(payment) + sum(adjustment con signo)
-- Un saldo denormalizado y un libro divergen, y cuando divergen nadie puede
-- decir cuál tiene razón (CLAUDE.md §20.26). Si algún día pesa el cálculo se
-- cachea con una vista materializada, NUNCA con una columna que se actualiza
-- a mano.
--
-- Append-only, igual que `stock_movements` y `sale_payments`: corregir es
-- agregar un `adjustment` con su motivo, no editar la historia.

-- ── Medio de pago: la venta a cuenta corriente ────────────────────────────
-- El cierre de caja ya filtra `method='efectivo'`, así que una venta fiada
-- queda excluida del arqueo SIN tocar la fórmula. Y el pago mixto sigue
-- andando: mitad efectivo, mitad fiado es un caso real.
ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
  CHECK (method IN ('efectivo', 'debito', 'credito', 'tarjeta', 'mp_qr', 'cuenta_corriente'));

-- El DENORMALIZADO de la venta tambien tiene que aceptarlo. Son DOS checks
-- distintos y es facil actualizar uno solo: `sale_payments.method` es el
-- detalle (una fila por pago) y `sales.payment_method` es el resumen para
-- queries sin JOIN. Olvidarse de este segundo hace que la venta fiada falle
-- al finalizar, con un error de constraint que no dice nada del negocio.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (
    payment_method IS NULL
    OR payment_method IN ('efectivo','debito','credito','tarjeta','mp_qr','mixto','cuenta_corriente')
  );

-- ── Movimiento de caja: el cobro de la cuenta EN EFECTIVO ─────────────────
-- Tipo propio, NO se reusa 'deposit': un depósito genérico y un cliente
-- pagando su cuenta son eventos distintos, y mezclarlos hace que el arqueo no
-- se pueda explicar ("¿de dónde salieron estos $50.000?").
--
-- OJO: `computeExpectedAmountFromActivity` ahora FALLA ante un tipo que no
-- conoce (antes lo ignoraba en silencio, que era un descuadre invisible
-- esperando). Agregar un tipo acá OBLIGA a decidir cómo entra en el cálculo.
ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS cash_movements_type_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_type_check
  CHECK (type IN ('withdraw', 'deposit', 'provider_payment', 'customer_payment'));

-- ── El libro ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_account_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  -- charge = venta a cuenta · payment = el cliente paga · adjustment = corrección
  type text NOT NULL,

  -- SIEMPRE positivo. El signo lo da el `type`, no el número: un importe
  -- negativo con tipo 'payment' seria ambiguo de leer y de sumar.
  amount numeric(19,4) NOT NULL,

  -- De qué venta salió el cargo. NULL en pagos y ajustes.
  sale_id uuid REFERENCES sales(id) ON DELETE RESTRICT,

  -- Con qué pagó. Sólo en 'payment'. El efectivo ademas genera un
  -- cash_movements ligado a la sesión abierta; transferencia y tarjeta NO
  -- tocan la caja (si todo cobro fuera al cajón, el arqueo contaría plata que
  -- nunca entró).
  payment_method text,
  -- bigint, no uuid: cash_movements usa bigserial.
  cash_movement_id bigint REFERENCES cash_movements(id) ON DELETE RESTRICT,

  -- Obligatorio en 'adjustment': una corrección sin motivo no es auditable.
  reason text,

  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_account_movements
  DROP CONSTRAINT IF EXISTS cam_type_check;
ALTER TABLE customer_account_movements ADD CONSTRAINT cam_type_check
  CHECK (type IN ('charge', 'payment', 'adjustment'));

ALTER TABLE customer_account_movements
  DROP CONSTRAINT IF EXISTS cam_amount_positive;
ALTER TABLE customer_account_movements ADD CONSTRAINT cam_amount_positive
  CHECK (amount > 0);

-- Un cargo viene de una venta; un pago, no.
ALTER TABLE customer_account_movements
  DROP CONSTRAINT IF EXISTS cam_charge_needs_sale;
ALTER TABLE customer_account_movements ADD CONSTRAINT cam_charge_needs_sale
  CHECK (type <> 'charge' OR sale_id IS NOT NULL);

-- Un pago dice con qué se pagó; los demás no llevan medio.
ALTER TABLE customer_account_movements
  DROP CONSTRAINT IF EXISTS cam_payment_needs_method;
ALTER TABLE customer_account_movements ADD CONSTRAINT cam_payment_needs_method
  CHECK (
    (type = 'payment' AND payment_method IS NOT NULL)
    OR (type <> 'payment' AND payment_method IS NULL)
  );

-- Un ajuste sin motivo no se puede auditar.
ALTER TABLE customer_account_movements
  DROP CONSTRAINT IF EXISTS cam_adjustment_needs_reason;
ALTER TABLE customer_account_movements ADD CONSTRAINT cam_adjustment_needs_reason
  CHECK (type <> 'adjustment' OR (reason IS NOT NULL AND length(btrim(reason)) >= 3));

-- Sólo un cobro en efectivo puede estar ligado a un movimiento de caja.
ALTER TABLE customer_account_movements
  DROP CONSTRAINT IF EXISTS cam_cash_only_for_cash_payment;
ALTER TABLE customer_account_movements ADD CONSTRAINT cam_cash_only_for_cash_payment
  CHECK (
    cash_movement_id IS NULL
    OR (type = 'payment' AND payment_method = 'efectivo')
  );

-- Un cargo por venta no puede duplicarse: una venta genera UNA deuda.
CREATE UNIQUE INDEX IF NOT EXISTS cam_one_charge_per_sale
  ON customer_account_movements (sale_id)
  WHERE type = 'charge';

CREATE INDEX IF NOT EXISTS cam_tenant_customer_idx
  ON customer_account_movements (tenant_id, customer_id, created_at DESC);

-- ── Append-only, por trigger ──────────────────────────────────────────────
-- Mismo patrón que audit_log y stock_movements: la inmutabilidad no se pide
-- por convención, se hace cumplir en la base.
CREATE OR REPLACE FUNCTION customer_account_movements_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'customer_account_movements es INSERT-only. Para corregir, '
    'agregar un movimiento de tipo adjustment con su motivo. '
    'operation=%, table=%', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cam_no_update ON customer_account_movements;
CREATE TRIGGER cam_no_update BEFORE UPDATE ON customer_account_movements
  FOR EACH ROW EXECUTE FUNCTION customer_account_movements_immutable();

DROP TRIGGER IF EXISTS cam_no_delete ON customer_account_movements;
CREATE TRIGGER cam_no_delete BEFORE DELETE ON customer_account_movements
  FOR EACH ROW EXECUTE FUNCTION customer_account_movements_immutable();

-- ── RLS desde el minuto cero ──────────────────────────────────────────────
ALTER TABLE customer_account_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cam_tenant_isolation ON customer_account_movements;
CREATE POLICY cam_tenant_isolation ON customer_account_movements
  FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

COMMENT ON TABLE customer_account_movements IS
  'Libro append-only de la cuenta corriente (ADR-0027). El saldo NO se guarda: '
  'se calcula sum(charge) - sum(payment) +/- adjustment. Corregir = agregar un '
  'adjustment con motivo, nunca editar.';
