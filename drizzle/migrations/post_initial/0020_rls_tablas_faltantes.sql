-- =============================================================
-- Migration: RLS en las 8 tablas tenant-aware que quedaron sin proteger
--            + las particiones de audit_log
-- Aplicar DESPUES de 0019_terceros_y_egreso_estructurado.sql
-- ADR-0002 + CLAUDE.md §7.2 (RLS = capa 1) + §7.6 (invariante: NO existe
-- query sin company_id filter en tablas tenant-aware)
-- =============================================================
--
-- ⚠️ ESTO TAPA UNA FUGA CROSS-TENANT ACTIVA, NO UN RIESGO TEORICO.
--
-- Verificado contra la base viva el 2026-09-02: estas 8 tablas tenian
-- `relrowsecurity = f` y CERO policies. Como Supabase expone PostgREST
-- (`NEXT_PUBLIC_SUPABASE_URL`), y la anon key VIAJA AL BROWSER, cualquiera
-- con esa key publica leia datos de TODOS los tenants:
--
--   GET /rest/v1/sale_payments   -> 59 filas (todos los comercios)
--   GET /rest/v1/metrics_counter -> 202 filas
--   GET /rest/v1/cash_sessions   -> 2 filas (con tenant_id visible)
--   GET /rest/v1/cash_movements  -> 2 filas
--   GET /rest/v1/stock_movements -> 2 filas
--
-- Las tablas que SI tenian RLS (sales, products, audit_log) devolvian 0
-- filas al mismo request — o sea, el mecanismo funciona; a estas 8 nunca
-- se les aplico. mp_payments / jobs_queue / processed_webhook_events
-- devolvian 0 solo porque estaban VACIAS: iban a filtrar igual al poblarse.
--
-- Por que no se detecto antes: el cliente `db` de la app conecta con un role
-- que tiene `rolbypassrls = t` (postgres), asi que RLS nunca aplica al path
-- de la app y ningun test de la suite (961 verdes) lo ejercita. El vector
-- real es PostgREST, que corre como `anon`/`authenticated` (rolbypassrls = f).
--
-- POR QUE NO PUEDE ROMPER NADA:
--   - El path de la app (incluido el webhook de MercadoPago) usa el cliente
--     postgres con rolbypassrls = t -> estas policies son transparentes para el.
--     En particular NO afecta el dedup `INSERT ... ON CONFLICT DO NOTHING
--     RETURNING` de processed_webhook_events, que corre con bypass.
--   - El cliente Supabase JS solo se usa para AUTH (login/session/proxy);
--     verificado: no hay ni un `.from()` de datos en src/.
--   - Los workers y crons corren con service_role, que tambien bypassa.
--
-- PATRON (identico a 0003 / 0013):
--   SELECT/INSERT/UPDATE -> tenant_id IN (SELECT pandora.current_company_ids())
--   Sin policy de DELETE  -> solo service_role (bypass) puede borrar.
--   Tablas append-only (trigger de inmutabilidad) NO llevan policy de UPDATE:
--   seria engañoso sugerir que el UPDATE es posible cuando el trigger lo bloquea.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE, para que
-- `pnpm db:apply-all` se pueda re-correr sin explotar.
-- =============================================================

BEGIN;

-- ----------------------------------------------------------------
-- cash_sessions  (tenant_id directo; mutable: se abre y se cierra)
-- ----------------------------------------------------------------
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_sessions_select_own ON cash_sessions;
CREATE POLICY cash_sessions_select_own ON cash_sessions
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS cash_sessions_insert_own ON cash_sessions;
CREATE POLICY cash_sessions_insert_own ON cash_sessions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS cash_sessions_update_own ON cash_sessions;
CREATE POLICY cash_sessions_update_own ON cash_sessions
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- cash_movements  (NO tiene tenant_id: se resuelve por su cash_session)
-- append-only (trigger 0007) -> sin policy de UPDATE
-- ----------------------------------------------------------------
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_movements_select_own ON cash_movements;
CREATE POLICY cash_movements_select_own ON cash_movements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM cash_sessions s
      WHERE s.id = cash_movements.cash_session_id
        AND s.tenant_id IN (SELECT pandora.current_company_ids())
    )
  );

DROP POLICY IF EXISTS cash_movements_insert_own ON cash_movements;
CREATE POLICY cash_movements_insert_own ON cash_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cash_sessions s
      WHERE s.id = cash_movements.cash_session_id
        AND s.tenant_id IN (SELECT pandora.current_company_ids())
    )
  );

