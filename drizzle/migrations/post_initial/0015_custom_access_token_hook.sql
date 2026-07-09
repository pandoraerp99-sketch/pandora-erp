-- =============================================================
-- Migration: Custom Access Token Hook — inyecta claims Pandora al JWT
-- Aplicar DESPUÉS de 0014_idempotency_log.sql
-- ADR-0002 (multi-tenant RLS + JWT claims) + ADR-0008 (accountant multi-empresa)
-- CLAUDE.md §7.2/§7.3 — el RLS depende de company_id/company_ids en el JWT
-- =============================================================
--
-- CONTEXTO
-- --------
-- El RLS de Pandora (`pandora.current_company_ids()`, 0003_rls_policies.sql)
-- lee `auth.jwt() ->> 'company_id'` y `auth.jwt() -> 'company_ids'`. Pero
-- Supabase Auth NO pone esos claims por sí solo — hay que inyectarlos con un
-- Custom Access Token Hook (función Postgres que corre al emitir cada token).
-- Sin este hook, un login real produce un JWT SIN company_id → RLS devuelve
-- cero filas → toda la app tenant-aware se cae. Este es el linchpin de auth.
--
-- CONTRATO (doc oficial Supabase, verificado 2026-07-09)
-- -----------------------------------------------------
--   input : { user_id, claims: {...}, authentication_method }
--   output: el mismo event con `claims` modificado (o { error }).
-- Claims que Pandora agrega (ver src/lib/auth/jwt.ts):
--   - company_id        (single, para owner/admin/cashier)
--   - company_ids       (array, para accountant multi-empresa — ADR-0008)
--   - active_company_id  (empresa activa; = company_id salvo accountant)
--   - app_role          ('owner'|'admin'|'cashier'|'accountant')
--   - is_support        (bool, desde users.is_support)
--
-- SEGURIDAD
-- ---------
-- SECURITY DEFINER: la función corre como su owner (postgres) y así bypassa
-- el RLS de company_users/users (supabase_auth_admin NO tiene policy propia).
-- Es la opción documentada por Supabase para hooks que leen tablas con RLS.
-- `search_path` fijado a public para evitar hijacking (regla SECURITY DEFINER).
-- Defensiva: si el usuario no tiene empresa, devuelve claims válidos igual
-- (login OK, pero requireSessionWithCompany lo frena downstream) — NUNCA
-- lanzamos error acá porque un throw rompería TODOS los logins.
--
-- FAIL-CLOSED downstream: este hook es best-effort de ENRIQUECIMIENTO. La
-- autoridad final del tenant sigue siendo el service layer (valida tenant_id
-- del context vs recurso) + RLS. Un JWT sin company_id no da acceso a nada.

BEGIN;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id     uuid;
  v_claims      jsonb;
  v_is_support  boolean;
  v_company_ids uuid[];
  v_roles       text[];
  v_app_role    text;
BEGIN
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims  := event -> 'claims';

  -- is_support desde users (default false si el usuario aún no tiene row).
  SELECT COALESCE(u.is_support, false)
    INTO v_is_support
    FROM public.users u
   WHERE u.id = v_user_id;
  v_is_support := COALESCE(v_is_support, false);

  -- Empresas + roles del usuario (0..N filas en company_users).
  SELECT array_agg(cu.company_id ORDER BY cu.company_id),
         array_agg(DISTINCT cu.role)
    INTO v_company_ids, v_roles
    FROM public.company_users cu
   WHERE cu.user_id = v_user_id;

  v_claims := jsonb_set(v_claims, '{is_support}', to_jsonb(v_is_support));

  IF v_company_ids IS NULL THEN
    -- Usuario sin empresa: login válido pero sin claims de company.
    -- requireSessionWithCompany() lo rechaza (debe ser invitado a una empresa).
    RETURN jsonb_set(event, '{claims}', v_claims);
  END IF;

  IF 'accountant' = ANY(v_roles) THEN
    -- Contador multi-empresa (ADR-0008): array company_ids + active = la 1ra.
    v_app_role := 'accountant';
    v_claims := jsonb_set(v_claims, '{company_ids}', to_jsonb(v_company_ids));
    v_claims := jsonb_set(v_claims, '{active_company_id}', to_jsonb(v_company_ids[1]));
  ELSE
    -- Operador de 1 empresa (owner/admin/cashier): company_id single.
    v_app_role := v_roles[1];
    v_claims := jsonb_set(v_claims, '{company_id}', to_jsonb(v_company_ids[1]));
    v_claims := jsonb_set(v_claims, '{active_company_id}', to_jsonb(v_company_ids[1]));
  END IF;

  v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(v_app_role));

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- Solo supabase_auth_admin ejecuta el hook; nadie más.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;

COMMIT;
