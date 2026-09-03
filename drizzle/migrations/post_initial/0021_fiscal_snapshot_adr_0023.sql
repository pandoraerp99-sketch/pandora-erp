-- =============================================================
-- Migration: fiscal_snapshots — campos de ADR-0023
-- Aplicar DESPUES de 0020_rls_tablas_faltantes.sql
-- Cierra el drift ALTA detectado en la auditoria 2026-09-02: ADR-0023 figura
-- Aprobado y declara campos que el schema real NUNCA tuvo. La migration
-- `0006_fiscal_snapshot_v2.sql` que el ADR menciona jamas se creo.
-- =============================================================
--
-- Momento elegido: `fiscal_snapshots` esta VACIA (0 filas, verificado
-- 2026-09-03). No hay backfill ni riesgo de datos. Todas las columnas nuevas
-- son NULLABLE: no rompen la emision actual, y se llenan cuando el modulo
-- fiscal las produzca.
--
-- El trigger de inmutabilidad de la tabla bloquea UPDATE/DELETE de FILAS;
-- ALTER TABLE es DDL y no lo activa.
--
-- ── QUE SE AGREGA Y POR QUE ────────────────────────────────────────────────
--
-- 1) condicion_iva_receptor_id + _desc_at_emission  (ADR-0023 Decision 1)
--    RG 5616. El campo sigue siendo OPCIONAL en WSFEv1 al 2026-07 (Manual
--    COMPG v4.5 verificado — A-23.a), por eso NULLABLE es correcto y NO hay
--    que ponerlo NOT NULL todavia. Se persiste tambien la DESCRIPCION vigente
--    al momento de emitir para que el snapshot se interprete solo en una
--    auditoria a 10 anios, sin depender de un catalogo externo.
--
-- 2) qr_version + qr_payload_json + qr_url_base_at_emission (Decision 2)
--    RG 4892/2020. El QR es OBLIGATORIO en el comprobante impreso, asi que
--    esto es F0, no diferible. Se persiste el PAYLOAD (13 campos verificados
--    contra el manual del QR), NO la imagen: el PNG es derivable y regenerarlo
--    da el mismo QR valido. Guardar la URL base vigente al emitir permite
--    reproducir el QR exacto si ARCA cambia el dominio.
--
-- 3) authorization_code_type  (Decision 4)
--    RG 5782/5785. Hoy la tabla solo tiene `cae`. Cuando entre CAEA (F0.5)
--    hace falta saber cual de los dos es. DEFAULT 'CAE' porque F0 es
--    CAE-online; el CHECK impide un tercer valor por error.
--
-- 4) wsfe_manual_revision
--    Ancla contra que REVISION del manual se construyo el payload. Complementa
--    `tax_policy_version` (que ancla la politica fiscal): juntos permiten
--    reproducir la emision anios despues.
--
-- ── QUE NO SE AGREGA, Y POR QUE (decisiones explicitas, no olvidos) ────────
--
-- · condicion_iva_receptor_catalog_version_at_emission
--   El ADR lo pide porque asume el patron de ADR-0025 (catalogos traidos en
--   RUNTIME, cada uno con su version). Ese ADR quedo DIFERIDO A F1+ el
--   2026-09-03: en F0 los catalogos son una fotografia versionada en
--   `afip-codes.ts`, y quien la identifica es `tax_policy_version`, que ya
--   esta en la tabla. Agregar la columna ahora seria guardar un valor
--   redundante o vacio. Se suma junto con `catalogs/` cuando ADR-0025 se
--   promueva.
--
-- · fx_rate / precision_internal
--   F0 es ARS-only con precision fija (numeric 19,4 + HALF_EVEN, ADR-0005).
--   Serian columnas con un valor constante en todas las filas. Ademas la
--   cotizacion que importa fiscalmente ya viaja DENTRO del QR (`ctz`).
--   Se agregan cuando exista multi-moneda real (F2+).
--
-- · customer_snapshot_ref
--   Ya existe por `sale_id`: el snapshot del cliente vive en `sales`
--   (customer_*_snapshot, inmutables post-emision). Una FK mas seria
--   duplicar la fuente de verdad (CLAUDE.md §20.26).
-- =============================================================

BEGIN;

-- ── ADR-0023 Decision 1 — Condicion IVA del receptor (RG 5616) ────────────
ALTER TABLE fiscal_snapshots
  ADD COLUMN IF NOT EXISTS condicion_iva_receptor_id integer;

ALTER TABLE fiscal_snapshots
  ADD COLUMN IF NOT EXISTS condicion_iva_receptor_desc_at_emission text;

COMMENT ON COLUMN fiscal_snapshots.condicion_iva_receptor_id IS
  'RG 5616. ID oficial ARCA de la condicion IVA del receptor. NULLABLE: el campo sigue siendo OPCIONAL en WSFEv1 al 2026-07 (Manual COMPG v4.5). Pasa a NOT NULL cuando ARCA anuncie la obligatoriedad (rechazo 10245).';

COMMENT ON COLUMN fiscal_snapshots.condicion_iva_receptor_desc_at_emission IS
  'Descripcion vigente al momento de emitir (ej. "IVA Responsable Inscripto"). Hace el snapshot autosuficiente: se interpreta sin consultar un catalogo externo 10 anios despues.';

-- ── ADR-0023 Decision 2 — QR fiscal (RG 4892/2020) ────────────────────────
ALTER TABLE fiscal_snapshots
  ADD COLUMN IF NOT EXISTS qr_version integer;

ALTER TABLE fiscal_snapshots
  ADD COLUMN IF NOT EXISTS qr_payload_json jsonb;

ALTER TABLE fiscal_snapshots
  ADD COLUMN IF NOT EXISTS qr_url_base_at_emission text;

COMMENT ON COLUMN fiscal_snapshots.qr_payload_json IS
  'RG 4892/2020. Payload JSON del QR (13 campos: ver/fecha/cuit/ptoVta/tipoCmp/nroCmp/importe/moneda/ctz/tipoDocRec/nroDocRec/tipoCodAut/codAut). Se persiste el PAYLOAD, NO la imagen: el PNG es derivable y regenerarlo produce el mismo QR valido.';

COMMENT ON COLUMN fiscal_snapshots.qr_url_base_at_emission IS
  'URL base de ARCA vigente al emitir. Permite reproducir el QR exacto si ARCA cambia el dominio.';

-- ── ADR-0023 Decision 4 — CAE vs CAEA (RG 5782/5785) ──────────────────────
ALTER TABLE fiscal_snapshots
  ADD COLUMN IF NOT EXISTS authorization_code_type text NOT NULL DEFAULT 'CAE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fiscal_snapshots_authorization_code_type_check'
  ) THEN
    ALTER TABLE fiscal_snapshots
      ADD CONSTRAINT fiscal_snapshots_authorization_code_type_check
      CHECK (authorization_code_type IN ('CAE', 'CAEA'));
  END IF;
END $$;

COMMENT ON COLUMN fiscal_snapshots.authorization_code_type IS
  'RG 5782/5785. Que tipo de autorizacion respalda el comprobante. DEFAULT CAE porque F0 es CAE-online; CAEA entra en F0.5 como contingencia.';

-- ── Anclaje de la revision del manual ─────────────────────────────────────
ALTER TABLE fiscal_snapshots
  ADD COLUMN IF NOT EXISTS wsfe_manual_revision text;

COMMENT ON COLUMN fiscal_snapshots.wsfe_manual_revision IS
  'Revision del Manual COMPG contra la que se construyo el payload (ej. COMPG_v4.5). Junto con tax_policy_version permite reproducir la emision anios despues.';

COMMIT;
