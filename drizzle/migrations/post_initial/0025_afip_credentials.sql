-- 0025 — Credenciales AFIP por tenant (certificado X.509 + clave privada).
--
-- ── POR QUE UNA TABLA Y NO UNA ENV VAR ────────────────────────────────────
-- Una env var `AFIP_CERT` global alcanzaría para el piloto de un solo
-- comercio, y despues habria que arrancarla de raiz. Peor: seria un
-- certificado COMPARTIDO entre tenants, que es exactamente lo que CLAUDE.md
-- §7.5 prohibe ("certificados X.509 AFIP: path por tenant, NUNCA shared").
-- Firmar con el cert de otro comercio no es un bug de UI: es emitir con la
-- identidad fiscal de un tercero.
--
-- ── EL CONTENIDO VA CIFRADO ───────────────────────────────────────────────
-- `cert_encrypted` y `private_key_encrypted` guardan el wire format del vault
-- (`src/lib/security/vault.ts`, AES-256-GCM con key versionada). En la base
-- NUNCA hay un PEM en claro: quien lea la tabla sin la key de cifrado no tiene
-- nada. Este es el PRIMER consumidor real del vault, que estaba escrito y sin
-- usar desde Sprint 1.
--
-- ── AISLAMIENTO HOMO / PROD (ADR-0019 S13) ────────────────────────────────
-- La clave es (tenant_id, environment). Un cert de homologacion NO puede
-- llegar al endpoint de produccion ni al reves: son filas distintas y el
-- codigo pide la del environment en que corre.

CREATE TABLE IF NOT EXISTS afip_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  -- 'homologacion' | 'produccion'
  environment text NOT NULL,

  -- CUIT con el que se pidio el certificado. Se guarda ACA y no se deriva de
  -- companies.cuit: son el mismo numero hoy, pero el cert se emite contra un
  -- CUIT concreto y si alguien corrige el de la empresa por un tipeo, el cert
  -- deja de corresponder y hay que verlo, no adivinarlo.
  cuit text NOT NULL,

  -- Wire format del vault. NUNCA un PEM en claro.
  cert_encrypted text NOT NULL,
  private_key_encrypted text NOT NULL,

  -- Cuando vence el X.509. AFIP los emite por 2 años; que se venza sin aviso
  -- es una caida fiscal silenciosa (fail-closed §8.12: cert vencido = NO
  -- emitir). Se guarda para poder avisar ANTES.
  expires_at timestamptz,

  -- Etiqueta legible para el operador ("pandora-homo", "pandora-prod-2026").
  alias text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE afip_credentials DROP CONSTRAINT IF EXISTS afip_credentials_env_check;
ALTER TABLE afip_credentials ADD CONSTRAINT afip_credentials_env_check
  CHECK (environment IN ('homologacion', 'produccion'));

-- El CUIT es 11 digitos, sin guiones. Guardarlo formateado rompe el TRA.
ALTER TABLE afip_credentials DROP CONSTRAINT IF EXISTS afip_credentials_cuit_check;
ALTER TABLE afip_credentials ADD CONSTRAINT afip_credentials_cuit_check
  CHECK (cuit ~ '^[0-9]{11}$');

-- Defensa en profundidad: si alguien guarda un PEM sin cifrar, el wire format
-- del vault no matchea y esto lo frena en la base. Un cert en claro en una
-- tabla es la clase de error que no se nota hasta el dump.
ALTER TABLE afip_credentials DROP CONSTRAINT IF EXISTS afip_credentials_encrypted_check;
ALTER TABLE afip_credentials ADD CONSTRAINT afip_credentials_encrypted_check
  CHECK (
    cert_encrypted LIKE 'v1:%'
    AND private_key_encrypted LIKE 'v1:%'
    AND cert_encrypted NOT LIKE '%BEGIN%'
    AND private_key_encrypted NOT LIKE '%BEGIN%'
  );

-- UNA credencial vigente por (tenant, environment).
CREATE UNIQUE INDEX IF NOT EXISTS afip_credentials_tenant_env_uq
  ON afip_credentials (tenant_id, environment);

ALTER TABLE afip_credentials ENABLE ROW LEVEL SECURITY;

-- RLS igual que el resto, PERO ojo: esto es material secreto. La defensa real
-- es que solo el service role lo lee (el path de emision corre server-side) y
-- que el contenido esta cifrado. La policy es la segunda linea, no la primera.
DROP POLICY IF EXISTS afip_credentials_tenant_isolation ON afip_credentials;
CREATE POLICY afip_credentials_tenant_isolation ON afip_credentials
  FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

COMMENT ON TABLE afip_credentials IS
  'Certificado X.509 + clave privada de AFIP por (tenant, environment). '
  'El contenido va CIFRADO con el vault (AES-256-GCM); nunca un PEM en claro. '
  'Aislado por environment para que un cert de homologacion no llegue a '
  'produccion (ADR-0019 S13).';
