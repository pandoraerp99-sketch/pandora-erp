/**
 * Tests unitarios rate_limit — helpers puros + store in-memory.
 *
 * Cubre:
 * - InMemoryRateLimitStore: incrementAndCheck, reset, size, window expira
 * - checkRateLimit: dentro de limite, sobre el limite, window reset
 * - Catalogo de policies F0 (valores exactos por ADR-0019)
 * - checkLoginRateLimit: composicion IP+email + edge cases
 * - Edge cases: subject vacio, limit invalido, multiples keys
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryRateLimitStore,
  POLICY_AUTHENTICATED_ENDPOINT,
  POLICY_LOGIN_BY_EMAIL,
  POLICY_LOGIN_BY_IP,
  POLICY_PUBLIC_ENDPOINT,
  checkLoginRateLimit,
  checkRateLimit,
  type RateLimitConfig,
} from '@/lib/security/rate-limit';

describe('InMemoryRateLimitStore', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  const config: RateLimitConfig = {
    policy: 'test',
    limit: 5,
    windowSec: 60,
  };

  it('primer incrementAndCheck crea entry con count=1', () => {
    const r = store.incrementAndCheck('test:abc', config, 1000);
    expect(r.count).toBe(1);
    expect(r.windowStartMs).toBe(1000);
  });

  it('incrementos sucesivos dentro de ventana acumulan', () => {
    store.incrementAndCheck('test:abc', config, 1000);
    store.incrementAndCheck('test:abc', config, 2000);
    const r = store.incrementAndCheck('test:abc', config, 3000);
    expect(r.count).toBe(3);
    expect(r.windowStartMs).toBe(1000);
  });

  it('window expirada resetea counter', () => {
    store.incrementAndCheck('test:abc', config, 1000);
    // Avanzar exactamente windowSec (60s = 60000ms) → window expirada
    const r = store.incrementAndCheck('test:abc', config, 1000 + 60000);
    expect(r.count).toBe(1);
    expect(r.windowStartMs).toBe(1000 + 60000);
  });

  it('keys distintos NO comparten counter', () => {
    store.incrementAndCheck('test:abc', config, 1000);
    store.incrementAndCheck('test:def', config, 1000);
    const a = store.incrementAndCheck('test:abc', config, 2000);
    const d = store.incrementAndCheck('test:def', config, 2000);
    expect(a.count).toBe(2);
    expect(d.count).toBe(2);
  });

  it('size refleja cantidad de keys activos', () => {
    expect(store.size()).toBe(0);
    store.incrementAndCheck('test:a', config, 1000);
    store.incrementAndCheck('test:b', config, 1000);
    expect(store.size()).toBe(2);
  });

  it('reset(key) borra solo ese key', () => {
    store.incrementAndCheck('test:a', config, 1000);
    store.incrementAndCheck('test:b', config, 1000);
    store.reset('test:a');
    expect(store.size()).toBe(1);
  });

  it('reset() sin argumento borra todo', () => {
    store.incrementAndCheck('test:a', config, 1000);
    store.incrementAndCheck('test:b', config, 1000);
    store.reset();
    expect(store.size()).toBe(0);
  });
});

describe('checkRateLimit', () => {
  let store: InMemoryRateLimitStore;
  const config: RateLimitConfig = {
    policy: 'test',
    limit: 3,
    windowSec: 60,
  };

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  it('primer request → allowed con remaining=limit-1', () => {
    const r = checkRateLimit(store, {
      config,
      subject: 'user-1',
      nowMs: 1000,
    });
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.remaining).toBe(2);
    }
  });

  it('alcanza limite → ultimo allowed con remaining=0', () => {
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    const third = checkRateLimit(store, {
      config,
      subject: 'u',
      nowMs: 1000,
    });
    expect(third.allowed).toBe(true);
    if (third.allowed) {
      expect(third.remaining).toBe(0);
    }
  });

  it('excede limite → blocked + retryAfterSec', () => {
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    const fourth = checkRateLimit(store, {
      config,
      subject: 'u',
      nowMs: 1000,
    });
    expect(fourth.allowed).toBe(false);
    if (!fourth.allowed) {
      expect(fourth.remaining).toBe(0);
      expect(fourth.retryAfterSec).toBeGreaterThan(0);
      expect(fourth.retryAfterSec).toBeLessThanOrEqual(60);
    }
  });

  it('retryAfterSec calculado relativo a nowMs', () => {
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    // 30 segundos despues, ventana de 60s → falta ~30s
    const r = checkRateLimit(store, {
      config,
      subject: 'u',
      nowMs: 1000 + 30000,
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.retryAfterSec).toBeGreaterThanOrEqual(29);
      expect(r.retryAfterSec).toBeLessThanOrEqual(31);
    }
  });

  it('despues de window expira, requests vuelven a ser allowed', () => {
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'u', nowMs: 1000 });
    // Blocked dentro de ventana
    const blocked = checkRateLimit(store, {
      config,
      subject: 'u',
      nowMs: 1500,
    });
    expect(blocked.allowed).toBe(false);
    // 60s despues → window expirada
    const afterWindow = checkRateLimit(store, {
      config,
      subject: 'u',
      nowMs: 1000 + 60000,
    });
    expect(afterWindow.allowed).toBe(true);
    if (afterWindow.allowed) {
      expect(afterWindow.remaining).toBe(2);
    }
  });

  it('subjects distintos tienen contadores independientes', () => {
    checkRateLimit(store, { config, subject: 'user-a', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'user-a', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'user-a', nowMs: 1000 });
    // user-a bloqueado
    const aBlocked = checkRateLimit(store, {
      config,
      subject: 'user-a',
      nowMs: 1000,
    });
    expect(aBlocked.allowed).toBe(false);
    // user-b sigue libre
    const bFree = checkRateLimit(store, {
      config,
      subject: 'user-b',
      nowMs: 1000,
    });
    expect(bFree.allowed).toBe(true);
  });

  it('subject vacio → throw (bug programacion)', () => {
    expect(() =>
      checkRateLimit(store, { config, subject: '', nowMs: 1000 })
    ).toThrow(/subject vacio/);
  });

  it('subject solo whitespace → throw (defense bypass)', () => {
    expect(() =>
      checkRateLimit(store, { config, subject: '   ', nowMs: 1000 })
    ).toThrow(/subject vacio/);
    expect(() =>
      checkRateLimit(store, { config, subject: '\t\n', nowMs: 1000 })
    ).toThrow();
  });

  it('subject con whitespace al rededor se normaliza (defense bypass)', () => {
    // Sin trim, "  user-1  " y "user-1" serian keys distintos = bypass trivial.
    // Con trim, ambos cuentan como mismo subject.
    checkRateLimit(store, { config, subject: 'user-1', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'user-1', nowMs: 1000 });
    checkRateLimit(store, { config, subject: 'user-1', nowMs: 1000 });
    // Limite ya alcanzado. Intento bypass con whitespace.
    const bypassAttempt = checkRateLimit(store, {
      config,
      subject: '  user-1  ',
      nowMs: 1000,
    });
    expect(bypassAttempt.allowed).toBe(false);
  });

  it('limit 0 o negativo → throw', () => {
    expect(() =>
      checkRateLimit(store, {
        config: { ...config, limit: 0 },
        subject: 'u',
        nowMs: 1000,
      })
    ).toThrow(/limit/);
    expect(() =>
      checkRateLimit(store, {
        config: { ...config, limit: -1 },
        subject: 'u',
        nowMs: 1000,
      })
    ).toThrow();
  });

  it('windowSec 0 o negativo → throw', () => {
    expect(() =>
      checkRateLimit(store, {
        config: { ...config, windowSec: 0 },
        subject: 'u',
        nowMs: 1000,
      })
    ).toThrow();
  });

  it('policies distintas con mismo subject NO se pisan', () => {
    const policyA: RateLimitConfig = {
      policy: 'a',
      limit: 1,
      windowSec: 60,
    };
    const policyB: RateLimitConfig = {
      policy: 'b',
      limit: 1,
      windowSec: 60,
    };
    // user-1 alcanza limite en policy a
    checkRateLimit(store, { config: policyA, subject: 'user-1', nowMs: 1000 });
    const blockedA = checkRateLimit(store, {
      config: policyA,
      subject: 'user-1',
      nowMs: 1000,
    });
    expect(blockedA.allowed).toBe(false);
    // policy b sigue libre para mismo user
    const freeB = checkRateLimit(store, {
      config: policyB,
      subject: 'user-1',
      nowMs: 1000,
    });
    expect(freeB.allowed).toBe(true);
  });
});

describe('Catalogo policies F0 (ADR-0019 S2)', () => {
  it('POLICY_PUBLIC_ENDPOINT: 100 req/min', () => {
    expect(POLICY_PUBLIC_ENDPOINT.limit).toBe(100);
    expect(POLICY_PUBLIC_ENDPOINT.windowSec).toBe(60);
    expect(POLICY_PUBLIC_ENDPOINT.policy).toBe('public_endpoint');
  });

  it('POLICY_AUTHENTICATED_ENDPOINT: 1000 req/min', () => {
    expect(POLICY_AUTHENTICATED_ENDPOINT.limit).toBe(1000);
    expect(POLICY_AUTHENTICATED_ENDPOINT.windowSec).toBe(60);
  });

  it('POLICY_LOGIN_BY_IP: 5 attempts/min', () => {
    expect(POLICY_LOGIN_BY_IP.limit).toBe(5);
    expect(POLICY_LOGIN_BY_IP.windowSec).toBe(60);
  });

  it('POLICY_LOGIN_BY_EMAIL: 10 attempts/hora', () => {
    expect(POLICY_LOGIN_BY_EMAIL.limit).toBe(10);
    expect(POLICY_LOGIN_BY_EMAIL.windowSec).toBe(60 * 60);
  });

  it('policies tienen identificadores unicos (no colisiones)', () => {
    const policies = [
      POLICY_PUBLIC_ENDPOINT.policy,
      POLICY_AUTHENTICATED_ENDPOINT.policy,
      POLICY_LOGIN_BY_IP.policy,
      POLICY_LOGIN_BY_EMAIL.policy,
    ];
    expect(new Set(policies).size).toBe(policies.length);
  });
});

describe('checkLoginRateLimit', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  it('happy path: IP + email primera vez → allowed', () => {
    const r = checkLoginRateLimit({
      ip: '1.2.3.4',
      email: 'agus@example.com',
      store,
      nowMs: 1000,
    });
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.remaining.byIp).toBe(4);
      expect(r.remaining.byEmail).toBe(9);
    }
  });

  it('sin email → solo aplica IP', () => {
    const r = checkLoginRateLimit({
      ip: '1.2.3.4',
      store,
      nowMs: 1000,
    });
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.remaining.byIp).toBe(4);
      expect(r.remaining.byEmail).toBeNull();
    }
  });

  it('IP bloquea primero (5 attempts/min)', () => {
    for (let i = 0; i < 5; i++) {
      checkLoginRateLimit({
        ip: '1.2.3.4',
        email: `user${i}@x.com`,
        store,
        nowMs: 1000,
      });
    }
    const r = checkLoginRateLimit({
      ip: '1.2.3.4',
      email: 'user6@x.com',
      store,
      nowMs: 1000,
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.blockedBy).toBe('ip');
    }
  });

  it('email bloquea si IP varia pero email se repite', () => {
    // Attacker rota IPs (distintas cada vez) → IP nunca llega a 5
    // pero email se repite → email bloquea a los 10
    for (let i = 0; i < 10; i++) {
      checkLoginRateLimit({
        ip: `10.0.0.${i}`,
        email: 'target@example.com',
        store,
        nowMs: 1000,
      });
    }
    const r = checkLoginRateLimit({
      ip: '10.0.0.99',
      email: 'target@example.com',
      store,
      nowMs: 1000,
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.blockedBy).toBe('email');
    }
  });

  it('email lowercased — Target@X.com y target@x.com cuentan como mismo', () => {
    for (let i = 0; i < 5; i++) {
      checkLoginRateLimit({
        ip: `10.0.0.${i}`,
        email: 'Target@X.com',
        store,
        nowMs: 1000,
      });
    }
    for (let i = 5; i < 10; i++) {
      checkLoginRateLimit({
        ip: `10.0.0.${i}`,
        email: 'target@x.com',
        store,
        nowMs: 1000,
      });
    }
    const r = checkLoginRateLimit({
      ip: '10.0.0.99',
      email: 'TARGET@X.COM',
      store,
      nowMs: 1000,
    });
    expect(r.allowed).toBe(false);
  });

  it('email vacio se trata como ausente (solo IP)', () => {
    const r = checkLoginRateLimit({
      ip: '1.2.3.4',
      email: '',
      store,
      nowMs: 1000,
    });
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.remaining.byEmail).toBeNull();
    }
  });
});
