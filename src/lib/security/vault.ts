/**
 * Vault encrypt/decrypt simple — AES-256-GCM.
 * ADR-0019 S5 + S5-bis + CLAUDE.md §11.8.
 *
 * **F0 alcance:** encrypt/decrypt simple. UNA key activa (V1) leida desde
 * `env.SECRETS_ENCRYPTION_KEY_V1`. **NO hay key versioning V1/V2/V3 ni
 * rotacion** — eso es F1+, diferido con trigger explicito en
 * [[sprint-1-platform-drift-2026-06-01]].
 *
 * **Razones del scope reducido F0:**
 * - 5 clientes piloto = key rotacion innecesaria (trigger F1+: primera
 *   sospecha de leak O 90 dias en prod).
 * - Re-encriptado gradual de N filas = complejidad operativa innecesaria F0.
 * - Versioning prematuro = over-engineering rechazado en master audit.
 *
 * **Casos de uso F0:**
 * - Cert AFIP password (cuando tenant carga su cert P12) — Sprint 6 fiscal
 * - Webhook signing secrets MercadoPago per-tenant (cuando carga config MP)
 * - Cualquier secret per-tenant que no sea env-global (esos van en Vercel env vars)
 *
 * **Algoritmo: AES-256-GCM.**
 * - 256-bit key (32 bytes raw, 64 chars hex en env)
 * - 96-bit IV random per encrypt (12 bytes — NIST SP 800-38D recomienda 96-bit para GCM)
 * - 128-bit authTag (16 bytes — GCM default, detecta tampering)
 *
 * **Formato wire:** `v1:base64(iv):base64(authTag):base64(ciphertext)`
 * El prefix `v1:` permite migracion futura a `v2:` con otro algoritmo o
 * versioning sin romper data existente.
 *
 * **NUNCA persistir la key.** Solo env. Esta lib NUNCA loguea la key
 * (Pino redact ya cubre `SECRETS_ENCRYPTION_KEY_*`).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../env.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32; // 256 bits
const IV_LENGTH_BYTES = 12; // 96 bits per NIST SP 800-38D recommendation
const AUTH_TAG_LENGTH_BYTES = 16; // 128 bits GCM default
const WIRE_VERSION = 'v1';

/**
 * Regex base64 strict — usado para validar segmentos del wire ANTES de
 * pasarlos a Buffer.from(). Node.js Buffer.from(garbage, 'base64')
 * silenciosamente TRUNCA en vez de throw, asi que la validacion debe
 * ocurrir explicita aqui (fix advisor 2026-06-02).
 *
 * Acepta padding `=` opcional al final (1 o 2 `=`).
 */
const BASE64_STRICT_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

function isStrictBase64(s: string): boolean {
  return s.length > 0 && BASE64_STRICT_REGEX.test(s);
}

/**
 * Errores tipados — el caller puede distinguir tampering vs config error.
 */
