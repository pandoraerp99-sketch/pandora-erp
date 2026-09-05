-- 0023 — Registro de clientes.
--
-- Hasta ahora el cliente existía SOLO como snapshot dentro de la venta
-- (`sales.customer_name_snapshot`, `customer_tax_condition_snapshot`). Eso
-- alcanza para facturar, pero no para tener una agenda: no se puede buscar un
-- cliente, ni saber cuáles son los que vuelven, ni etiquetarlos.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, Y ES DELIBERADO ─────────────────────────
--
-- **No toca los snapshots de `sales`.** El nombre y la condición de IVA que
-- quedaron en una venta son INMUTABLES post-emisión (CLAUDE.md §2.3): si un
-- cliente cambia de Monotributo a Responsable Inscripto el año que viene, las
-- facturas viejas NO pueden cambiar retroactivamente lo que dicen. Por eso
-- `customer_id` es una referencia opcional de "quién era", y la autoridad de
-- lo que dice el comprobante sigue siendo el snapshot.
--
-- **No hay cuenta corriente ni deuda.** La maqueta las muestra, pero la deuda
-- es un dominio de DINERO: necesita su propio libro de movimientos
-- append-only (como `stock_movements` o `sale_payments`), un flujo de pago
-- contra deuda, y toca el cierre de caja (un cliente que paga la cuenta en
-- efectivo es plata del cajón). Poner un campo `deuda` acá seria un número sin
-- libro detrás. Va cuando se construya el dominio, con su ADR.
--
-- ── LAS DOS CLASIFICACIONES SON ORTOGONALES ───────────────────────────────
-- (research CLIENTES-research.md, 2026-07-03)
--
--   tax_condition (FISCAL)  → UNA por cliente. Determina el tipo de
--                             comprobante (A/B/C) y viaja a ARCA como
--                             CondicionIVAReceptorId (RG 5616).
--   tags (COMERCIAL)        → VARIAS por cliente. Las inventa el comerciante
--                             (Jubilados, Vecinos, Mayoristas...) y habilitan
--                             promos segmentadas.
--
-- Un Mayorista puede ser RI o Monotributo; un Jubilado casi siempre es
-- Consumidor Final pero eso es su condición fiscal, no su segmento. Mezclarlas
-- en un solo campo rompe las dos cosas.
--
-- ── POR QUÉ tags ES UN ARRAY Y NO DOS TABLAS ──────────────────────────────
-- Mismo criterio que `products.category` (migration 0022): el vocabulario se
-- DERIVA de lo que hay en uso, sin tabla de catálogo ni CRUD aparte. El
-- comerciante escribe "Vecinos" y el tag existe; no hace falta migración ni
-- pantalla de administración para inventar un segmento.
-- **Disparador para promover a tabla propia:** cuando Ofertas necesite un tag
-- con CERO clientes asignados (crearlo antes de usarlo), o cuando renombrar un
-- tag tenga que propagarse solo. Hasta entonces sería un CRUD sin caso de uso.

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  name text NOT NULL,

  -- Documento. NULL = cliente sin identificar (consumidor final anónimo, que
  -- es la mayoría en un kiosco). Los tipos son los mismos que usa la venta.
  doc_type text NOT NULL DEFAULT 'none',
  doc_number text,

  -- Condición frente al IVA. Es el campo FISCAL, el que decide el comprobante.
  tax_condition text,

  -- Contacto. Todo opcional: un cliente puede ser sólo un nombre.
  email text,
  phone text,
  address text,
  notes text,

  -- Segmentos comerciales. Array vacío = sin etiquetar.
  tags text[] NOT NULL DEFAULT '{}',

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_doc_type_check;
ALTER TABLE customers ADD CONSTRAINT customers_doc_type_check
  CHECK (doc_type IN ('DNI', 'CUIT', 'CUIL', 'none'));

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_name_not_blank;
ALTER TABLE customers ADD CONSTRAINT customers_name_not_blank
  CHECK (length(btrim(name)) > 0);

-- Un documento no puede repetirse dentro del mismo comercio. Parcial: los
-- clientes sin documento (consumidor final) no colisionan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_doc_unique_partial
  ON customers (tenant_id, doc_type, doc_number)
  WHERE doc_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_tenant_idx ON customers (tenant_id);
-- Búsqueda por nombre, igual que products (pg_trgm ya está instalada).
CREATE INDEX IF NOT EXISTS customers_name_trgm_idx
  ON customers USING gin (name gin_trgm_ops);
-- Filtrar por segmento comercial dentro del tenant.
CREATE INDEX IF NOT EXISTS customers_tags_idx ON customers USING gin (tags);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- OBLIGATORIO desde el minuto cero. La migración 0020 tuvo que cerrar 8 tablas
-- que habían nacido sin RLS y resultó ser una fuga ACTIVA vía PostgREST con la
-- anon key pública. Una tabla nueva NO se crea sin esto.
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_tenant_isolation ON customers;
CREATE POLICY customers_tenant_isolation ON customers
  FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ── Referencia opcional desde la venta ─────────────────────────────────────
-- "Quién era", para poder listar las compras de un cliente. NO reemplaza los
-- snapshots: esos siguen siendo la autoridad de lo que dice el comprobante.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_customer_idx ON sales (tenant_id, customer_id) WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN sales.customer_id IS
  'Referencia opcional al cliente del registro. NO es la autoridad de lo que '
  'dice el comprobante: para eso están customer_name_snapshot y '
  'customer_tax_condition_snapshot, que son inmutables post-emision.';

COMMENT ON COLUMN customers.tags IS
  'Segmentos comerciales definidos por el comerciante (Jubilados, Vecinos...). '
  'El vocabulario se deriva de lo que hay en uso, no hay tabla de catalogo. '
  'NO confundir con tax_condition, que es la clasificacion FISCAL.';
