/**
 * Session helpers — abstraccion sobre Supabase Auth + custom claims.
 *
 * Server Components / Server Actions leen aca, NO directo al supabase client.
 */
import { UnauthorizedError } from '../multi_tenant/errors.js';
import { createSupabaseServerClient } from './supabase-server.js';
import {
  decodePandoraJwtUnsafe,
  getActiveCompanyId,
  getAllCompanyIds,
  type PandoraJwtClaims,
} from './jwt.js';
import type { UserRole } from '../db/schema/_common.js';

export interface PandoraSession {
  user_id: string;
  email: string;
  active_company_id: string | null;
  available_company_ids: ReadonlyArray<string>;
  app_role: UserRole | null;
  is_support: boolean;
  access_token: string;
  expires_at: number;
}

export async function getCurrentSession(): Promise<PandoraSession | null> {
  const supabase = await createSupabaseServerClient();

  // PRIMER GATE: getUser() valida el JWT contra el servidor Supabase.
  // Si el token fue revocado / expiro / fue manipulado, esta llamada falla.
  // Pattern oficial Supabase v2 — getSession() solo lee cookies y NO valida.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  // Segunda llamada para extraer el access_token + custom claims.
  // El access_token ya fue validado por getUser arriba, asi que decodear
  // los claims es seguro a esta altura.
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session) {
    return null;
  }

  const claims = decodePandoraJwtUnsafe(session.access_token);
  if (!claims) {
    return null;
  }

  return {
    user_id: user.id,
    email: user.email ?? '',
    active_company_id: getActiveCompanyId(claims),
    available_company_ids: getAllCompanyIds(claims),
    app_role: claims.app_role ?? null,
    is_support: claims.is_support ?? false,
    access_token: session.access_token,
    expires_at: session.expires_at ?? 0,
  };
}

export async function requireSession(): Promise<PandoraSession> {
  const session = await getCurrentSession();
  if (!session) {
    throw new UnauthorizedError('No hay sesion activa');
  }
  return session;
}

export async function requireSessionWithCompany(): Promise<
  PandoraSession & { active_company_id: string }
> {
  const session = await requireSession();
  if (!session.active_company_id) {
    throw new UnauthorizedError(
      'Sesion sin company activa. El usuario debe seleccionar una empresa.'
    );
  }
  return session as PandoraSession & { active_company_id: string };
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.user_id ?? null;
}

export async function getCurrentCompanyId(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.active_company_id ?? null;
}
