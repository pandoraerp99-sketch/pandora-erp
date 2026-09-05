/**
 * POST /api/webhooks/mp/[company_id] — webhook entrante de MercadoPago.
 * Sprint 5 Sales+MP — el PRIMER webhook route del sistema.
 *
 * **URL per-tenant** (advisor 2026-07-07): el `company_id` viaja en el path — NO es
 * secreto (el HMAC autentica, RLS aísla). Necesitamos el tenant ANTES de validar
 * porque el secret y el re-fetch autoritativo son per-tenant. F1: token opaco
 * rotable en vez del UUID si no queremos UUIDs en el dashboard de MP.
 *
 * **El company_id es input NO confiable** (2026-09-05). Viene del path, no de una
 * sesión, y antes entraba crudo al tracing context. Verificado contra la base:
 *   - malformado → el INSERT de dedup explotaba en el cast a uuid → 500. Y un 500
 *     en un webhook hace que MP reintente, así que no era cosmético.
 *   - uuid válido pero inexistente → `processed_webhook_events` y `jobs_queue` no
 *     tienen FK sobre `tenant_id`: la fila de dedup entraba y quedaba un job
 *     encolado para un tenant fantasma.
 * Se resuelve ANTES de montar el context: una vez adentro, un tenant basura
 * mancha cada línea de Pino y cada escritura de audit_log posterior.
 *
 * ⚠️ **Lo que este chequeo NO cierra.** En F0 `resolveMpWebhookSecret` ignora el
 * companyId y devuelve un único secret global (documentado, piloto de 1 comercio).
 * Con 2+ comercios, una notificación legítima reenviada con OTRO company_id en la
 * URL pasa el HMAC y cae en el tenant equivocado. El fix real es secret per-tenant
 * desde el vault. **Es gate para dar de alta el segundo comercio**, no deuda suelta.
 *
 * Node runtime (raw body + AsyncLocalStorage). `params` es Promise en Next 15+.
 * Toda la lógica está en handleMpWebhook (testeable); esto solo traduce Request↔HTTP.
 */
import { NextResponse } from 'next/server';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { handleMpWebhook } from '@/lib/integrations/mercadopago/webhook-handler';
import { resolveMpWebhookSecret } from '@/lib/integrations/mercadopago/mp-secret';
import { resolveKnownTenantId } from '@/lib/multi_tenant/resolve-tenant';
import { logger } from '@/lib/observability/logger';
import { resolveClientIp } from '@/lib/security/client-ip';
import {
  POLICY_PUBLIC_ENDPOINT,
  checkRateLimit,
  defaultRateLimitStore,
} from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ company_id: string }> }
): Promise<NextResponse> {
  const { company_id } = await params;

  // Rate limit ANTES de tocar la base. Validar la company es una consulta a
  // Postgres sobre input NO autenticado (el HMAC recién se valida adentro del
  // handler), así que sin este límite cualquiera dispara un SELECT por request
  // con un POST pelado. Es endpoint público → POLICY_PUBLIC_ENDPOINT.
  const ip = resolveClientIp(request.headers);
  const cupo = checkRateLimit(defaultRateLimitStore, {
    config: POLICY_PUBLIC_ENDPOINT,
    subject: ip,
  });
  if (!cupo.allowed) {
    logger.warn(
      { policy: POLICY_PUBLIC_ENDPOINT.policy, retry_after_sec: cupo.retryAfterSec },
      'Webhook de MP bloqueado por rate limit'
    );
    return NextResponse.json(
      { ok: false },
      { status: 429, headers: { 'retry-after': String(cupo.retryAfterSec) } }
    );
  }

  // Trust boundary — antes del tracing context.
  const tenant = await resolveKnownTenantId(company_id);
  if (!tenant.ok) {
    // 400 = pedido mal armado · 404 = comercio inexistente. Se mantienen
    // distintos porque son bugs distintos del que llama y mezclarlos hace
    // imposible depurar una integración rota.
    //
    // Sí, la diferencia confirma si un UUID corresponde a una company. No es
    // un problema práctico: un UUID v4 tiene 122 bits de entropía, así que no
    // se enumeran — y con el rate limit de arriba, menos. (La justificación
    // anterior decía que "no revela nada porque el company_id lo eligió quien
    // llama"; eso era falso: un scanner no autenticado no elige, prueba.)
    const status = tenant.reason === 'malformed' ? 400 : 404;
    return NextResponse.json({ ok: false }, { status });
  }

  // Raw body PRIMERO — necesario para validar la firma. NUNCA request.json() antes:
  // la re-serialización cambia whitespace/orden y rompe el HMAC.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-signature');
  const requestId = request.headers.get('x-request-id');
  const url = new URL(request.url);
  const dataIdQuery = url.searchParams.get('data.id') ?? url.searchParams.get('id');

  const result = await withTracingContext(
    {
      correlation_id: generateCorrelationId(),
      request_id: generateRequestId(),
      // El id verificado contra `companies`, no el string crudo del path.
      tenant_id: tenant.tenantId,
      actor_user_id: null,
      actor_type: 'system',
    },
    () =>
      handleMpWebhook(
        {
          companyId: tenant.tenantId,
          rawBody,
          signatureHeader,
          requestId,
          dataIdQuery,
        },
        { resolveSecret: resolveMpWebhookSecret }
      )
  );

  return NextResponse.json({ ok: result.status < 400 }, { status: result.status });
}
