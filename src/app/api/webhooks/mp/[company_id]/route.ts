/**
 * POST /api/webhooks/mp/[company_id] — webhook entrante de MercadoPago.
 * Sprint 5 Sales+MP — el PRIMER webhook route del sistema.
 *
 * **URL per-tenant** (advisor 2026-07-07): el `company_id` viaja en el path — NO es
 * secreto (el HMAC autentica, RLS aísla). Necesitamos el tenant ANTES de validar
 * porque el secret y el re-fetch autoritativo son per-tenant. F1: token opaco
 * rotable en vez del UUID si no queremos UUIDs en el dashboard de MP.
 *
 * Node runtime (raw body + AsyncLocalStorage). `params` es Promise en Next 15+.
 * Toda la lógica está en handleMpWebhook (testeable); esto solo traduce Request↔HTTP.
 */
import { NextResponse } from 'next/server';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import { handleMpWebhook } from '@/lib/integrations/mercadopago/webhook-handler';
import { resolveMpWebhookSecret } from '@/lib/integrations/mercadopago/mp-secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ company_id: string }> }
): Promise<NextResponse> {
  const { company_id } = await params;

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
      tenant_id: company_id,
      actor_user_id: null,
      actor_type: 'system',
    },
    () =>
      handleMpWebhook(
        { companyId: company_id, rawBody, signatureHeader, requestId, dataIdQuery },
        { resolveSecret: resolveMpWebhookSecret }
      )
  );

  return NextResponse.json({ ok: result.status < 400 }, { status: result.status });
}
