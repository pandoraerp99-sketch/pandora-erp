-- 0040 — Adjuntar el comprobante (ítem 12 del pedido de la contadora).
--
-- El ítem 12 pide los COMPROBANTES: alquiler (con contrato), seguros,
-- servicios, impuestos y tasas, honorarios. Hasta acá Pandora daba la planilla
-- que los describe (`/gastos` + CSV) y no el archivo.
--
-- Brief: RESEARCH-BRIEF-adjuntos-comprobantes.md (decisiones del owner
-- 2026-09-19). Eventos `expense.attachment_added` / `_removed`: EVENT-TAXONOMY
-- v2.3.0, aprobados por el owner.
--
-- ── POR QUÉ NO ES UNA COLUMNA EN `expenses` ───────────────────────────────
-- El pedido dice "alquileres (CON CONTRATO)". Un contrato NO es un comprobante
-- de pago: es uno solo que respalda doce pagos mensuales. Colgado del gasto
-- quedaría grapado a un mes arbitrario —la contadora lo busca en enero y está
-- en marzo— o subido doce veces.
--
-- Entonces hay dos naturalezas y una sola tabla las distingue con `tipo`:
--   comprobante → cuelga del GASTO      (factura de luz, póliza, tasa)
--   contrato    → cuelga del TERCERO    (locación), con vigencia
--
-- `tipo` es explícito y no inferido de cuál FK vino nula: el CHECK ata las dos
-- cosas, así que no puede existir un 'contrato' colgando de un gasto.
--
-- ── POR QUÉ NO HAY DELETE ─────────────────────────────────────────────────
-- Mientras la contadora no conteste A-31 ("¿la foto reemplaza al papel?"), se
-- asume la rama conservadora: la copia digital ES el respaldo del gasto.
--
-- Bajo esa rama un DELETE físico no puede existir — borrarlo destruye el
-- respaldo y deja el gasto apuntando a nada. Es lo mismo que ya hace todo lo
-- que es respaldo acá: `audit_log` no admite UPDATE ni DELETE,
-- `stock_movements` se cancela con OTRO movimiento, y un gasto anulado sigue
-- visible en su pestaña. La baja es LÓGICA (`removed_at`), queda la fila,
-- queda el objeto, y `expense.attachment_removed` la audita.
--
-- Si A-31 vuelve con "el papel se guarda igual", relajar esto es barato.
-- Descubrir que hacía falta y no está, no.

-- ── El bucket ─────────────────────────────────────────────────────────────
-- PRIVADO (public=false). Un bucket público sirve los archivos a cualquiera
-- que adivine la URL, sin login y sin RLS: sería una fuga cross-tenant servida
-- por HTTP. Se baja siempre con URL firmada de vida corta.
--
-- El límite y los tipos van en el bucket y NO sólo en el código: la validación
-- del cliente la elige quien sube, ésta no.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes',
  'comprobantes',
  false,
  15728640,  -- 15 MiB: una foto de celular moderna entra; un video, no.
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── RLS del BUCKET ────────────────────────────────────────────────────────
-- ⚠️ Esto NO es el RLS de la tabla: son dos superficies distintas. La tabla
-- dice qué filas se ven; `storage.objects` dice qué BYTES se bajan. Con la
-- tabla protegida y el bucket abierto, el archivo del vecino igual se baja.
--
-- El path es `{tenant_id}/{attachment_id}`, así que la policy compara el
-- PRIMER SEGMENTO del nombre contra las empresas de la sesión. Usa el mismo
-- `pandora.current_company_ids()` que el resto del sistema, que ya contempla
-- al contador multi-empresa (ADR-0008).
DROP POLICY IF EXISTS comprobantes_tenant_select ON storage.objects;
CREATE POLICY comprobantes_tenant_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'comprobantes'
    AND (storage.foldername(name))[1] IN (
      SELECT cid::text FROM pandora.current_company_ids() AS cid
    )
  );

DROP POLICY IF EXISTS comprobantes_tenant_insert ON storage.objects;
CREATE POLICY comprobantes_tenant_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'comprobantes'
    AND (storage.foldername(name))[1] IN (
      SELECT cid::text FROM pandora.current_company_ids() AS cid
    )
  );

-- Sin policy de UPDATE ni de DELETE sobre el bucket, a propósito: el objeto no
-- se pisa ni se borra (ver "POR QUÉ NO HAY DELETE"). Un adjunto equivocado se
-- da de baja y se sube otro, que es lo mismo que hace un gasto mal cargado.

