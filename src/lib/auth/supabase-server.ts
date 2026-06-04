/**
 * Supabase server client con cookie store (Next 16 App Router).
 * @supabase/ssr pattern oficial.
 *
 * Usado en Server Components, Server Actions, Route Handlers.
 */
import { createServerClient as createSupabaseSSRClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '../env.js';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createSupabaseSSRClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components no pueden setear cookies durante renderizado.
            // Las cookies se setean en middleware o Route Handlers.
          }
        },
      },
    }
  );
}

export async function createSupabaseServiceRoleClient() {
  const cookieStore = await cookies();

  return createSupabaseSSRClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Service role no setea cookies de usuario.
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}
