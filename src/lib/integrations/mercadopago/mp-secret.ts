/**
 * Resolución del webhook signing secret de MercadoPago por tenant.
 * Sprint 5 Sales+MP — Integrations context (Fase B).
 *
 * F0 (piloto 1 comercio): lee `env.MP_WEBHOOK_SECRET` — el secret del comercio,
 * copiado de MP Dashboard → Webhooks → Configurar notificación.
 *
 * F1 (multi-tenant real): leer per-tenant desde el vault (security/vault). Cada
 * comercio conecta su cuenta MP en el onboarding y guarda su secret cifrado.
 * Este es el único punto a cambiar. TODO: onboarding MP + storage per-tenant.
 *
 * ---
 *
 * **El secret global va ATADO a un comercio (2026-09-05).**
 *
 * Antes esta función ignoraba el `companyId` y devolvía el mismo secret para
 * cualquiera. Con un solo comercio era inocuo. Con dos deja de serlo: el
 * `company_id` viaja en la URL del webhook, así que una notificación legítima
 * de MP **reenviada con otro `company_id` pasa el HMAC** — mismo secret — y el
 * cobro se acredita en el comercio equivocado. Es un error de plata, y de los
 * que no se descubren solos.
 *
 * Validar que la company exista (`resolveKnownTenantId`) NO alcanza: garantiza
 * que el tenant sea real, no que la notificación le corresponda.
 *
 * La solución no es avisar del problema sino **eliminarlo**: `MP_WEBHOOK_SECRET`
 * ahora viene con `MP_WEBHOOK_SECRET_COMPANY_ID`, que declara de quién es. Para
 * cualquier otro `companyId` se devuelve `null` → 401. El supuesto de F0 ("hay
 * un solo comercio") pasa de ser un comentario a ser una restricción que corre.
 *
 * Y escala solo: cuando llegue el segundo comercio, la variable de entorno no
 * va a alcanzar y hay que ir al vault. No queda margen para olvidarse.
 *
 * **Se descartó** un guard que contaba filas en `companies`: la base de test
 * tiene 7 y las demos suman, así que confundía fixtures con comercios reales y
 * habría rechazado todo hasta que alguien lo apagara de bronca.
 */
import { env } from '../../env.js';
import { logger } from '../../observability/logger.js';

export async function resolveMpWebhookSecret(
  companyId: string
): Promise<string | null> {
  const secret = env.MP_WEBHOOK_SECRET;
  if (secret === undefined || secret.length === 0) {
    return null;
  }

  const duenio = env.MP_WEBHOOK_SECRET_COMPANY_ID;

  // Fail-closed: un secret global sin dueño declarado es exactamente la
  // configuración insegura. Antes de este cambio era el estado normal, así que
  // el error tiene que decir qué hacer, no sólo que algo falta.
  // CLAUDE.md §13.9 — ante incertidumbre en path crítico, no proceder.
  if (duenio === undefined) {
    logger.error(
      { company_id: companyId },
      'MP_WEBHOOK_SECRET está seteado pero falta MP_WEBHOOK_SECRET_COMPANY_ID. ' +
        'Sin declarar de qué comercio es el secret, cualquier company_id de la ' +
        'URL lo valida. Webhook rechazado. Setear la variable con el id del ' +
        'comercio del piloto.'
    );
    return null;
  }

  if (companyId !== duenio) {
    // Camino esperable si alguien reenvía una notificación cambiando la URL.
    // `warn` y no `error`: el sistema hizo lo correcto, no hay nada roto.
    logger.warn(
      { company_id: companyId },
      'Webhook de MP para un comercio distinto del dueño del secret global. ' +
        'Rechazado. Si es legítimo, hace falta secret per-tenant desde el vault.'
    );
    return null;
  }

  return secret;
}

/**
 * Access token de MP del tenant para re-consultar la API (GET /v1/payments/{id}).
 * F0: env.MP_ACCESS_TOKEN. F1: per-tenant desde vault (mismo companyId del path).
 *
 * No lleva la atadura de arriba a propósito: este token se usa DESPUÉS de que
 * el webhook fue autenticado, y ahí el `companyId` ya quedó verificado contra el
 * dueño del secret. Repetir el chequeo no agregaría nada.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- companyId se usa en F1 (vault per-tenant)
export async function resolveMpAccessToken(companyId: string): Promise<string | null> {
  return env.MP_ACCESS_TOKEN ?? null;
}
