'use client';

/**
 * Formulario de login (client) — Slice 2/5. Dawn Industrial Editorial.
 *
 * useActionState (React 19) para llamar la Server Action `signIn` y mostrar
 * error inline sin perder los campos. Keyboard-first: email con autofocus,
 * Enter envía.
 */
import { useActionState } from 'react';
import { signIn, type SignInState } from './actions';

const INITIAL: SignInState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(
    signIn,
    INITIAL
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ''} />

      <label className="flex flex-col gap-1.5">
        <span
          className="text-[color:var(--text-secondary)] font-medium"
          style={{ fontSize: 'var(--text-caption)' }}
        >
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="operador@tucomercio.com"
          className="pos-focusable rounded-lg px-3.5 py-2.5 bg-[color:var(--surface-base)] border border-[color:color-mix(in_oklch,var(--dawn-300)_45%,transparent)] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] outline-none"
          style={{ fontSize: 'var(--text-body)' }}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span
          className="text-[color:var(--text-secondary)] font-medium"
          style={{ fontSize: 'var(--text-caption)' }}
        >
          Contraseña
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="pos-focusable rounded-lg px-3.5 py-2.5 bg-[color:var(--surface-base)] border border-[color:color-mix(in_oklch,var(--dawn-300)_45%,transparent)] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] outline-none"
          style={{ fontSize: 'var(--text-body)' }}
        />
      </label>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg px-3 py-2 text-[color:var(--semantic-error)]"
          style={{
            fontSize: 'var(--text-caption)',
            background:
              'color-mix(in oklch, var(--semantic-error) 9%, transparent)',
          }}
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="pos-focusable mt-1 rounded-lg py-2.5 font-semibold text-white transition-[opacity,transform] active:scale-[0.99] disabled:opacity-60"
        style={{
          fontSize: 'var(--text-body)',
          background: 'var(--dawn-500)',
          boxShadow: '0 1px 3px oklch(60% 0.195 218 / 0.35)',
        }}
      >
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
