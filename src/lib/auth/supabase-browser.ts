/**
 * Supabase browser client (client components).
 * @supabase/ssr pattern oficial.
 *
 * IMPORTANTE: SOLO usar en 'use client' components.
 * El cliente NO puede leer env del server. Las variables NEXT_PUBLIC_*
 * se inyectan en build time por Next.js.
 */
import { createBrowserClient as createSupabaseBrowserSSRClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY no definidos. ' +
        'Verificar .env.local + reiniciar dev server.'
    );
  }

  return createSupabaseBrowserSSRClient(url, key);
}
