/**
 * GET /api/internal/cron/mp-reconcile — cron Vercel que drena la cola
 * `mp.reconcile_webhook`. Sprint 5 Sales+MP (Fase B) — el PRIMER cron route.
 *
 * Path exento del middleware de correlation (CORRELATION-PROPAGATION lista cerrada
 * `/api/internal/cron/`) y PÚBLICO en el proxy: Vercel Cron no trae sesión.
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, fail-closed — sin secreto
 * configurado el cron está apagado (503), no abierto. Ver src/lib/security/cron-auth.ts.
 *
 * Toda la lógica está en runMpReconcileBatch (testeable); esto solo autentica + invoca.
 */
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { withCronTracing } from '@/lib/tracing/server-action-tracing';
import { runMpReconcileBatch } from '@/lib/integrations/mercadopago/reconcile.worker';
import { resolveMpAccessToken } from '@/lib/integrations/mercadopago/mp-secret';
import { autorizarCron } from '@/lib/security/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request.headers.get('authorization'), env.CRON_SECRET);
  if (!auth.ok) {
    // El motivo NO viaja en la respuesta: a quien prueba la ruta desde afuera
    // no le sirve saber si el cron está apagado o si erró el secreto.
    return NextResponse.json({ ok: false }, { status: auth.status });
  }

  const result = await withCronTracing(() =>
    runMpReconcileBatch({ resolveAccessToken: resolveMpAccessToken })
  );

  return NextResponse.json({ ok: true, ...result });
}