-- ── La tabla ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  -- 'comprobante' cuelga del gasto · 'contrato' cuelga del tercero.
  tipo text NOT NULL,

  expense_id uuid REFERENCES expenses(id) ON DELETE RESTRICT,
  tercero_id uuid REFERENCES terceros(id) ON DELETE RESTRICT,

  -- Lo que el usuario ve. El nombre REAL en el bucket es el id, así que dos
  -- "factura.pdf" no se pisan.
  nombre_original text NOT NULL,
  content_type text NOT NULL,
  bytes bigint NOT NULL,

  -- Para poder decir "este archivo es el que se subió" años después, y para
  -- que el evento de audit identifique el contenido sin guardarlo.
  sha256 text NOT NULL,

  -- `{tenant_id}/{id}`. Se guarda explícito y no se arma al leer: si algún día
  -- cambia el esquema de paths, los viejos siguen encontrándose.
  storage_path text NOT NULL,

  -- Sólo para 'contrato': un contrato de locación rige entre dos fechas y eso
  -- es lo que lo hace servir para doce pagos.
  vigencia_desde date,
  vigencia_hasta date,

  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Baja LÓGICA. Ver arriba.
  removed_at timestamptz,
  removed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  removed_reason text,

  CONSTRAINT attachments_tipo_check
    CHECK (tipo IN ('comprobante', 'contrato')),

  -- El tipo y el dueño tienen que coincidir: no existe un contrato colgado de
  -- un gasto ni un comprobante colgado de un proveedor.
  CONSTRAINT attachments_dueno_check CHECK (
    (tipo = 'comprobante' AND expense_id IS NOT NULL AND tercero_id IS NULL)
    OR
    (tipo = 'contrato'    AND tercero_id IS NOT NULL AND expense_id IS NULL)
  ),

  -- La vigencia es del contrato. En un comprobante no significa nada, y
  -- dejarla entrar sería un dato que después alguien lee como si valiera.
  CONSTRAINT attachments_vigencia_check CHECK (
    tipo = 'contrato'
    OR (vigencia_desde IS NULL AND vigencia_hasta IS NULL)
  ),
  CONSTRAINT attachments_vigencia_orden_check CHECK (
    vigencia_desde IS NULL OR vigencia_hasta IS NULL
    OR vigencia_hasta >= vigencia_desde
  ),

  -- Una baja a medias (fecha sin autor) no se puede auditar.
  CONSTRAINT attachments_baja_check CHECK (
    (removed_at IS NULL AND removed_by IS NULL)
    OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  ),

  CONSTRAINT attachments_bytes_check CHECK (bytes > 0),
  CONSTRAINT attachments_path_unico UNIQUE (storage_path)
);

CREATE INDEX IF NOT EXISTS idx_attachments_tenant_expense
  ON attachments (tenant_id, expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_tenant_tercero
  ON attachments (tenant_id, tercero_id) WHERE tercero_id IS NOT NULL;

-- ── Inmutabilidad PARCIAL ─────────────────────────────────────────────────
-- DELETE: nunca. UPDATE: sólo las tres columnas de la baja lógica, y sólo de
-- "vigente" a "dado de baja" — un adjunto no resucita.
--
-- El trigger enumera lo que NO puede cambiar en vez de confiar en que el
-- código toque sólo lo correcto: es el mismo criterio que `audit_log`.
CREATE OR REPLACE FUNCTION attachments_solo_baja_logica()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attachments no admite DELETE: la baja es logica (removed_at). '
                    'Borrar el archivo destruiria el respaldo del gasto.';
  END IF;

  IF NEW.id            IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.tipo       IS DISTINCT FROM OLD.tipo
     OR NEW.expense_id IS DISTINCT FROM OLD.expense_id
     OR NEW.tercero_id IS DISTINCT FROM OLD.tercero_id
     OR NEW.sha256       IS DISTINCT FROM OLD.sha256
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.bytes        IS DISTINCT FROM OLD.bytes
     OR NEW.content_type IS DISTINCT FROM OLD.content_type
     OR NEW.nombre_original IS DISTINCT FROM OLD.nombre_original
     OR NEW.uploaded_by  IS DISTINCT FROM OLD.uploaded_by
     OR NEW.created_at   IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'attachments: solo se puede dar de baja (removed_at/by/reason); '
                    'el resto de la fila es inmutable';
  END IF;

  IF OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'attachments: un adjunto dado de baja no se puede reactivar';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attachments_no_delete ON attachments;
CREATE TRIGGER attachments_no_delete BEFORE DELETE ON attachments
  FOR EACH ROW EXECUTE FUNCTION attachments_solo_baja_logica();

DROP TRIGGER IF EXISTS attachments_update_acotado ON attachments;
CREATE TRIGGER attachments_update_acotado BEFORE UPDATE ON attachments
  FOR EACH ROW EXECUTE FUNCTION attachments_solo_baja_logica();

-- ── RLS de la TABLA, desde el minuto cero ─────────────────────────────────
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attachments_tenant_isolation ON attachments;
CREATE POLICY attachments_tenant_isolation ON attachments
  FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

COMMENT ON TABLE attachments IS
  'Comprobantes y contratos adjuntos (item 12 del pedido de la contadora). '
  'tipo=comprobante cuelga del gasto; tipo=contrato cuelga del tercero y lleva '
  'vigencia, porque un contrato de locacion respalda doce pagos. Sin DELETE: '
  'la baja es logica, porque mientras A-31 no se responda se asume que la copia '
  'digital ES el respaldo del gasto. Los BYTES viven en el bucket privado '
  '`comprobantes` con su propio RLS sobre storage.objects.';
