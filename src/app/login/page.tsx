/**
 * Página de login (Slice 2/5 POS funcional) — Dawn Industrial Editorial.
 *
 * Server Component: si ya hay sesión activa, redirige a /pos (evita ver el
 * login logueado). Si no, renderiza el formulario. El proxy (src/proxy.ts)
 * redirige acá con ?next=<ruta> cuando un usuario sin sesión toca una ruta
 * protegida; el form propaga ese `next` para volver adonde iba.
 */
import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth/session';
import { LoginForm } from './LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getCurrentSession();
  if (session) {
    redirect('/pos');
  }

  const { next } = await searchParams;

  return (
    <main className="pos-stage min-h-dvh grid place-items-center px-6 py-12">
      <div className="w-full max-w-[380px]">
        {/* Marca — hero editorial en Instrument Serif */}
        <div className="mb-8">
          <h1
            className="leading-none text-[color:var(--text-primary)]"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(2.75rem, 9vw, 3.5rem)',
            }}
          >
            Pandora
          </h1>
          <p
            className="mt-1 text-[color:var(--text-muted)] pos-data"
            style={{ fontSize: 'var(--text-caption)', letterSpacing: '0.06em' }}
          >
            PUNTO DE VENTA · TIERRA DEL FUEGO
          </p>
        </div>

        {/* Card glass (mockups Dawn Sky) */}
        <section
          aria-labelledby="login-heading"
          className="pos-surface-operational rounded-2xl p-6"
        >
          <h2
            id="login-heading"
            className="mb-5 text-[color:var(--text-primary)] font-semibold"
            style={{ fontSize: 'var(--text-body-lg, 1.125rem)' }}
          >
            Ingresá a tu comercio
          </h2>
          <LoginForm next={next} />
        </section>

        <p
          className="mt-6 text-center text-[color:var(--text-muted)]"
          style={{ fontSize: 'var(--text-caption)' }}
        >
          ¿Problemas para entrar? Hablá con el dueño del comercio.
        </p>
      </div>
    </main>
  );
}
