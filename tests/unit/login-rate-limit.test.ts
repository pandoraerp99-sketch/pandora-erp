/**
 * T-SEC-05 — el rate limit está CABLEADO al login, no sólo escrito.
 *
 * `tests/unit/rate-limit.test.ts` ya prueba el módulo por dentro. Esto es
 * otra cosa: prueba que la Server Action `signIn` efectivamente lo llama.
 * Antes de 2026-09-05 el módulo estaba completo, testeado, y sin un solo
 * import — el login aceptaba intentos infinitos.
 *
 * La aserción que importa: al 6º intento, `signInWithPassword` **no se
 * llama**. Si el rechazo ocurriera después de consultar a Supabase, el
 * rate limit no estaría defendiendo nada — sería un mensaje de error más
 * caro. Por eso se cuentan las llamadas al cliente de auth, no el texto
 * que devuelve la acción.
 *
 * CLAUDE.md §11.2 · ADR-0019 S2 · catálogo §18.3 T-SEC-05.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────
// Headers controlables: cada test elige qué IP "llega".
const mockHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(mockHeaders.current),
}));

// signInWithPassword espiado — es el contador que decide el veredicto.
const mockSignIn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/supabase-server', () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({ auth: { signInWithPassword: mockSignIn } }),
}));

// El tracing real necesita cookies/sesión; acá sólo hace falta que corra fn().
vi.mock('@/lib/tracing/server-action-tracing', () => ({
  withServerActionTracing: (fn: () => unknown) => Promise.resolve(fn()),
}));

// audit_log escribe en la base — fuera del alcance de un unitario.
// Tipado explícito del argumento: sin él, `mock.calls` es la tupla vacía y
// `calls[0][0]` no compila con noUncheckedIndexedAccess.
const mockAudit = vi.hoisted(() =>
  vi.fn((_input: Record<string, unknown>): Promise<void> => Promise.resolve())
);
vi.mock('@/lib/audit/audit-writer', () => ({ writeAuditLog: mockAudit }));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { signIn } from '@/app/login/actions';
import { IP_UNKNOWN_SENTINEL } from '@/lib/security/client-ip';
import { defaultRateLimitStore } from '@/lib/security/rate-limit';

/** FormData de un intento de login. */
function form(email: string, password = 'lo-que-sea'): FormData {
  const fd = new FormData();
  fd.set('email', email);
  fd.set('password', password);
  return fd;
}

