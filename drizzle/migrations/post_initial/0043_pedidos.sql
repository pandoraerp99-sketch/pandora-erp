-- 0043 — Pedidos (encargos) con seña. Pantalla: pos-preview/pedidos.html
-- (+ pedidos-senados.html). Research: pos-preview/PEDIDOS-SENAS-research.md.
-- Decisiones: files/ADR-0029-pedidos-con-sena.md (repo SRS).
--
-- Un pedido es un ENCARGO: el cliente pide algo que no se lleva hoy (no hay
-- stock, es a medida, se trae del proveedor) y puede dejar plata a cuenta.
-- No es una venta: no mueve stock ni emite comprobante. La plata que deja SÍ
-- es plata real que entra a la caja, y por eso tiene su propio libro.
--
-- Tres tablas:
--   orders          el encabezado. Editable mientras el pedido está vivo: un
--                   pedido es una INTENCIÓN (como `tasks`), no un hecho.
--   order_items     las líneas. Se reemplazan enteras al editar; el antes y el
--                   después quedan en audit_log (order.updated).
--   order_payments  la plata. APPEND-ONLY por trigger, igual que sale_payments:
--                   cada cobro queda atado a la sesión de caja donde entró, y
--                   el cierre de caja suma los de efectivo (computeCashBreakdown).
--
-- ── Lo que esta migración NO hace (a propósito) ───────────────────────────
-- * No reserva stock: el stock se descuenta recién en la entrega, y la
--   conversión pedido → venta queda para una tanda siguiente (ver ADR-0029).
-- * No emite comprobante por la seña. `price_freezes` se GUARDA como dato
--   (RG 707/1999: la seña que congela precio perfecciona el hecho imponible),
--   pero qué comprobante corresponde es pregunta para la contadora (A-31).
-- * No modela devolución de seña: cancelar un pedido con cobros se bloquea en
--   el service hasta definir cómo sale esa plata de la caja.

