-- =============================================================
-- Migration: Particionar audit_log por anio
-- Aplicar DESPUES de la migracion inicial 0000_*.sql de drizzle-kit.
-- CLAUDE.md §10.2 — retention 10 anios via DROP PARTITION.
-- =============================================================

-- Drizzle-kit crea audit_log como tabla normal. Hay que reemplazarla por una particionada.
-- Si NO hay datos aun (caso F0 antes del primer cliente), es seguro DROP + recrear.
-- Si ya hay datos en prod, este script NO es seguro — usar el procedimiento alternativo
-- documentado en RUNBOOKS/audit-log-partition-migration.md (a crear post-prod).

BEGIN;

-- Verificar que la tabla esta vacia antes de drop.
DO $$
DECLARE
  row_count bigint;
BEGIN
  SELECT count(*) INTO row_count FROM audit_log;
  IF row_count > 0 THEN
    RAISE EXCEPTION 'audit_log tiene % filas. Migracion solo permitida en tabla vacia. Ver RUNBOOKS.', row_count;
  END IF;
END $$;

-- DROP tabla regular generada por drizzle-kit.
DROP TABLE IF EXISTS audit_log CASCADE;

-- Recrear como particionada por anio.
CREATE TABLE audit_log (
  id            bigserial NOT NULL,
  event_name    text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  tenant_id     uuid NOT NULL,
  actor_user_id uuid,
  actor_type    text NOT NULL,
  correlation_id uuid NOT NULL,
  request_id    uuid NOT NULL,
  payload       jsonb NOT NULL,
  pii_level     text NOT NULL DEFAULT 'internal',
  severity      text NOT NULL DEFAULT 'info',
  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id, created_at),

  CONSTRAINT audit_log_actor_type_check
    CHECK (actor_type IN ('user', 'system', 'support', 'cron', 'worker')),
  CONSTRAINT audit_log_pii_level_check
    CHECK (pii_level IN ('public', 'internal', 'pii_low', 'pii_high', 'secret')),
  CONSTRAINT audit_log_severity_check
    CHECK (severity IN ('info', 'notice', 'warning', 'error', 'critical'))
)
PARTITION BY RANGE (created_at);

-- Particion para anio actual + proximo.
-- Cron de diciembre crea la del anio siguiente (ver workers/cron.partition_audit_log.ts F1+).
CREATE TABLE audit_log_2026 PARTITION OF audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE TABLE audit_log_2027 PARTITION OF audit_log
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

-- Indexes en cada particion (crearlos en la parent NO los propaga si ya hay particiones).
CREATE INDEX audit_log_tenant_time_idx ON audit_log (tenant_id, created_at);
CREATE INDEX audit_log_correlation_idx ON audit_log (correlation_id);
CREATE INDEX audit_log_event_name_idx ON audit_log (tenant_id, event_name, created_at);

COMMIT;

-- Comentario para auditoria del schema.
COMMENT ON TABLE audit_log IS
  'Append-only audit log particionado por anio. Trigger inmutable en 0002. Retention 10 anios via DROP PARTITION (CLAUDE.md §10.2).';
