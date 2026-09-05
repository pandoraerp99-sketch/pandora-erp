'use server';

/**
 * Server Actions de autenticación (Slice 2/5 POS funcional).
 *
 * Primera 'use server' de la app. El sign-in usa el server client SSR
 * (@supabase/ssr) que setea las cookies de sesión — el proxy (src/proxy.ts)
 * las lee después para proteger rutas + montar tracing. El JWT ya trae
 * company_id gracias al custom_access_token_hook (migration 0015, Slice 1).
 *
 * **Rate limiting (2026-09-05).** El login estaba sin ningún límite de
 * intentos: `src/lib/security/rate-limit.ts` existía entero y testeado
 * pero no lo importaba nadie. CLAUDE.md §11.2 y ADR-0019 S2 lo declaran
 * obligatorio. Ahora se aplican las dos policies del catálogo:
 *   - por IP:    5 intentos / minuto  (POLICY_LOGIN_BY_IP)
 *   - por email: 10 intentos / hora   (POLICY_LOGIN_BY_EMAIL)
 *
 * **Dónde va cada evento.** El bloqueo por rate limit va a Pino, NO a
 * audit_log — EVENT-TAXONOMY lo lista explícitamente en "lo que NO va a
 * audit_log" (ver el comentario final de event-names.ts). El docstring de
 * rate-limit.ts:142 decía lo contrario y nombraba un evento
 * (`auth.login.rate_limited`) que ni siquiera está en el catálogo: gana la
 * taxonomía, que es autoridad documental por encima de un comentario.
 * A audit_log van sólo `auth.login.success` / `auth.login.failed`, que
 * también estaban en el catálogo sin nadie que los escribiera.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/audit/audit-writer';
import { createSupabaseServerClient } from '@/lib/auth/supabase-server';
import { logger } from '@/lib/observability/logger';
import { resolveClientIp } from '@/lib/security/client-ip';
import {
  POLICY_LOGIN_BY_EMAIL,
  checkLoginRateLimit,
  checkRateLimit,
  defaultRateLimitStore,
} from '@/lib/security/rate-limit';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';

const SignInSchema = z.object({
  email: z.string().trim().email('Email inválido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
  // nullable(): `formData.get('next')` devuelve null cuando el campo no
  // viene. El <form> siempre lo manda (aunque sea ''), pero una Server
  // Action es un endpoint HTTP público: un POST directo sin ese campo
  // rompía con "expected string, received null". Es opcional de verdad.
  next: z.string().nullable().optional(),
});

export interface SignInState {
  error?: string;
}

/**
 * Valida el destino post-login: solo paths internos ('/algo'), nunca URLs
 * absolutas ni '//host' (previene open redirect). Default '/pos'.
 */
function safeNext(next: string | null | undefined): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    return next;
  }
  return '/pos';
}

/**
 * Escribe en audit_log sin poder tumbar el login.
 *
 * Un fallo al auditar (hipo de la base, partición faltante) NO puede
 * convertir un login legítimo en un 500 ni un rechazo en un error feo.
 * Se degrada a un log de error y se sigue. CLAUDE.md §20.4 prohíbe tragar
 * errores en silencio — por eso queda registrado, no descartado.
 */
async function auditSafely(
  event: 'auth.login.success' | 'auth.login.failed',
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await writeAuditLog({
      event_name: event,
      payload,
      pii_level: 'pii_low', // el email es dato personal
      severity: event === 'auth.login.failed' ? 'warning' : 'info',
    });
  } catch (err) {
    logger.error(
      { err, event },
      'No se pudo escribir el audit_log del login — el login continúa'
    );
  }
}

/** Resultado interno: separa "qué pasó" de "cómo se le responde a Next". */
type AttemptResult = { ok: true; next: string } | { ok: false; error: string };

async function attemptSignIn(formData: FormData): Promise<AttemptResult> {
  const ip = resolveClientIp(await headers());

  // ── Capa 1: límite por IP, ANTES de parsear ────────────────────────
  // A propósito antes del Zod: la defensa por IP no debe depender de que
  // el input sea válido. Si se chequeara después, un atacante manda
  // basura, esquiva el contador y hace fuerza bruta sobre el parser.
  const byIp = checkLoginRateLimit({ ip });
  if (!byIp.allowed) {
    logger.warn(
      { policy: 'login_by_ip', retry_after_sec: byIp.retryAfterSec },
      'Login bloqueado por rate limit de IP'
    );
    return {
      ok: false,
      error: `Demasiados intentos. Probá de nuevo en ${byIp.retryAfterSec} segundos.`,
    };
  }

  const parsed = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Datos inválidos',
    };
  }

  const email = parsed.data.email.toLowerCase();

  // ── Capa 2: límite por email (cuenta apuntada desde varias IPs) ─────
  // OJO: acá NO se usa checkLoginRateLimit — ese helper chequea SIEMPRE
  // la IP primero, y como la capa 1 ya consumió ese slot, llamarlo de
  // nuevo lo consumía dos veces por intento: el límite real pasaba de 5 a
  // 2 por minuto. Se aplica la policy de email sola, sobre el mismo store.
  const byEmail = checkRateLimit(defaultRateLimitStore, {
    config: POLICY_LOGIN_BY_EMAIL,
    subject: email,
  });
  if (!byEmail.allowed) {
    logger.warn(
      {
        policy: POLICY_LOGIN_BY_EMAIL.policy,
        retry_after_sec: byEmail.retryAfterSec,
      },
      'Login bloqueado por rate limit'
    );
    return {
      ok: false,
      error: 'Demasiados intentos con esta cuenta. Esperá un rato antes de reintentar.',
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    await auditSafely('auth.login.failed', { email });
    // Mensaje genérico a propósito: no revelamos si el email existe
    // (enumeración de usuarios). CLAUDE.md §11 threat model.
    return { ok: false, error: 'Email o contraseña incorrectos.' };
  }

  await auditSafely('auth.login.success', { email });
  return { ok: true, next: safeNext(parsed.data.next) };
}

export async function signIn(
  _prev: SignInState,
  formData: FormData
): Promise<SignInState> {
  // requireAuth: false — todavía no hay sesión. El wrapper deja
  // actor_type='system' y tenant_id=null, y el audit writer cae a
  // SYSTEM_TENANT_ID. Sin esto, writeAuditLog no tiene contexto y tira.
  const result = await withServerActionTracing(() => attemptSignIn(formData), {
    requireAuth: false,
  });

  if (!result.ok) {
    return { error: result.error };
  }

  // redirect() lanza NEXT_REDIRECT — se llama FUERA del wrapper de tracing
  // para que ese throw de control no atraviese el AsyncLocalStorage ni
  // quede atrapado por nada de adentro.
  redirect(result.next);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
