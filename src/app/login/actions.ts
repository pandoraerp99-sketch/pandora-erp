'use server';

/**
 * Server Actions de autenticación (Slice 2/5 POS funcional).
 *
 * Primera 'use server' de la app. El sign-in usa el server client SSR
 * (@supabase/ssr) que setea las cookies de sesión — el proxy (src/proxy.ts)
 * las lee después para proteger rutas + montar tracing. El JWT ya trae
 * company_id gracias al custom_access_token_hook (migration 0015, Slice 1).
 */
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/auth/supabase-server';

const SignInSchema = z.object({
  email: z.string().trim().email('Email inválido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
  next: z.string().optional(),
});

export interface SignInState {
  error?: string;
}

/**
 * Valida el destino post-login: solo paths internos ('/algo'), nunca URLs
 * absolutas ni '//host' (previene open redirect). Default '/pos'.
 */
function safeNext(next: string | undefined): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    return next;
  }
  return '/pos';
}

export async function signIn(
  _prev: SignInState,
  formData: FormData
): Promise<SignInState> {
  const parsed = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Mensaje genérico a propósito: no revelamos si el email existe
    // (enumeración de usuarios). CLAUDE.md §11 threat model.
    return { error: 'Email o contraseña incorrectos.' };
  }

  // redirect() lanza NEXT_REDIRECT — fuera de try/catch, al final del happy path.
  redirect(safeNext(parsed.data.next));
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
