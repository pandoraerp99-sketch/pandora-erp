/**
 * JWT parsing con jose para extraer custom claims de Supabase.
 * CLAUDE.md §6.1: jose 6.2.3 (NO jsonwebtoken).
 *
 * Supabase Auth permite agregar custom claims via Custom Access Token Hook
 * (config en Supabase Studio, NO en codigo).
 *
 * Los custom claims que Pandora agrega son:
 * - company_id: string (uuid) — para owner/admin/cashier (1 empresa)
 * - company_ids: string[] (uuid[]) — para accountant (N empresas)
 * - active_company_id: string (uuid) — empresa actualmente seleccionada
 *                                       (puede cambiar dinamicamente para accountant)
 * - app_role: 'owner' | 'admin' | 'cashier' | 'accountant'
 */
import { decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import { env } from '../env.js';
import type { UserRole } from '../db/schema/_common.js';

const customClaimsSchema = z.object({
  company_id: z.string().uuid().optional(),
  company_ids: z.array(z.string().uuid()).optional(),
  active_company_id: z.string().uuid().optional(),
  app_role: z.enum(['owner', 'admin', 'cashier', 'accountant']).optional(),
  is_support: z.boolean().optional(),
});

export interface PandoraJwtClaims extends JWTPayload {
  company_id?: string;
  company_ids?: string[];
  active_company_id?: string;
  app_role?: UserRole;
  is_support?: boolean;
}

export function decodePandoraJwtUnsafe(token: string): PandoraJwtClaims | null {
  try {
    const claims = decodeJwt(token);
    const customParsed = customClaimsSchema.safeParse(claims);
    if (!customParsed.success) {
      return claims as PandoraJwtClaims;
    }
    return { ...claims, ...customParsed.data };
  } catch {
    return null;
  }
}

export async function verifyPandoraJwt(
  token: string,
  secret: string
): Promise<PandoraJwtClaims | null> {
  try {
    const encoded = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, encoded, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    const customParsed = customClaimsSchema.safeParse(payload);
    if (!customParsed.success) {
      return payload as PandoraJwtClaims;
    }

    return { ...payload, ...customParsed.data };
  } catch {
    return null;
  }
}

export function getActiveCompanyId(claims: PandoraJwtClaims): string | null {
  if (claims.active_company_id) {
    return claims.active_company_id;
  }

  if (claims.company_id) {
    return claims.company_id;
  }

  if (claims.company_ids && claims.company_ids.length === 1 && claims.company_ids[0]) {
    return claims.company_ids[0];
  }

  return null;
}

export function getAllCompanyIds(claims: PandoraJwtClaims): string[] {
  if (claims.company_ids && claims.company_ids.length > 0) {
    return claims.company_ids;
  }

  if (claims.company_id) {
    return [claims.company_id];
  }

  return [];
}

export function isAccountant(claims: PandoraJwtClaims): boolean {
  return claims.app_role === 'accountant';
}

export function canAccessCompany(claims: PandoraJwtClaims, companyId: string): boolean {
  const allIds = getAllCompanyIds(claims);
  return allIds.includes(companyId);
}
