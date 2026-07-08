/**
 * Resolución del webhook signing secret de MercadoPago por tenant.
 * Sprint 5 Sales+MP — Integrations context (Fase B).
 *
 * F0 (piloto 1 comercio): lee `env.MP_WEBHOOK_SECRET` (el secret del comercio,
 * copiado de MP Dashboard → Webhooks → Configurar notificación).
 *
 * F1 (multi-tenant real): leer per-tenant desde el vault (security/vault) — cada
 * comercio conecta su cuenta MP en el onboarding y guarda su secret cifrado.
 * El `companyId` ya llega (URL per-tenant `/api/webhooks/mp/{company_id}`), así que
 * este es el único punto a cambiar. TODO: onboarding MP + storage per-tenant.
 */
import { env } from '../../env.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- companyId se usa en F1 (vault per-tenant)
export async function resolveMpWebhookSecret(companyId: string): Promise<string | null> {
  return env.MP_WEBHOOK_SECRET ?? null;
}
