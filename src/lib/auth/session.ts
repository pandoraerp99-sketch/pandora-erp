/**
 * Session helpers — abstraccion sobre Supabase Auth + custom claims.
 *
 * Server Components / Server Actions leen aca, NO directo al supabase client.
 */
import { cookies } from 'next/headers';
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

/**
 * Cookie con la empresa que el contador esta mirando.
 *
 * NO es una fuente de autoridad: es una preferencia. Lo que decide a que puede
 * acceder es `company_ids` del JWT, que lo firma el servidor de auth. Esta
 * cookie solo elige CUAL de esas mirar, y si pide una que no esta en el JWT se
 * ignora (ver `resolverEmpresaActiva`).
 */
export const COOKIE_EMPRESA = 'pandora_empresa';

/**
 * Cual empresa esta mirando el usuario.
 *
 * El JWT trae `active_company_id` (para el contador, la primera de su lista).
 * La cookie puede pedir otra — pero SOLO si esta entre las suyas. Un pedido de
 * una empresa ajena no es un error a mostrar: se ignora y se cae a la del
 * token, porque la cookie la manda el navegador y ahi no se confia.
 *
 * Es puro para poder testear el caso que importa (pedir una empresa ajena) sin
 * levantar una sesion.
 */
export function resolverEmpresaActiva(
  delToken: string | null,
  disponibles: ReadonlyArray<string>,
  pedidaPorCookie: string | null
): string | null {
  if (pedidaPorCookie !== null && disponibles.includes(pedidaPorCookie)) {
    return pedidaPorCookie;
  }
  return delToken;
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

  const disponibles = getAllCompanyIds(claims);

  return {
    user_id: user.id,
    email: user.email ?? '',
    active_company_id: resolverEmpresaActiva(
      getActiveCompanyId(claims),
      disponibles,
      (await cookies()).get(COOKIE_EMPRESA)?.value ?? null
    ),
    available_company_ids: disponibles,
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