-- ── Unicidad (id, tenant_id) en las tablas a las que se apunta ────────────
-- Mismo patrón que 0041: la FK compuesta hace que la BASE rechace un pedido
-- que apunte al cliente, producto o caja de OTRO comercio, aunque el service
-- se equivoque.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_id_tenant_unico') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_id_tenant_unico UNIQUE (id, tenant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_id_tenant_unico') THEN
    ALTER TABLE products ADD CONSTRAINT products_id_tenant_unico UNIQUE (id, tenant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_sessions_id_tenant_unico') THEN
    ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_id_tenant_unico UNIQUE (id, tenant_id);
  END IF;
END
$$;

-- ── orders ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  -- Número legible (#0055). Correlativo por comercio; lo asigna el service
  -- con un advisory lock por tenant, y el UNIQUE es la red.
  number integer NOT NULL,

  -- Cliente del libro (opcional) + SNAPSHOT del nombre: el pedido tiene que
  -- seguir diciendo a quién se le tomó aunque el cliente cambie de nombre.
  customer_id uuid,
  customer_name text NOT NULL,
  customer_phone text,

  -- Fecha de retiro pactada. Día del comercio, no instante.
  pickup_date date,
  notes text,

  status text NOT NULL DEFAULT 'tomado',

  -- ¿La seña congela el precio? Dato fiscal guardado, NO aplicado (A-31).
  price_freezes boolean NOT NULL DEFAULT false,

  -- Suma de order_items.line_total. Se recalcula en la misma transacción que
  -- toca las líneas; el test T-PED-01 verifica que cierre contra el detalle.
  total numeric(19,4) NOT NULL,

  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  cancelled_at timestamptz
);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_number_por_tenant;
ALTER TABLE orders ADD CONSTRAINT orders_number_por_tenant UNIQUE (tenant_id, number);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_id_tenant_unico CASCADE;
ALTER TABLE orders ADD CONSTRAINT orders_id_tenant_unico UNIQUE (id, tenant_id);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('tomado', 'en_preparacion', 'listo', 'entregado', 'cancelado'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_total_no_negativo;
ALTER TABLE orders ADD CONSTRAINT orders_total_no_negativo CHECK (total >= 0);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_number_positivo;
ALTER TABLE orders ADD CONSTRAINT orders_number_positivo CHECK (number > 0);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_cliente_con_nombre;
ALTER TABLE orders ADD CONSTRAINT orders_cliente_con_nombre
  CHECK (length(btrim(customer_name)) > 0);

-- El estado terminal y su fecha van juntos: un "entregado" sin cuándo, o una
-- fecha de entrega en un pedido vivo, son datos que nadie puede explicar.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_entregado_con_fecha;
ALTER TABLE orders ADD CONSTRAINT orders_entregado_con_fecha
  CHECK ((status = 'entregado') = (delivered_at IS NOT NULL));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_cancelado_con_fecha;
ALTER TABLE orders ADD CONSTRAINT orders_cancelado_con_fecha
  CHECK ((status = 'cancelado') = (cancelled_at IS NOT NULL));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_customer_mismo_tenant;
ALTER TABLE orders ADD CONSTRAINT orders_customer_mismo_tenant
  FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS orders_tenant_created_idx ON orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_tenant_status_idx ON orders (tenant_id, status);

-- ── order_items ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  position integer NOT NULL,
  -- Del catálogo (opcional) o ítem libre ("cortinado a medida"). La
  -- descripción se guarda siempre: es lo que se le prometió al cliente.
  product_id uuid,
  description text NOT NULL,
  -- Decimal: en una sedería se venden metros (3,20 m).
  quantity numeric(19,4) NOT NULL,
  unit_price numeric(19,4) NOT NULL,
  -- quantity × unit_price, redondeado HALF_EVEN a centavos en el service.
  line_total numeric(19,4) NOT NULL
);

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_order_mismo_tenant;
ALTER TABLE order_items ADD CONSTRAINT order_items_order_mismo_tenant
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id) ON DELETE RESTRICT;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_product_mismo_tenant;
ALTER TABLE order_items ADD CONSTRAINT order_items_product_mismo_tenant
  FOREIGN KEY (product_id, tenant_id) REFERENCES products (id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_posicion_unica;
ALTER TABLE order_items ADD CONSTRAINT order_items_posicion_unica UNIQUE (order_id, position);
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_cantidad_positiva;
ALTER TABLE order_items ADD CONSTRAINT order_items_cantidad_positiva CHECK (quantity > 0);
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_precio_no_negativo;
ALTER TABLE order_items ADD CONSTRAINT order_items_precio_no_negativo CHECK (unit_price >= 0);
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_total_no_negativo;
ALTER TABLE order_items ADD CONSTRAINT order_items_total_no_negativo CHECK (line_total >= 0);
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_con_descripcion;
ALTER TABLE order_items ADD CONSTRAINT order_items_con_descripcion
  CHECK (length(btrim(description)) > 0);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

-- ── order_payments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  -- sena = el primer cobro · parcial = a cuenta · saldo = el que lo deja en cero
  kind text NOT NULL,
  method text NOT NULL,
  amount numeric(19,4) NOT NULL,
  -- TODO cobro de pedido entra por una caja abierta, sea el medio que sea: el
  -- arqueo por medio (posnet, transferencias) también tiene que verlo. El
  -- esperado de EFECTIVO suma sólo method = 'efectivo'.
  cash_session_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_payments DROP CONSTRAINT IF EXISTS order_payments_order_mismo_tenant;
ALTER TABLE order_payments ADD CONSTRAINT order_payments_order_mismo_tenant
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id) ON DELETE RESTRICT;
ALTER TABLE order_payments DROP CONSTRAINT IF EXISTS order_payments_caja_mismo_tenant;
ALTER TABLE order_payments ADD CONSTRAINT order_payments_caja_mismo_tenant
  FOREIGN KEY (cash_session_id, tenant_id) REFERENCES cash_sessions (id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE order_payments DROP CONSTRAINT IF EXISTS order_payments_kind_check;
ALTER TABLE order_payments ADD CONSTRAINT order_payments_kind_check
  CHECK (kind IN ('sena', 'parcial', 'saldo'));
-- Sin mp_qr a propósito: el cobro por QR del POS todavía no verifica contra
-- MercadoPago (H-03). Registrar "pagó por QR" sin verificar es anotar plata
-- que puede no haber entrado.
ALTER TABLE order_payments DROP CONSTRAINT IF EXISTS order_payments_method_check;
ALTER TABLE order_payments ADD CONSTRAINT order_payments_method_check
  CHECK (method IN ('efectivo', 'debito', 'credito', 'transferencia'));
ALTER TABLE order_payments DROP CONSTRAINT IF EXISTS order_payments_amount_positivo;
ALTER TABLE order_payments ADD CONSTRAINT order_payments_amount_positivo CHECK (amount > 0);

CREATE INDEX IF NOT EXISTS order_payments_order_idx ON order_payments (order_id);
CREATE INDEX IF NOT EXISTS order_payments_session_idx ON order_payments (cash_session_id, method);

-- ── Inmutabilidad ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION order_payments_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order_payments es INSERT-only: un cobro registrado no se '
    'edita ni se borra. operation=%, table=%', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS order_payments_no_update ON order_payments;
CREATE TRIGGER order_payments_no_update BEFORE UPDATE ON order_payments
  FOR EACH ROW EXECUTE FUNCTION order_payments_immutable();
DROP TRIGGER IF EXISTS order_payments_no_delete ON order_payments;
CREATE TRIGGER order_payments_no_delete BEFORE DELETE ON order_payments
  FOR EACH ROW EXECUTE FUNCTION order_payments_immutable();

-- Un pedido no se borra: se cancela. Borrarlo dejaría su número como un hueco
-- inexplicable en el libro.
CREATE OR REPLACE FUNCTION orders_no_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'orders no se borra: un pedido se cancela. table=%', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_no_delete ON orders;
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_no_delete();

-- ── RLS desde el minuto cero ───────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_tenant_isolation ON orders;
CREATE POLICY orders_tenant_isolation ON orders FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));
DROP POLICY IF EXISTS order_items_tenant_isolation ON order_items;
CREATE POLICY order_items_tenant_isolation ON order_items FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));
DROP POLICY IF EXISTS order_payments_tenant_isolation ON order_payments;
CREATE POLICY order_payments_tenant_isolation ON order_payments FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

COMMENT ON TABLE orders IS
  'Pedidos (encargos). Editables mientras están vivos; no se borran, se '
  'cancelan. No mueven stock ni emiten comprobante (ADR-0029).';
COMMENT ON TABLE order_payments IS
  'Cobros de pedidos (seña / a cuenta / saldo). Append-only. Siempre por una '
  'caja abierta; el esperado de efectivo suma los method=efectivo.';
