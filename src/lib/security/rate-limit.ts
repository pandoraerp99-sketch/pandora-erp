/**
 * Rate limiting F0 — in-memory por proceso.
 * ADR-0019 S2 + CLAUDE.md §11.2 + web/security.md.
 *
 * **F0 in-memory:** alcanza para 5 clientes piloto. Cada proceso Vercel
 * tiene su propio store (si Vercel scale horizontal, cada instancia
 * cuenta por su cuenta — sobre-permite N veces el limite, pero F0 OK).
 *
 * **F1+ trigger:** > 100 req/s sostenidos O > 30 tenants activos → migrar
 * a Upstash Redis. La interface `RateLimitStore` esta diseñada para swap
 * sin tocar callers.
 *
 * **Estrategia: sliding window counter** (no token bucket). Mas simple,
 * suficiente para F0. Una entry per (policy, key) con counter + windowStart.
 * Cuando viene un check y windowStart + windowSec < now → reset counter a 1.
 *
 * **Cleanup: lazy on-access.** Cuando un key se consulta y ya expiro, se
 * resetea inline. NO hay cron interno que itere el Map (evita CPU drift
 * + complejidad). Trade-off: keys never-touched again retienen memoria
 * hasta proceso restart. Acceptable F0 (vol bajo). Si vol alto, agregar
 * cleanup periodico F1+.
 */

export interface RateLimitConfig {
  /**
   * Identificador de la policy (ej: 'login_by_ip'). Se usa como prefix
   * del key compuesto para que dos policies con mismo subject (ej: misma IP
   * en login y en endpoint publico) no se pisen.
   */
  policy: string;
  /** Maximo de requests permitidos en la ventana. */
  limit: number;
  /** Ventana en segundos (sliding). */
  windowSec: number;
}

export interface RateLimitEntry {
  count: number;
  /** UNIX ms cuando empezo la ventana actual. */
  windowStartMs: number;
}

export interface CheckRateLimitInput {
  config: RateLimitConfig;
  /**
   * Subject del rate limit (ej: IP "1.2.3.4" para login_by_ip; tenant_id
   * para AUTHENTICATED_ENDPOINT). Composicion final = `${policy}:${subject}`.
   */
  subject: string;
  /** Para tests determinísticos. */
  nowMs?: number;
}

export type CheckRateLimitResult =
  | {
      allowed: true;
      remaining: number;
      resetAtMs: number;
    }
  | {
      allowed: false;
      remaining: 0;
      resetAtMs: number;
      /** Cuanto falta para que se libere (segundos). */
      retryAfterSec: number;
    };

/**
 * Storage abstraction. F0: InMemoryRateLimitStore.
 * F1+: UpstashRateLimitStore con misma interface.
 */
export interface RateLimitStore {
  /**
   * Atomico: lee entry actual (o crea si no existe / esta expirada),
   * incrementa counter, devuelve estado post-incremento.
   * Si counter post-incremento > limit, NO desincrementa — el "exceso"
   * extiende implicitamente la ventana hasta que se libere naturalmente.
   */
  incrementAndCheck(
    fullKey: string,
    config: RateLimitConfig,
    nowMs: number
  ): RateLimitEntry;

  /** Solo para tests / debugging. */
  reset(fullKey?: string): void;

  /** Solo para tests / debugging. */
  size(): number;
}

/**
 * Implementacion in-memory thread-safe (single-threaded Node, no race).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, RateLimitEntry>();

  incrementAndCheck(
    fullKey: string,
    config: RateLimitConfig,
    nowMs: number
  ): RateLimitEntry {
    const windowMs = config.windowSec * 1000;
    const existing = this.entries.get(fullKey);

    if (existing === undefined || nowMs - existing.windowStartMs >= windowMs) {
      // Window expirada o key nueva → reset
      const fresh: RateLimitEntry = {
        count: 1,
        windowStartMs: nowMs,
      };
      this.entries.set(fullKey, fresh);
      return fresh;
    }

    // Dentro de la ventana → incrementa
    existing.count += 1;
    return existing;
  }

  reset(fullKey?: string): void {
    if (fullKey === undefined) {
      this.entries.clear();
    } else {
      this.entries.delete(fullKey);
    }
  }

  size(): number {
    return this.entries.size;
  }
}

/**
 * Check principal — atomico. Devuelve si el request puede proceder + metadata
 * para emitir headers `RateLimit-*` estandar (RFC 9239 draft).
 *
 * **Responsabilidades del caller cuando allowed=false:**
 *   - Respuesta HTTP 429 Too Many Requests + header `Retry-After: ${retryAfterSec}`
 *   - Pino warn con `security.rate_limit_hit` (subject anonimizado si pii_high)
 *   - Para policies de login (LOGIN_BY_IP, LOGIN_BY_EMAIL): audit_log con
 *     `auth.login.rate_limited` (catalogo F0 requiere event). NUNCA loguear
 *     el password attempted.
 *
 * **Normalizacion del subject** (defensa contra bypass por whitespace):
 * el subject se hace `.trim()` antes de componer la key. Subject que sea
 * solo whitespace post-trim → throw (bug de programacion del caller).
 */
