-- 0044 — Alivios de caja: qué retiro fue un alivio, y quién lo retiró después.
-- Pantalla: tarjeta "Alivios de caja" de pos-preview/caja-editorial.html.
--
-- Un ALIVIO es sacar efectivo del cajón para guardarlo (sobre, caja fuerte)
-- mientras la caja sigue abierta. Para el arqueo es un retiro y ya se
-- registraba así (cash_movements type='withdraw'): el esperado no cambia.
--
-- Lo que faltaba son dos hechos que la tarjeta muestra:
--   1. que ESE retiro fue un alivio. Hasta acá sólo lo decía el motivo
--      ("Alivio de caja"), que el cajero puede reescribir: no servía para
--      listarlos.
--   2. que la dueña (o un encargado) lo RETIRÓ, y cuándo: "retirado por …".
--
-- Las dos tablas son append-only. Un alivio no se "des-retira": si se marcó
-- por error, se corrige con un movimiento, no borrando la marca.

-- La FK compuesta a la caja necesita la unicidad (id, tenant_id), que crea la
-- 0043. Se repite el guard para que esta migración no dependa del orden.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_sessions_id_tenant_unico') THEN
    ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_id_tenant_unico UNIQUE (id, tenant_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS cash_reliefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  cash_session_id uuid NOT NULL,
  -- El retiro que lo representa en la caja. Uno a uno: un retiro es UN alivio.
  cash_movement_id bigint NOT NULL REFERENCES cash_movements(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cash_reliefs DROP CONSTRAINT IF EXISTS cash_reliefs_un_retiro;
ALTER TABLE cash_reliefs ADD CONSTRAINT cash_reliefs_un_retiro UNIQUE (cash_movement_id);
ALTER TABLE cash_reliefs DROP CONSTRAINT IF EXISTS cash_reliefs_id_tenant_unico CASCADE;
ALTER TABLE cash_reliefs ADD CONSTRAINT cash_reliefs_id_tenant_unico UNIQUE (id, tenant_id);
ALTER TABLE cash_reliefs DROP CONSTRAINT IF EXISTS cash_reliefs_caja_mismo_tenant;
ALTER TABLE cash_reliefs ADD CONSTRAINT cash_reliefs_caja_mismo_tenant
  FOREIGN KEY (cash_session_id, tenant_id) REFERENCES cash_sessions (id, tenant_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS cash_reliefs_tenant_session_idx ON cash_reliefs (tenant_id, cash_session_id);

CREATE TABLE IF NOT EXISTS cash_relief_pickups (
  -- PK = el alivio: se retira UNA vez. Un doble click no puede marcarlo dos.
  relief_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  picked_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  picked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cash_relief_pickups DROP CONSTRAINT IF EXISTS cash_relief_pickups_mismo_tenant;
ALTER TABLE cash_relief_pickups ADD CONSTRAINT cash_relief_pickups_mismo_tenant
  FOREIGN KEY (relief_id, tenant_id) REFERENCES cash_reliefs (id, tenant_id) ON DELETE RESTRICT;

-- ── Append-only ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION alivios_inmutables()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% es INSERT-only: un alivio y su retiro no se editan ni se '
    'borran. operation=%', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_reliefs_inmutable ON cash_reliefs;
CREATE TRIGGER cash_reliefs_inmutable BEFORE UPDATE OR DELETE ON cash_reliefs
  FOR EACH ROW EXECUTE FUNCTION alivios_inmutables();
DROP TRIGGER IF EXISTS cash_relief_pickups_inmutable ON cash_relief_pickups;
CREATE TRIGGER cash_relief_pickups_inmutable BEFORE UPDATE OR DELETE ON cash_relief_pickups
  FOR EACH ROW EXECUTE FUNCTION alivios_inmutables();

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE cash_reliefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_relief_pickups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_reliefs_tenant_isolation ON cash_reliefs;
CREATE POLICY cash_reliefs_tenant_isolation ON cash_reliefs FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));
DROP POLICY IF EXISTS cash_relief_pickups_tenant_isolation ON cash_relief_pickups;
CREATE POLICY cash_relief_pickups_tenant_isolation ON cash_relief_pickups FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

COMMENT ON TABLE cash_reliefs IS
  'Alivios de caja: marca qué retiro (cash_movements withdraw) fue un alivio. '
  'Append-only. El arqueo no cambia: el retiro ya restaba del esperado.';
COMMENT ON TABLE cash_relief_pickups IS
  'Quién retiró un alivio y cuándo ("retirado por …"). Uno por alivio. Append-only.';