export class VaultError extends Error {
  constructor(
    public readonly code:
      | 'invalid_wire_format'
      | 'tampering_detected'
      | 'wrong_key'
      | 'unsupported_version'
      | 'invalid_plaintext'
      | 'invalid_key_config',
    message: string
  ) {
    super(message);
    this.name = 'VaultError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Lee + valida la key de env. Llamada lazy (no al import) para que tests
 * puedan mockear env antes del primer uso.
 *
 * Throws si:
 * - SECRETS_ENCRYPTION_KEY_V1 ausente (env validation ya bloqueo eso, pero defense-in-depth)
 * - Hex invalido
 * - Length != 32 bytes (256-bit key)
 */
function loadActiveKey(): Buffer {
  const hex = env.SECRETS_ENCRYPTION_KEY_V1;
  if (typeof hex !== 'string' || hex.length === 0) {
    throw new VaultError(
      'invalid_key_config',
      'SECRETS_ENCRYPTION_KEY_V1 ausente o vacio en env'
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new VaultError(
      'invalid_key_config',
      'SECRETS_ENCRYPTION_KEY_V1 no es hex valido'
    );
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== KEY_LENGTH_BYTES) {
    throw new VaultError(
      'invalid_key_config',
      `SECRETS_ENCRYPTION_KEY_V1 length=${buf.length} bytes, esperado ${KEY_LENGTH_BYTES} (256 bits = 64 chars hex)`
    );
  }
  return buf;
}

/**
 * Encripta un plaintext (string utf-8) y devuelve el wire format.
 *
 * @returns string en formato `v1:base64(iv):base64(authTag):base64(ciphertext)`
 * @throws VaultError si plaintext vacio (defense — no se encripta nada)
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new VaultError(
      'invalid_plaintext',
      'encryptSecret: plaintext vacio o no-string'
    );
  }

  const key = loadActiveKey();
  const iv = randomBytes(IV_LENGTH_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  const ciphertextChunk1 = cipher.update(plaintext, 'utf8');
  const ciphertextChunk2 = cipher.final();
  const ciphertext = Buffer.concat([ciphertextChunk1, ciphertextChunk2]);
  const authTag = cipher.getAuthTag();

  return `${WIRE_VERSION}:${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Desencripta un wire format y devuelve el plaintext original.
 *
 * @throws VaultError con code descriptivo en cada falla:
 *   - invalid_wire_format: estructura wrong (no 4 segmentos, bad version, bad base64)
 *   - unsupported_version: prefix != v1
 *   - tampering_detected: authTag GCM no matchea (ciphertext alterado, authTag forged,
 *     O key incorrecta — GCM no distingue al nivel cripto).
 *
 * **Responsabilidad del caller cuando dispara `tampering_detected`:**
 * NO asumir ataque inmediato — operator runbook obligatorio:
 *   1. Chequear si hubo rotacion reciente de SECRETS_ENCRYPTION_KEY_V1
 *      (la wire fue encriptada con key vieja, ahora desencriptas con la nueva
 *      = falso positivo de tampering).
 *   2. Chequear si la wire viene de otro environment (staging/prod cross-pollution).
 *   3. Solo despues de descartar 1-2 → audit_log severity=critical + alerta security.
 *
 * F1+ (trigger: primera rotacion real de key V2 en prod) — agregar `key_version`
 * al wire format (`v2:keyversion:iv:authTag:ciphertext`) para distinguir
 * wrong_key vs tampering inequivocamente.
 */
export function decryptSecret(wire: string): string {
  if (typeof wire !== 'string' || wire.length === 0) {
    throw new VaultError(
      'invalid_wire_format',
      'decryptSecret: wire vacio o no-string'
    );
  }

  const segments = wire.split(':');
  if (segments.length !== 4) {
    throw new VaultError(
      'invalid_wire_format',
      `decryptSecret: esperado 4 segmentos, recibido ${segments.length}`
    );
  }

  const [version, ivB64, authTagB64, ciphertextB64] = segments as [
    string,
    string,
    string,
    string,
  ];

  if (version !== WIRE_VERSION) {
    throw new VaultError(
      'unsupported_version',
      `decryptSecret: version ${version} no soportada (esperado ${WIRE_VERSION})`
    );
  }

  // Validar base64 strict ANTES de Buffer.from. Node.js Buffer.from(garbage, 'base64')
  // silenciosamente TRUNCA en vez de throw — el catch nunca dispara, la wire pasa
  // con ciphertext corrupto + GCM authTag falla mas adelante como "tampering",
  // ocultando que el problema real era input invalido. Fix advisor 2026-06-02.
  if (!isStrictBase64(ivB64)) {
    throw new VaultError(
      'invalid_wire_format',
      'decryptSecret: iv no es base64 valido'
    );
  }
  if (!isStrictBase64(authTagB64)) {
    throw new VaultError(
      'invalid_wire_format',
      'decryptSecret: authTag no es base64 valido'
    );
  }
  if (!isStrictBase64(ciphertextB64)) {
    throw new VaultError(
      'invalid_wire_format',
      'decryptSecret: ciphertext no es base64 valido'
    );
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new VaultError(
      'invalid_wire_format',
      `decryptSecret: iv length=${iv.length}, esperado ${IV_LENGTH_BYTES}`
    );
  }
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new VaultError(
      'invalid_wire_format',
      `decryptSecret: authTag length=${authTag.length}, esperado ${AUTH_TAG_LENGTH_BYTES}`
    );
  }

  const key = loadActiveKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(authTag);

  try {
    const plainChunk1 = decipher.update(ciphertext);
    const plainChunk2 = decipher.final();
    return Buffer.concat([plainChunk1, plainChunk2]).toString('utf8');
  } catch {
    // GCM authTag mismatch — 3 causas posibles indistinguibles a nivel cripto.
    // Operator runbook (JSDoc arriba) define como triagear antes de asumir ataque.
    throw new VaultError(
      'tampering_detected',
      'decryptSecret: authTag GCM mismatch — ver JSDoc operator runbook antes de asumir ataque'
    );
  }
}

/**
 * Helper para tests + debugging: verifica que la key esta cargada correctamente
 * sin exponer el valor. Throws VaultError si problema config; return void si OK.
 *
 * Signature corregida tras advisor pass — antes decia `boolean` pero nunca
 * retornaba false (siempre throw o true). Confundia API.
 */
export function isVaultReady(): void {
  loadActiveKey();
}
