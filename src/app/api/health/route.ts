/**
 * Health check endpoint.
 * Path public — no requiere auth (incluido en PUBLIC_PATHS del middleware).
 * Util para monitoreo Vercel + smoke tests.
 */
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

interface HealthCheckResponse {
  ok: boolean;
  service: string;
  version: string;
  env: string;
  afip_env: string;
  time: string;
  uptime_seconds: number;
  checks: Record<string, 'ok' | 'fail' | 'skip'>;
}

const startedAt = Date.now();

export async function GET(): Promise<NextResponse<HealthCheckResponse>> {
  const checks: HealthCheckResponse['checks'] = {
    env: 'ok',
    runtime: 'ok',
  };

  return NextResponse.json({
    ok: true,
    service: 'pandora-erp',
    version: '0.0.1',
    env: env.NODE_ENV,
    afip_env: env.AFIP_ENVIRONMENT,
    time: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    checks,
  });
}