export function checkRateLimit(
  store: RateLimitStore,
  input: CheckRateLimitInput
): CheckRateLimitResult {
  // Normalizar subject — evita bypass trivial con "  ip  " vs "ip"
  // (Caller deberia normalizar tambien al obtenerlo, esto es defense-in-depth).
  const normalizedSubject = input.subject.trim();
  if (normalizedSubject.length === 0) {
    throw new Error(
      'checkRateLimit: subject vacio o solo whitespace — bug de programacion'
    );
  }
  if (input.config.limit <= 0) {
    throw new Error('checkRateLimit: limit debe ser > 0');
  }
  if (input.config.windowSec <= 0) {
    throw new Error('checkRateLimit: windowSec debe ser > 0');
  }

  const fullKey = `${input.config.policy}:${normalizedSubject}`;
  const nowMs = input.nowMs ?? Date.now();
  const entry = store.incrementAndCheck(fullKey, input.config, nowMs);

  const windowMs = input.config.windowSec * 1000;
  const resetAtMs = entry.windowStartMs + windowMs;

  if (entry.count > input.config.limit) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((resetAtMs - nowMs) / 1000)
    );
    return {
      allowed: false,
      remaining: 0,
      resetAtMs,
      retryAfterSec,
    };
  }

  return {
    allowed: true,
    remaining: input.config.limit - entry.count,
    resetAtMs,
  };
}

// ────────────────────────────────────────────────────────────────────
// Catalogo F0 de policies — CERRADO. Agregar = PR + actualizar ADR-0019.
// ────────────────────────────────────────────────────────────────────

/**
 * Endpoints publicos (no autenticados): 100 req/min por IP.
 * Cubre /api/health, /api/webhooks/* recibir, signup, login attempt.
 * Limite suficientemente alto para no bloquear users legitimos detras
 * de un NAT chico, suficientemente bajo para frenar DDOS amateur.
 */
export const POLICY_PUBLIC_ENDPOINT: RateLimitConfig = {
  policy: 'public_endpoint',
  limit: 100,
  windowSec: 60,
};

/**
 * Endpoints autenticados: 1000 req/min por tenant.
 * Cubre operaciones normales POS (cobrar, listar, buscar producto).
 * Comercio TDF tipico 30-200 ventas/dia + browsing = << 1000 req/min.
 */
export const POLICY_AUTHENTICATED_ENDPOINT: RateLimitConfig = {
  policy: 'authenticated_endpoint',
  limit: 1000,
  windowSec: 60,
};

/**
 * Login por IP: 5 attempts/min. Brute-force defense capa 1.
 * Si attacker rota IPs (proxies), cae en POLICY_PUBLIC_ENDPOINT (100/min total).
 */
export const POLICY_LOGIN_BY_IP: RateLimitConfig = {
  policy: 'login_by_ip',
  limit: 5,
  windowSec: 60,
};

/**
 * Login por email: 10 attempts/hora. Brute-force defense capa 2 (cuenta
 * targeting). Window 1h porque emails legitimos raramente tipean password
 * mal mas de 10 veces en una hora.
 *
 * Hit de esta policy → audit_log `auth.login.failed` + email warning
 * al titular (Sprint 5+ auth).
 */
export const POLICY_LOGIN_BY_EMAIL: RateLimitConfig = {
  policy: 'login_by_email',
  limit: 10,
  windowSec: 60 * 60,
};

/**
 * Singleton del store F0 — un solo Map compartido por proceso.
 * Para tests: crear instances frescas con `new InMemoryRateLimitStore()`.
 */
export const defaultRateLimitStore: RateLimitStore = new InMemoryRateLimitStore();

/**
 * Helper compuesto: aplica AMBAS policies de login (IP + email) en una
 * sola llamada. Si cualquiera de las dos bloquea, retorna allowed=false.
 *
 * El subject IP es obligatorio (siempre conocido); email es opcional —
 * en algunos paths (ej: POST /login sin body parsed) el email no esta
 * aun disponible y solo aplica IP.
 */
export interface CheckLoginRateLimitInput {
  ip: string;
  email?: string;
  store?: RateLimitStore;
  nowMs?: number;
}

export type CheckLoginRateLimitResult =
  | { allowed: true; remaining: { byIp: number; byEmail: number | null } }
  | {
      allowed: false;
      blockedBy: 'ip' | 'email';
      retryAfterSec: number;
    };

export function checkLoginRateLimit(
  input: CheckLoginRateLimitInput
): CheckLoginRateLimitResult {
  const store = input.store ?? defaultRateLimitStore;

  const byIp = checkRateLimit(store, {
    config: POLICY_LOGIN_BY_IP,
    subject: input.ip,
    nowMs: input.nowMs,
  });

  if (!byIp.allowed) {
    return {
      allowed: false,
      blockedBy: 'ip',
      retryAfterSec: byIp.retryAfterSec,
    };
  }

  if (input.email !== undefined && input.email.length > 0) {
    const byEmail = checkRateLimit(store, {
      config: POLICY_LOGIN_BY_EMAIL,
      subject: input.email.toLowerCase(),
      nowMs: input.nowMs,
    });

    if (!byEmail.allowed) {
      return {
        allowed: false,
        blockedBy: 'email',
        retryAfterSec: byEmail.retryAfterSec,
      };
    }

    return {
      allowed: true,
      remaining: { byIp: byIp.remaining, byEmail: byEmail.remaining },
    };
  }

  return {
    allowed: true,
    remaining: { byIp: byIp.remaining, byEmail: null },
  };
}
