/**
 * GET /api/internal/cron/mp-reconcile — cron Vercel que drena la cola
 * `mp.reconcile_webhook`. Sprint 5 Sales+MP (Fase B) — el PRIMER cron route.
 *
 * Path exento del middleware de correlation (CORRELATION-PROPAGATION lista cerrada
 * `/api/internal/cron/`). Auth: Vercel Cron manda `Authorization: Bearer ${CRON_SECRET}`;
 * si CRON_SECRET está seteado, se exige (fail-closed contra triggers públicos).
 *
 * Toda la lógica está en runMpReconcileBatch (testeable); esto solo autentica + invoca.
 */
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { withCronTracing } from '@/lib/tracing/server-action-tracing';
import { runMpReconcileBatch } from '@/lib/integrations/mercadopago/reconcile.worker';
import { resolveMpAccessToken } from '@/lib/integrations/mercadopago/mp-secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  if (env.CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const result = await withCronTracing(() =>
    runMpReconcileBatch({ resolveAccessToken: resolveMpAccessToken })
  );

  return NextResponse.json({ ok: true, ...result });
}