describe('signIn — rate limit cableado', () => {
  beforeEach(() => {
    // El store es un singleton de módulo: sin reset, los intentos de un
    // test se acumulan sobre el siguiente y los resultados dependen del
    // orden de ejecución.
    defaultRateLimitStore.reset();
    mockSignIn.mockReset();
    mockAudit.mockReset();
    mockAudit.mockResolvedValue(undefined);
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    mockHeaders.current = new Headers({ 'x-real-ip': '203.0.113.7' });
  });

  it('deja pasar los primeros 5 intentos de una IP (POLICY_LOGIN_BY_IP)', async () => {
    for (let i = 0; i < 5; i++) {
      await signIn({}, form(`user${i}@test.com`));
    }
    expect(mockSignIn).toHaveBeenCalledTimes(5);
  });

  it('AL 6º INTENTO NO LLEGA A SUPABASE — el bloqueo es previo', async () => {
    for (let i = 0; i < 5; i++) {
      await signIn({}, form(`user${i}@test.com`));
    }
    expect(mockSignIn).toHaveBeenCalledTimes(5);

    const sexto = await signIn({}, form('user6@test.com'));

    // Sigue en 5: la 6ª nunca consultó credenciales.
    expect(mockSignIn).toHaveBeenCalledTimes(5);
    expect(sexto.error).toMatch(/demasiados intentos/i);
  });

  it('el bloqueo por IP NO depende de que el input sea válido', async () => {
    // Con emails malformados el Zod rechaza igual, pero el contador de IP
    // tiene que haber corrido ANTES. Si se chequeara después del parse,
    // esta ráfaga no gastaría intentos y la fuerza bruta sería gratis.
    for (let i = 0; i < 6; i++) {
      await signIn({}, form('no-es-un-email'));
    }

    // Ya consumió la cuota: un intento válido posterior encuentra la puerta
    // cerrada y no llega a Supabase.
    const result = await signIn({}, form('real@test.com'));
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(result.error).toMatch(/demasiados intentos/i);
  });

  it('IPs distintas no comparten cupo', async () => {
    for (let i = 0; i < 5; i++) {
      await signIn({}, form(`user${i}@test.com`));
    }
    expect(mockSignIn).toHaveBeenCalledTimes(5);

    // Otra IP arranca con su propio bucket.
    mockHeaders.current = new Headers({ 'x-real-ip': '198.51.100.1' });
    await signIn({}, form('otro@test.com'));
    expect(mockSignIn).toHaveBeenCalledTimes(6);
  });

  it('sin headers de IP se comparte un bucket — degrada a restrictivo', async () => {
    // Fail-closed: si la detección de IP se rompe, todos caen en el mismo
    // bucket y el límite los frena. Lo contrario (bucket nuevo por request)
    // dejaría el login sin defensa justo cuando la infra falla.
    mockHeaders.current = new Headers({});

    for (let i = 0; i < 5; i++) {
      await signIn({}, form(`user${i}@test.com`));
    }
    const sexto = await signIn({}, form('user6@test.com'));

    expect(mockSignIn).toHaveBeenCalledTimes(5);
    expect(sexto.error).toMatch(/demasiados intentos/i);
    expect(IP_UNKNOWN_SENTINEL.length).toBeGreaterThan(0);
  });
});

describe('signIn — auditoría', () => {
  beforeEach(() => {
    defaultRateLimitStore.reset();
    mockSignIn.mockReset();
    mockAudit.mockReset();
    mockAudit.mockResolvedValue(undefined);
    mockHeaders.current = new Headers({ 'x-real-ip': '203.0.113.7' });
  });

  it('un login fallido escribe auth.login.failed', async () => {
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid credentials' } });

    await signIn({}, form('alguien@test.com'));

    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0]?.[0]).toMatchObject({
      event_name: 'auth.login.failed',
      severity: 'warning',
    });
  });

  it('un login exitoso escribe auth.login.success', async () => {
    mockSignIn.mockResolvedValue({ error: null });

    // El happy path termina en redirect(), que acá lanza a propósito.
    await expect(signIn({}, form('alguien@test.com'))).rejects.toThrow(
      /REDIRECT:/
    );

    expect(mockAudit.mock.calls[0]?.[0]).toMatchObject({
      event_name: 'auth.login.success',
    });
  });

  it('NUNCA audita la contraseña', async () => {
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid credentials' } });

    await signIn({}, form('alguien@test.com', 'secreto-que-no-debe-viajar'));

    const payload = JSON.stringify(mockAudit.mock.calls[0]?.[0]);
    expect(payload).not.toContain('secreto-que-no-debe-viajar');
  });

  it('si audit_log falla, el login NO se cae', async () => {
    // Un hipo de la base no puede convertir un rechazo de credenciales en
    // un 500 — ni, peor, romper un login legítimo.
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    mockAudit.mockRejectedValue(new Error('base caída'));

    const result = await signIn({}, form('alguien@test.com'));

    expect(result.error).toBe('Email o contraseña incorrectos.');
  });

  it('si audit_log falla en el happy path, el redirect igual ocurre', async () => {
    mockSignIn.mockResolvedValue({ error: null });
    mockAudit.mockRejectedValue(new Error('base caída'));

    await expect(signIn({}, form('alguien@test.com'))).rejects.toThrow(
      /REDIRECT:\/pos/
    );
  });
});
