-- 0041 — El adjunto no puede colgar del gasto de OTRO comercio.
--
-- La 0040 dejó las FK apuntando a `expenses(id)` y `terceros(id)` a secas, sin
-- el tenant. Con eso, esta fila entraba sin que nada se quejara:
--
--     tenant_id = A  ·  expense_id = <un gasto de B>
--
-- El RLS no la ve venir: la fila lleva `tenant_id = A`, así que pasa el
-- `WITH CHECK` sin despeinarse. La FK tampoco: el gasto de B existe. El único
-- que podía impedirlo era el código que arma el INSERT — o sea, nada estructural.
--
-- Es exactamente lo que CLAUDE.md §7.2 dice que no alcanza, y el test T-ADJ-01
-- lo demostró contra la base real: el INSERT cruzado "(no falló)".
--
-- ── Por qué FK compuesta y no un trigger ──────────────────────────────────
-- Un trigger que compare tenants sería código corriendo por fila, testeable y
-- olvidable. La FK compuesta hace el estado **irrepresentable**: no hay forma
-- de escribir esa fila, ni desde un service con bug, ni desde psql, ni desde
-- una migración futura.
--
-- Se hace AHORA y no después: agregar FKs compuestas con filas ya cargadas es
-- el orden caro. La tabla se creó ayer y está vacía.

-- Postgres exige un UNIQUE del lado referenciado que cubra exactamente las
-- columnas de la FK. `id` ya es PK, así que este índice es redundante para
-- buscar — existe para habilitar la referencia compuesta.
--
-- Se crean con IF NOT EXISTS y NO con drop+create: al re-aplicar la migración,
-- el DROP explota porque las FK compuestas de abajo dependen de este índice
-- ("cannot drop constraint ... because other objects depend on it"). Las
-- migraciones acá se re-aplican seguido —`scripts/aplicar-adjuntos.sh` y la
-- guardia de mutaciones lo hacen— así que tienen que ser idempotentes de verdad.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_id_tenant_unico'
  ) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_id_tenant_unico UNIQUE (id, tenant_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'terceros_id_tenant_unico'
  ) THEN
    ALTER TABLE terceros ADD CONSTRAINT terceros_id_tenant_unico UNIQUE (id, tenant_id);
  END IF;
END
$$;

-- Las FK viejas (sólo `id`) se van: dejarlas no rompe nada pero deja dos
-- reglas para la misma relación, y la próxima persona no sabría cuál manda.
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_expense_id_expenses_id_fk;
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_tercero_id_terceros_id_fk;

ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_expense_mismo_tenant;
ALTER TABLE attachments ADD CONSTRAINT attachments_expense_mismo_tenant
  FOREIGN KEY (expense_id, tenant_id)
  REFERENCES expenses (id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_tercero_mismo_tenant;
ALTER TABLE attachments ADD CONSTRAINT attachments_tercero_mismo_tenant
  FOREIGN KEY (tercero_id, tenant_id)
  REFERENCES terceros (id, tenant_id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT attachments_expense_mismo_tenant ON attachments IS
  'El comprobante y su gasto son del MISMO comercio. Con la FK sólo por id, un '
  'INSERT con tenant_id de A y expense_id de B pasaba el RLS (su propio '
  'tenant_id es A) y la FK (el gasto existe). Ver T-ADJ-01.';
