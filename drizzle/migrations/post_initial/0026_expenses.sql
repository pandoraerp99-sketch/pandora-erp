-- 0026 — Gastos del comercio.
--
-- Nace de evidencia, no de una maqueta: en el pedido real de la contadora a
-- ROMERO & RUIZ SAS, el comercio responde "clasifico gastos y envío gastos no
-- incluidos en ARCA mensualmente". Ese trabajo manual, todos los meses, es lo
-- que esta tabla viene a sacar.
-- Ver RESEARCH-BRIEF-gastos.md y EVIDENCIA-pedido-contadora-2026-09.md.
--
-- ── EL GASTO ES UN HECHO CONTABLE, NO UN MOVIMIENTO DE CAJA ───────────────
-- Se registra igual se haya pagado en efectivo, por transferencia o con
-- tarjeta. Sólo el efectivo genera además un `cash_movements` de tipo
-- `provider_payment` (que YA suma en el arqueo). Mismo criterio que el cobro
-- de cuenta corriente en ADR-0027: si todo egreso saliera del cajón, el arqueo
-- descontaría plata que nunca estuvo ahí.
--
-- ── APPEND-ONLY ───────────────────────────────────────────────────────────
-- Como audit_log, stock_movements y customer_account_movements: corregir es
-- registrar un gasto de ajuste, no editar. Un gasto editable después de que la
-- contadora lo uso para una DDJJ es un problema, no una comodidad.

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  -- Fecha DEL GASTO, no de la carga: se cargan atrasados todo el tiempo.
  fecha date NOT NULL,

  -- Categorías tomadas del pedido de la contadora (§4 del brief). No se
  -- inventaron: son las que ella enumera.
  categoria text NOT NULL,

  -- Proveedor. El id es OPCIONAL y el nombre va SNAPSHOT: si el tercero se
  -- renombra o se da de baja, el gasto sigue diciendo a quién se le pagó.
  -- Mismo criterio que el snapshot de cliente en las ventas.
  tercero_id uuid REFERENCES terceros(id) ON DELETE RESTRICT,
  payee_name text,
  -- CUIT al momento del gasto. La contadora lo pide explícitamente para el
  -- detalle de proveedores.
  payee_doc text,

  -- Importes. numeric(19,4) + Decimal, como toda la plata (CLAUDE.md §9.1).
  -- `neto` e `iva` pueden ser 0 en un gasto sin discriminar.
  neto numeric(19,4) NOT NULL DEFAULT 0,
  iva numeric(19,4) NOT NULL DEFAULT 0,
  total numeric(19,4) NOT NULL,

  descripcion text,
  comprobante_tipo text,
  comprobante_numero text,

  -- LA DISTINCIÓN QUE IMPORTA (§5 del brief): si el gasto tiene comprobante
  -- fiscal, entra al IVA compras y el estudio YA lo baja de ARCA. Los que NO,
  -- son los que el comercio tiene que mandar. Sin este flag el export duplica
  -- lo que la contadora ya tiene y el trabajo de separar vuelve al comercio,
  -- que es justo lo que se quiere eliminar.
  en_iva_compras boolean NOT NULL DEFAULT false,

  -- Con qué se pagó. Sólo 'efectivo' genera movimiento de caja.
  medio_pago text NOT NULL,
  cash_movement_id bigint REFERENCES cash_movements(id) ON DELETE RESTRICT,

  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_categoria_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_categoria_check
  CHECK (categoria IN (
    'alquiler', 'seguros', 'servicios', 'impuestos_y_tasas',
    'honorarios', 'mercaderia', 'otros'
  ));

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_medio_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_medio_check
  CHECK (medio_pago IN ('efectivo', 'transferencia', 'debito', 'credito', 'otro'));

-- Los importes no pueden ser negativos: un gasto negativo seria un ingreso, y
-- eso es otra cosa. Corregir de mas = gasto de ajuste, no un signo.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_importes_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_importes_check
  CHECK (total > 0 AND neto >= 0 AND iva >= 0);

-- Si se discriminó, neto + iva tiene que dar el total. Sin esto, un tipeo pone
-- en la DDJJ un crédito fiscal que no cierra con el comprobante.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_suma_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_suma_check
  CHECK ((neto = 0 AND iva = 0) OR (neto + iva = total));

-- Un gasto que dice estar en IVA compras necesita comprobante: es lo que lo
-- hace computable como crédito fiscal.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_iva_needs_comprobante;
ALTER TABLE expenses ADD CONSTRAINT expenses_iva_needs_comprobante
  CHECK (
    en_iva_compras = false
    OR (comprobante_numero IS NOT NULL AND length(btrim(comprobante_numero)) > 0)
  );

-- Sólo un gasto en efectivo puede estar ligado a un movimiento de caja.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_cash_only_efectivo;
ALTER TABLE expenses ADD CONSTRAINT expenses_cash_only_efectivo
  CHECK (cash_movement_id IS NULL OR medio_pago = 'efectivo');

-- Un movimiento de caja pertenece a UN gasto: si dos gastos apuntaran al mismo,
-- el arqueo descontaría una vez lo que se cargó dos.
CREATE UNIQUE INDEX IF NOT EXISTS expenses_cash_movement_uq
  ON expenses (cash_movement_id) WHERE cash_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS expenses_tenant_fecha_idx
  ON expenses (tenant_id, fecha DESC);

-- ── Append-only, por trigger ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION expenses_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'expenses es INSERT-only. Para corregir, registrar un gasto '
    'de ajuste. operation=%, table=%', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS expenses_no_update ON expenses;
CREATE TRIGGER expenses_no_update BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_immutable();

DROP TRIGGER IF EXISTS expenses_no_delete ON expenses;
CREATE TRIGGER expenses_no_delete BEFORE DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_immutable();

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expenses_tenant_isolation ON expenses;
CREATE POLICY expenses_tenant_isolation ON expenses
  FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

COMMENT ON TABLE expenses IS
  'Gastos del comercio (RESEARCH-BRIEF-gastos.md). El gasto es un hecho '
  'contable independiente del medio de pago; sólo el efectivo genera un '
  'cash_movements provider_payment. Append-only: corregir = gasto de ajuste. '
  'en_iva_compras separa lo que el estudio ya baja de ARCA de lo que el '
  'comercio tiene que mandar.';
