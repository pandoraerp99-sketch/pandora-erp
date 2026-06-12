-- =============================================================
-- Migration: CREATE TABLE wsaa_tokens (cache 12h tokens WSAA AFIP)
-- Aplicar DESPUÉS de 0011_padron_a5_cache.sql
-- Mini-audit pre-Sprint 6 fiscal + CLAUDE.md §17.2 + ADR-0019 S13
-- =============================================================
--
-- WSAA emite credential (token + sign) válida 12h. Cada llamada a WSFEv1
-- (y otros WS de negocio AFIP) requiere ambos. Cache evita re-login en
-- cada operación de venta cobrada.
--
-- **Aislamiento HARD homo/prod (ADR-0019 S13):**
-- - UNIQUE incluye environment → mismo tenant puede tener 2 tokens
--   (1 homo + 1 prod) durante period de transición.
-- - CHECK constraint sobre environment evita que un INSERT raw cuele
--   un valor fuera del enum AFIP_ENVIRONMENTS.
--
-- **Secrets**: token + sign son SECRETS. NUNCA loguear (lista CLAUDE.md
-- §10.5). RLS policy deberá restringir SELECT a service role o tenant
-- propio (Sprint 6 fiscal lo cablea cuando armemos AFIP service).

BEGIN;

CREATE TABLE IF NOT EXISTS wsaa_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  environment text NOT NULL,
  token text NOT NULL,
  sign text NOT NULL,

  generated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wsaa_tokens_tenant_env_unique UNIQUE (tenant_id, environment),

  CONSTRAINT wsaa_tokens_environment_check
    CHECK (environment IN ('homologacion', 'produccion')),

  CONSTRAINT wsaa_tokens_expiry_after_generation
    CHECK (expires_at > generated_at)
);

-- Index por (tenant_id, expires_at) — worker afip.refresh_wsaa_token busca
-- tokens próximos a vencer sin scan full.
CREATE INDEX IF NOT EXISTS wsaa_tokens_expiry_idx
  ON wsaa_tokens (tenant_id, expires_at);

COMMIT;
