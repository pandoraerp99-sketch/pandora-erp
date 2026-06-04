/**
 * Content Security Policy + security headers.
 * ADR-0019 S1 + CLAUDE.md §11.1 + web/security.md.
 *
 * Edge-compatible: NO Node Buffer, NO process.env directo, NO fs.
 * Usa Web Crypto + btoa (disponibles en Edge runtime de Next.js 16).
 *
 * Patron de uso (Edge proxy):
 *   const nonce = generateCspNonce();
 *   const headers = buildSecurityHeaders(nonce);
 *   for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
 *   // propagar nonce a Server Components via request header:
 *   req.headers.set('x-csp-nonce', nonce);
 *
 * Server Components que necesiten inyectar <script nonce={nonce}>:
 *   const nonce = (await headers()).get('x-csp-nonce') ?? '';
 */

/**
 * Genera un nonce CSP de 128 bits (16 bytes) base64-encoded.
 * Cumple recomendacion W3C: >= 128 bits unguessable per request.
 * NUEVO por request — NUNCA cachear o reusar.
 */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Convertir a base64 sin usar Buffer (Edge-incompatible).
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Catalogo F0 de origenes externos permitidos en connect-src.
 * Cerrado — agregar requiere PR + actualizar ADR-0019 o este modulo.
 */
export const DEFAULT_CONNECT_SRC = [
  "'self'",
  // Supabase managed
  'https://*.supabase.co',
  'wss://*.supabase.co',
  // MercadoPago
  'https://api.mercadopago.com',
  'https://api.mercadolibre.com',
  // AFIP (homologacion + produccion)
  'https://wsaa.afip.gov.ar',
  'https://wsaahomo.afip.gov.ar',
  'https://servicios1.afip.gov.ar',
  'https://wswhomo.afip.gov.ar',
] as const;

/**
 * Catalogo F0 de origenes para img-src.
 * - 'self' = nuestros assets.
 * - data: = inline base64 icons (necesario para shadcn + lucide).
 * - https: = Supabase Storage publico (signed urls) + thumbnails terceros
 *           autorizados. Mas amplio que connect-src porque images son
 *           menos sensibles que conexiones.
 */
export const DEFAULT_IMG_SRC = ["'self'", 'data:', 'https:'] as const;

export interface BuildCspOptions {
  /**
   * Origenes adicionales para connect-src (mas alla del default F0).
   * Usado por tests o features experimentales detras de flag.
   */
  extraConnectSrc?: readonly string[];
  /**
   * Endpoint de reporting CSP. Si se pasa, agrega report-uri + report-to.
   * Default: undefined (no reporting F0; agregar cuando construyamos
   * el endpoint /api/security/csp-report).
   */
  reportUri?: string;
}

/**
 * Construye el string del header Content-Security-Policy.
 *
 * Decisiones opinadas F0 (ADR-0019 S1):
 *
 * - **script-src 'self' 'nonce-{N}'** — nonce-based + 'self' permite Next.js
 *   levantar sus scripts framework desde 'self' Y nuestros scripts custom
 *   con nonce. **NO usa 'strict-dynamic'** F0 porque rompe Next.js: con
 *   strict-dynamic el browser ignora 'self' y solo ejecuta scripts con
 *   nonce — pero Next ship sus scripts sin nonce a menos que se cablee
 *   manualmente en app/layout.tsx (defer F0.5 o F1+ Sprint 1 #7). NO usa
 *   'unsafe-inline' (XSS defense core).
 *
 * - **style-src 'unsafe-inline'** — Tailwind v4 + shadcn requieren inline
 *   styles. ADR-0019 acepta F0 como deuda intencional. Migrar a nonce
 *   style-src F2+ cuando Tailwind/shadcn lo soporten nativamente.
 *
 * - **frame-ancestors 'none'** — Pandora NO se embeed en otros sitios
 *   (anti-clickjacking).
 *
 * - **object-src 'none'** — sin Flash/legacy plugins.
 *
 * - **upgrade-insecure-requests** — defensa en profundidad TLS.
 *   `block-all-mixed-content` REMOVIDO (W3C draft never speced, MDN flags
 *   obsoleto; upgrade-insecure-requests cubre el caso correctamente).
 */
export function buildCspHeader(
  nonce: string,
  options: BuildCspOptions = {}
): string {
  if (nonce.length === 0) {
    throw new Error('buildCspHeader: nonce vacio — generar primero con generateCspNonce()');
  }

  const connectSrc = [
    ...DEFAULT_CONNECT_SRC,
    ...(options.extraConnectSrc ?? []),
  ];

  const directives: Array<readonly [string, readonly string[]]> = [
    ['default-src', ["'self'"]],
    // NO 'strict-dynamic' F0 — ver comment del bloque header de buildCspHeader.
    ['script-src', ["'self'", `'nonce-${nonce}'`]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', DEFAULT_IMG_SRC],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', connectSrc],
    ['frame-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];

  const parts: string[] = directives.map(
    ([directive, sources]) => `${directive} ${sources.join(' ')}`
  );

  // Standalone directives (no sources).
  parts.push('upgrade-insecure-requests');

  if (options.reportUri) {
    parts.push(`report-uri ${options.reportUri}`);
  }

  return parts.join('; ');
}

/**
 * Conjunto canonico de headers de seguridad F0.
 * CLAUDE.md §11.4 + web/security.md.
 *
 * Incluye CSP + HSTS + X-Content-Type-Options + X-Frame-Options +
 * Referrer-Policy + Permissions-Policy.
 *
 * No incluye CORS (eso lo decide cada Route Handler individualmente).
 */
export function buildSecurityHeaders(
  nonce: string,
  options: BuildCspOptions = {}
): Record<string, string> {
  return {
    'Content-Security-Policy': buildCspHeader(nonce, options),

    // HSTS — TLS 1.2+ obligatorio (ADR-0019 S15). 1 año + subdomains + preload.
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',

    // Bloquea MIME sniffing.
    'X-Content-Type-Options': 'nosniff',

    // Defensa en profundidad anti-clickjacking (frame-ancestors es el primary).
    'X-Frame-Options': 'DENY',

    // No filtrar URL completa a sitios externos.
    'Referrer-Policy': 'strict-origin-when-cross-origin',

    // Bloquear APIs sensibles del browser (Pandora no las usa F0).
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  };
}

/**
 * Validacion estructural del nonce — usado por el proxy para verificar
 * que el nonce generado cumple shape esperado antes de enviarlo.
 * Tambien usado por tests.
 */
export function isValidCspNonce(nonce: string): boolean {
  // base64 de 16 bytes = 24 chars con padding "=" o 22 sin padding.
  // Aceptamos ambos (btoa siempre incluye padding).
  if (nonce.length !== 24) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(nonce);
}
