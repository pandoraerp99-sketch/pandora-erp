/**
 * Next.js Proxy — runs on Edge runtime.
 *
 * Renombrado de `middleware.ts` a `proxy.ts` en Next 16.x:
 *   https://nextjs.org/docs/messages/middleware-to-proxy
 *
 * Responsabilidades F0:
 * 1. Generar request_id por cada HTTP request (siempre nuevo)
 * 2. Generar/propagar correlation_id (genera si no viene en header)
 * 3. Refrescar session Supabase (cookies handling)
 * 4. Inyectar headers de tracing para Server Actions / Route Handlers
 * 5. CSP nonce per-request + security headers (ADR-0019 S1)
 *
 * IMPORTANTE: Edge runtime NO tiene AsyncLocalStorage de Node.
 * El tracing context Node-side se monta en cada Server Action / Route Handler
 * via withServerActionTracing() leyendo los headers que este proxy inyecta.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
// Alias '@/...' SIN extension .js — convencion del codebase (ver
// src/app/api/health/route.ts). Verificado empiricamente 2026-06-01
// que la extension '.js' rompe en Edge runtime turbopack ("Module not found"),
// y el alias '@/' SI resuelve sin extension.
import { buildSecurityHeaders, generateCspNonce } from '@/lib/security/csp';
import { resolveInboundIds } from '@/lib/tracing/ids';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/api/health',
  '/api/webhooks',
  // PREVIEW-ONLY (Sprint POS-A.1) — /pos es el preview visual del POS
  // sin auth. Cuando Sprint POS-B+ wire-up POS funcional real con
  // services + sesion + multi-tenant, remover esta linea y mover /pos
  // a path autenticado normal.
  '/pos',
];

const TRACING_EXEMPT_PATHS = [
  '/api/webhooks',
  '/api/health',
  '/api/internal/cron',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function isTracingExempt(pathname: string): boolean {
  return TRACING_EXEMPT_PATHS.some((p) => pathname.startsWith(p));
}


/**
 * Aplica los headers de seguridad (CSP + HSTS + etc) al response.
 * Tambien propaga el nonce al request via `x-csp-nonce` para que
 * Server Components puedan leerlo via `headers()` y emitir
 * `<script nonce={nonce}>` cuando necesiten.
 *
 * NOTA: cada invocacion genera nonce FRESCO. En el flujo redirect
 * (login redirect) hay 2 invocaciones — request original + request
 * tras redirect — cada una con su propio nonce. Es correcto: el
 * browser hace un request HTTP nuevo al seguir el redirect, asi
 * que ese request tiene su propia CSP coherente. No es bug.
 */
function applySecurityHeaders(req: NextRequest, response: NextResponse): void {
  const nonce = generateCspNonce();
  const securityHeaders = buildSecurityHeaders(nonce);

  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  // Propagar nonce al request asi Server Components lo pueden leer.
  req.headers.set('x-csp-nonce', nonce);
  // Tambien expuesto en response para clients que quieran inspeccionar.
  response.headers.set('x-csp-nonce', nonce);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  let response = NextResponse.next({
    request: { headers: req.headers },
  });

  // Trust boundary: headers vienen del cliente. resolveInboundIds() valida
  // UUID format antes de propagar (sin esto, garbage como
  // `x-correlation-id: <script>` se propagaba a logs/audit_log).
  // Edge-compatible: solo crypto.randomUUID + RegExp.
  const {
    correlation_id: correlationId,
    request_id: requestId,
    correlation_was_generated,
  } = resolveInboundIds(
    req.headers.get('x-correlation-id'),
    req.headers.get('x-request-id')
  );

  // Marca generated solo para paths NO exempt — webhooks/health/cron pueden
  // legitimamente venir sin correlation_id (originan en el sistema o terceros).
  if (correlation_was_generated && !isTracingExempt(pathname)) {
    response.headers.set('x-correlation-id-generated', 'true');
  }

  response.headers.set('x-request-id', requestId);
  response.headers.set('x-correlation-id', correlationId);

  req.headers.set('x-request-id', requestId);
  req.headers.set('x-correlation-id', correlationId);

  // Security headers (CSP + HSTS + etc) — aplicar SIEMPRE, antes de cualquier
  // posible NextResponse.redirect. ADR-0019 S1.
  applySecurityHeaders(req, response);

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl || !supabaseKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          req.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    const redirect = NextResponse.redirect(url);
    // Reaplica security headers al redirect (NextResponse.redirect crea response
    // nuevo, los headers seteados antes en `response` no se heredan).
    applySecurityHeaders(req, redirect);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)',
  ],
};
