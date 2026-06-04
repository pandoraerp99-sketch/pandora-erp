/**
 * Scrub recursivo de secrets en payloads jsonb antes de persistir a
 * audit_log (10 anios inmutable).
 *
 * **Por que existe (advisor fix 2026-06-02 Sprint 2 #4):**
 *
 * Audit_log NO usa Pino redact — persiste payload jsonb crudo. Si un
 * caller bien intencionado (handler de login que loguea brute force
 * attempts, error handler que loguea request crudo AFIP) incluye un
 * secret en cleartext, el secret queda **10 anios inmutable** (Ley 11.683 +
 * trigger SQL prohibe UPDATE/DELETE).
 *
 * Patron equivalente al SECRET_PATHS de logger.ts pero adaptado a payloads
 * estaticos (no streaming) y devolviendo lista de paths scrubeados para
 * que el caller emita warning Pino + sea visible al developer.
 *
 * **NO sustituye al `pii_level` flag.** PII (DNI, email, direccion) queda
 * intacta — es scope legal del audit_log. Solo secrets (passwords, tokens,
 * api_keys, certs, encryption keys) se scrubean.
 *
 * **Immutable:** devuelve nueva copia, NO muta el input (CLAUDE.md
 * coding-style.md immutability).
 */
import { SECRET_PATHS } from './logger.js';

const REDACTED_VALUE = '[REDACTED]';

export interface ScrubResult {
  /** Payload con secrets reemplazados por '[REDACTED]'. */
  scrubbed: Record<string, unknown>;
  /** Paths donde se detectaron + reemplazaron secrets (ej: ['password', 'user.api_key']). */
  scrubbedPaths: string[];
}

interface CompiledMatcher {
  /** Keys que matchean en root level (sin wildcard). */
  rootKeys: Set<string>;
  /** Keys que matchean en ANY nested depth (de `*.X` patterns). */
  nestedKeys: Set<string>;
}

/**
 * Compila la lista de SECRET_PATHS en sets para lookup O(1).
 * Pattern semantics:
 *   - `password` → matches ONLY root-level key
 *   - `*.password` → matches `password` at ANY nested depth (no root)
 *   - `SECRETS_ENCRYPTION_KEY_V1` → root only
 *   - `*.SECRETS_ENCRYPTION_KEY_V1` → nested only
 *
 * Por convencion CLAUDE.md §10.5, cada secret tiene ambos patterns
 * (root + nested) — defense layered.
 */
function compileMatcher(paths: string[]): CompiledMatcher {
  const rootKeys = new Set<string>();
  const nestedKeys = new Set<string>();
  for (const p of paths) {
    if (p.startsWith('*.')) {
      nestedKeys.add(p.slice(2));
    } else if (!p.includes('*')) {
      rootKeys.add(p);
    }
    // Patrones mas complejos (`a.*.b`) NO soportados F0 — Pino los soporta
    // pero SECRET_PATHS canonico solo usa simple root + `*.X`.
  }
  return { rootKeys, nestedKeys };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Walk recursivo. Detecta keys que matchean SECRET_PATHS, reemplaza valor
 * por '[REDACTED]', y acumula los paths en scrubbedPaths para visibilidad.
 *
 * - Root depth (depth=0): solo matchea rootKeys
 * - Nested depth (depth>0): solo matchea nestedKeys
 * - Arrays: walk into each element (depth no incrementa por array, ej
 *   `user.tokens[0].password` → `password` matchea nested)
 *
 * Limite: 8 niveles de profundidad maxima (defense contra payload malicioso
 * con deeply-nested attack o cycles). Mas alla → devuelve el subtree intacto
 * + log al scrubbedPaths como `<truncated_at_depth_8>`.
 */
const MAX_DEPTH = 8;

function walkAndScrub(
  value: unknown,
  matcher: CompiledMatcher,
  pathPrefix: string,
  depth: number,
  scrubbedPaths: string[]
): unknown {
  if (depth > MAX_DEPTH) {
    scrubbedPaths.push(`${pathPrefix}<truncated_at_depth_${MAX_DEPTH}>`);
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, i) =>
      walkAndScrub(item, matcher, `${pathPrefix}[${i}]`, depth, scrubbedPaths)
    );
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const fullPath = pathPrefix === '' ? key : `${pathPrefix}.${key}`;
    const matches =
      depth === 0 ? matcher.rootKeys.has(key) : matcher.nestedKeys.has(key);

    if (matches) {
      out[key] = REDACTED_VALUE;
      scrubbedPaths.push(fullPath);
    } else {
      out[key] = walkAndScrub(val, matcher, fullPath, depth + 1, scrubbedPaths);
    }
  }
  return out;
}

/**
 * Scrubea recursivamente un payload usando SECRET_PATHS (o lista custom).
 *
 * @param payload Objeto a scrubear (input NO se muta).
 * @param paths Lista de patterns. Default: SECRET_PATHS canonica de logger.ts.
 * @returns `{ scrubbed, scrubbedPaths }` — scrubbed es la copia con
 *   secrets reemplazados; scrubbedPaths es la lista de paths donde se
 *   detectaron secrets (para visibility/warning).
 */
export function scrubSecretsFromPayload(
  payload: Record<string, unknown>,
  paths: string[] = SECRET_PATHS
): ScrubResult {
  const matcher = compileMatcher(paths);
  const scrubbedPaths: string[] = [];
  const scrubbed = walkAndScrub(
    payload,
    matcher,
    '',
    0,
    scrubbedPaths
  ) as Record<string, unknown>;
  return { scrubbed, scrubbedPaths };
}
