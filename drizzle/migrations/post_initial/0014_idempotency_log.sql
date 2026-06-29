-- =============================================================
-- Migration: idempotency_log — dedup de mutaciones críticas (ADR-0010)
-- Aplicar DESPUÉS de 0013_rls_padron_wsaa.sql
-- =============================================================
--
-- ADR-0010 (Idempotency obligatoria) + CLAUDE.md §13.2.
--
-- Propósito: dedup de requests duplicados en mutaciones críticas (crear
-- venta, procesar pago, anular venta, cerrar turno, emitir factura). El
-- cliente genera una idempotency_key (UUID) por operación; si reintenta
-- (timeout de red, doble click, retry) con la MISMA key, el server NO
-- re-ejecuta — devuelve el resultado cacheado.
--
-- ── PATRÓN: reserve-first (NO do-then-insert) ──
--   El análogo processed_webhook_events hace do-work-then-INSERT, válido
--   ahí porque es DB-only y dedup best-effort. Acá NO: para mutaciones con
--   efectos externos NO-rollbackeables (emisión CAE en Sprint 6), dos
--   duplicados concurrentes ejecutarían AMBOS el side effect antes de que
--   el UNIQUE elija ganador. Reserve-first: clamar la key PRIMERO (INSERT
--   pending, commit) → recién después hacer el trabajo → llenar el result.
--   El perdedor ve 'pending' y NO ejecuta el side effect.
--
-- ── DESVIACIÓN de ADR-0010 (surfaceada, CLAUDE.md §22.8) ──
--   El ADR especifica `result jsonb NOT NULL` + "INSERT then process". Es
--   incompatible: al clamar la key todavía NO existe el result. Solución:
--   columna `status` ('pending'|'completed') + `result` NULLABLE (NULL
--   mientras pending). Propuesta de nota a ADR-0010 en el DECISION-LEDGER.
--
-- ── Scope angosto (advisor) ──
--   Este log dedupea REQUESTS DUPLICADOS, NO hace recovery de crash-mid-
--   operación (eso es la Reconciliation Engine, Sprint 7, vía
--   FECompUltimoAutorizado). Un row 'pending' huérfano (clamó y falló fn /
--   murió el proceso) es ACEPTABLE F0: el cliente reintenta con key nueva;
--   un crash fiscal lo resuelve la reconciliación. NO hay lease/expiry F0.
--
-- ── RLS (idéntico a 0013 padron/wsaa) ──
--   El helper withIdempotency corre con el role privileged (bypassa RLS) +
--   filtra por tenant_id; las policies son defensa en profundidad para el
--   path authenticated. DELETE sin policy (solo service_role cron cleanup).

BEGIN;

CREATE TABLE idempotency_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  operation text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,                                  -- NULL mientras pending
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  -- El UNIQUE crea el índice que usa el lookup por (tenant, key) — no hace
  -- falta un index extra.
  CONSTRAINT uq_idempotency_log_tenant_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT chk_idempotency_log_status CHECK (status IN ('pending', 'completed')),
  -- Coherencia: completed_at se llena exactamente cuando status='completed'.
  CONSTRAINT chk_idempotency_log_completed CHECK (
    (status = 'pending'   AND completed_at IS NULL) OR
    (status = 'completed' AND completed_at IS NOT NULL)
  )
);

-- ── RLS ──
ALTER TABLE idempotency_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY idempotency_log_select ON idempotency_log
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY idempotency_log_insert ON idempotency_log
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

CREATE POLICY idempotency_log_update ON idempotency_log
  FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

-- DELETE intencionalmente sin policy — solo service_role (cron cleanup TTL,
-- keys > retención) puede borrar. Path autenticado NUNCA borra.

COMMIT;