-- ----------------------------------------------------------------
-- sale_payments  (append-only, trigger sale_payments_immutable en 0008;
-- las correcciones son filas nuevas con corrects_id — ADR-0026)
-- ----------------------------------------------------------------
ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_payments_select_own ON sale_payments;
CREATE POLICY sale_payments_select_own ON sale_payments
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS sale_payments_insert_own ON sale_payments;
CREATE POLICY sale_payments_insert_own ON sale_payments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- mp_payments  (mutable: el webhook actualiza status)
-- ----------------------------------------------------------------
ALTER TABLE mp_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mp_payments_select_own ON mp_payments;
CREATE POLICY mp_payments_select_own ON mp_payments
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS mp_payments_insert_own ON mp_payments;
CREATE POLICY mp_payments_insert_own ON mp_payments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS mp_payments_update_own ON mp_payments;
CREATE POLICY mp_payments_update_own ON mp_payments
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- stock_movements  (append-only, trigger 0005)
-- ----------------------------------------------------------------
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_movements_select_own ON stock_movements;
CREATE POLICY stock_movements_select_own ON stock_movements
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS stock_movements_insert_own ON stock_movements;
CREATE POLICY stock_movements_insert_own ON stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- metrics_counter  (mutable: contador se incrementa con ON CONFLICT)
-- Las filas de sistema (SYSTEM_TENANT_ID = 000...0) quedan INVISIBLES para
-- `authenticated` a proposito: son operativas, no datos del comerciante.
-- Los workers/crons que las escriben corren con bypass, asi que no se rompen.
-- ----------------------------------------------------------------
ALTER TABLE metrics_counter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS metrics_counter_select_own ON metrics_counter;
CREATE POLICY metrics_counter_select_own ON metrics_counter
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS metrics_counter_insert_own ON metrics_counter;
CREATE POLICY metrics_counter_insert_own ON metrics_counter
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS metrics_counter_update_own ON metrics_counter;
CREATE POLICY metrics_counter_update_own ON metrics_counter
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- jobs_queue  (mutable: transiciones de status)
-- Misma nota de SYSTEM_TENANT_ID que metrics_counter.
-- ----------------------------------------------------------------
ALTER TABLE jobs_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jobs_queue_select_own ON jobs_queue;
CREATE POLICY jobs_queue_select_own ON jobs_queue
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS jobs_queue_insert_own ON jobs_queue;
CREATE POLICY jobs_queue_insert_own ON jobs_queue
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS jobs_queue_update_own ON jobs_queue;
CREATE POLICY jobs_queue_update_own ON jobs_queue
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- processed_webhook_events  (dedup append-only)
-- El dedup real corre con bypass (cliente postgres), asi que estas policies
-- NO participan del camino del webhook. Estan para que la tabla no sea
-- legible por anon via PostgREST.
-- ----------------------------------------------------------------
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS processed_webhook_events_select_own ON processed_webhook_events;
CREATE POLICY processed_webhook_events_select_own ON processed_webhook_events
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

DROP POLICY IF EXISTS processed_webhook_events_insert_own ON processed_webhook_events;
CREATE POLICY processed_webhook_events_insert_own ON processed_webhook_events
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- ----------------------------------------------------------------
-- audit_log — PARTICIONES  (D-25)
-- ----------------------------------------------------------------
-- El padre `audit_log` YA tiene RLS + 2 policies desde 0003. Pero en Postgres
-- las policies del padre solo aplican cuando se consulta A TRAVES del padre:
-- si alguien consulta la particion directamente, manda el RLS de la particion.
--
-- Demostrado el 2026-09-02 con role=authenticated y JWT de un tenant:
--   SELECT count(*) FROM audit_log       ->    3 filas (filtrado OK)
--   SELECT count(*) FROM audit_log_2026  -> 1192 filas (TODOS los tenants)
--
-- PostgREST no expone particiones (devuelve 404), asi que este vector NO es
-- remotamente explotable como el de arriba — pero si lo es desde cualquier
-- conexion directa con un role sin bypass. Se tapa igual: el audit_log es la
-- tabla que sostiene la defensa ante inspeccion de ARCA.
--
-- Append-only (triggers de inmutabilidad) -> solo SELECT.
--
-- ⚠️ TODA PARTICION NUEVA NACE SIN RLS. `CREATE TABLE ... PARTITION OF` no
-- hereda ni el ENABLE ni las policies. Quien implemente el job
-- `cron.partition_audit_log` DEBE incluir estas dos sentencias para el año
-- que crea, o el agujero vuelve solo en enero, en silencio.
-- ----------------------------------------------------------------
ALTER TABLE audit_log_2026 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_2026_select_own ON audit_log_2026;
CREATE POLICY audit_log_2026_select_own ON audit_log_2026
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

ALTER TABLE audit_log_2027 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_2027_select_own ON audit_log_2027;
CREATE POLICY audit_log_2027_select_own ON audit_log_2027
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

COMMIT;
