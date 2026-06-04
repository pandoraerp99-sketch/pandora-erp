/**
 * Tests unitarios vault — encrypt/decrypt AES-256-GCM.
 *
 * Cubre:
 * - Round-trip encrypt/decrypt
 * - Cada encrypt genera ciphertext distinto (IV random per call)
 * - Tampering detection (modificar ciphertext, authTag, iv → throw)
 * - Wire format validation (segmentos, version, base64, lengths)
 * - Plaintext vacio → throw (defense)
 * - isVaultReady check
 *
 * Tests NO cubren key rotation (es F1+ deferido por drift).
 */
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  isVaultReady,
  VaultError,
} from '@/lib/security/vault';

describe('isVaultReady', () => {
  it('no throwa con env.SECRETS_ENCRYPTION_KEY_V1 cargado (tests/setup.ts)', () => {
    // Signature corregida tras advisor: ahora void, no boolean
    // (antes decia boolean pero nunca retornaba false → confundia API)
    expect(() => isVaultReady()).not.toThrow();
  });
});

describe('encryptSecret + decryptSecret — round-trip', () => {
  it('encripta y desencripta un string utf-8 simple', () => {
    const plain = 'cert-afip-password-123';
    const wire = encryptSecret(plain);
    expect(decryptSecret(wire)).toBe(plain);
  });

  it('soporta strings largos (cert P12 password tipico)', () => {
    const plain = 'a'.repeat(1024) + '-fin-del-secret';
    const wire = encryptSecret(plain);
    expect(decryptSecret(wire)).toBe(plain);
  });

  it('soporta unicode UTF-8 (tildes, ñ, simbolos)', () => {
    const plain = 'María Ñuñoa $1.329.033 — TDF Ley 19.640';
    const wire = encryptSecret(plain);
    expect(decryptSecret(wire)).toBe(plain);
  });

  it('soporta caracteres especiales en passwords (quote, slash, semicolon)', () => {
    const plain = 'p@$$w0rd!"\\;:[]{}<>?';
    const wire = encryptSecret(plain);
    expect(decryptSecret(wire)).toBe(plain);
  });

  it('plaintext muy chico (1 char) → round-trip OK', () => {
    const wire = encryptSecret('x');
    expect(decryptSecret(wire)).toBe('x');
  });
});

describe('encryptSecret — wire format', () => {
  it('prefix v1: + 3 segmentos base64', () => {
    const wire = encryptSecret('test-secret');
    const parts = wire.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('cada llamada genera ciphertext distinto (IV random per encrypt)', () => {
    const plain = 'misma-secret-misma-key';
    const wire1 = encryptSecret(plain);
    const wire2 = encryptSecret(plain);
    expect(wire1).not.toBe(wire2);
    // Pero ambos desencriptan al mismo plaintext
    expect(decryptSecret(wire1)).toBe(plain);
    expect(decryptSecret(wire2)).toBe(plain);
  });

  it('100 encrypts del mismo plain → 100 ciphertexts distintos (sanity entropy IV)', () => {
    const plain = 'plain';
    const wires = new Set<string>();
    for (let i = 0; i < 100; i++) wires.add(encryptSecret(plain));
    expect(wires.size).toBe(100);
  });

  it('IV es 12 bytes (96 bits per NIST GCM)', () => {
    const wire = encryptSecret('test');
    const parts = wire.split(':');
    const iv = Buffer.from(parts[1]!, 'base64');
    expect(iv.length).toBe(12);
  });

  it('authTag es 16 bytes (128 bits GCM default)', () => {
    const wire = encryptSecret('test');
    const parts = wire.split(':');
    const authTag = Buffer.from(parts[2]!, 'base64');
    expect(authTag.length).toBe(16);
  });
});

describe('encryptSecret — defensa input', () => {
  it('plaintext vacio → throw invalid_plaintext', () => {
    expect(() => encryptSecret('')).toThrow(VaultError);
    try {
      encryptSecret('');
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError);
      expect((e as VaultError).code).toBe('invalid_plaintext');
    }
  });
});

describe('decryptSecret — wire format validation', () => {
  it('wire vacio → throw invalid_wire_format', () => {
    expect(() => decryptSecret('')).toThrow(VaultError);
  });

  it('segmentos != 4 → throw invalid_wire_format', () => {
    try {
      decryptSecret('v1:a:b');
    } catch (e) {
      expect((e as VaultError).code).toBe('invalid_wire_format');
    }
    try {
      decryptSecret('v1:a:b:c:d:e');
    } catch (e) {
      expect((e as VaultError).code).toBe('invalid_wire_format');
    }
  });

  it('version != v1 → throw unsupported_version', () => {
    try {
      const wire = encryptSecret('test');
      const parts = wire.split(':');
      const tampered = ['v999', parts[1], parts[2], parts[3]].join(':');
      decryptSecret(tampered);
      expect.fail('Deberia haber throwed');
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError);
      expect((e as VaultError).code).toBe('unsupported_version');
    }
  });

  it('iv length wrong → throw invalid_wire_format', () => {
    const wire = encryptSecret('test');
    const parts = wire.split(':');
    // IV de 5 bytes en vez de 12
    const fakeIv = Buffer.from('hello').toString('base64');
    const broken = ['v1', fakeIv, parts[2], parts[3]].join(':');
    try {
      decryptSecret(broken);
    } catch (e) {
      expect((e as VaultError).code).toBe('invalid_wire_format');
    }
  });

  it('authTag length wrong → throw invalid_wire_format', () => {
    const wire = encryptSecret('test');
    const parts = wire.split(':');
    const fakeAuthTag = Buffer.from('xx').toString('base64');
    const broken = ['v1', parts[1], fakeAuthTag, parts[3]].join(':');
    try {
      decryptSecret(broken);
    } catch (e) {
      expect((e as VaultError).code).toBe('invalid_wire_format');
    }
  });

  // Advisor fix 2026-06-02: Node.js Buffer.from(garbage, 'base64') silenciosamente
  // TRUNCA en vez de throw, asi que validamos base64 strict ANTES con regex.
  // Sin estos tests, garbage en wire pasaba con ciphertext corrupto y GCM lo
  // reportaba como tampering — ocultando que el problema real era input invalido.

  it('iv con char invalido (NO base64) → throw invalid_wire_format', () => {
    const wire = encryptSecret('test');
    const parts = wire.split(':');
    // `!@#` no son chars base64 — Buffer.from los descarta silenciosamente
    const broken = ['v1', '!@#$%^&*()', parts[2], parts[3]].join(':');
    try {
      decryptSecret(broken);
      expect.fail('Deberia haber throwed invalid_wire_format');
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError);
      expect((e as VaultError).code).toBe('invalid_wire_format');
      expect((e as VaultError).message).toContain('iv no es base64');
    }
  });

  it('authTag con char invalido (NO base64) → throw invalid_wire_format', () => {
    const wire = encryptSecret('test');
    const parts = wire.split(':');
    const broken = ['v1', parts[1], '!@#$%^&*()', parts[3]].join(':');
    try {
      decryptSecret(broken);
      expect.fail('Deberia haber throwed invalid_wire_format');
    } catch (e) {
      expect((e as VaultError).code).toBe('invalid_wire_format');
      expect((e as VaultError).message).toContain('authTag no es base64');
    }
  });

  it('ciphertext con char invalido (NO base64) → throw invalid_wire_format', () => {
    const wire = encryptSecret('test');
    const parts = wire.split(':');
    const broken = ['v1', parts[1], parts[2], '!@#$%^&*()'].join(':');
    try {
      decryptSecret(broken);
      expect.fail('Deberia haber throwed invalid_wire_format');
    } catch (e) {
      expect((e as VaultError).code).toBe('invalid_wire_format');
      expect((e as VaultError).message).toContain('ciphertext no es base64');
    }
  });

  it('iv vacio → throw invalid_wire_format (no base64 strict permite empty)', () => {
    const wire = encryptSecret('test');
    const parts = wire.split(':');
    const broken = ['v1', '', parts[2], parts[3]].join(':');
    try {
      decryptSecret(broken);
      expect.fail('Deberia haber throwed');
    } catch (e) {
      expect((e as VaultError).code).toBe('invalid_wire_format');
    }
  });
});

describe('decryptSecret — tampering detection (GCM authTag)', () => {
  it('ciphertext modificado → throw tampering_detected', () => {
    const wire = encryptSecret('test-secret-original');
    const parts = wire.split(':');
    // Modificar el ciphertext (flip un byte)
    const cipherBuf = Buffer.from(parts[3]!, 'base64');
    cipherBuf[0] = cipherBuf[0]! ^ 0xff;
    const tamperedCipher = cipherBuf.toString('base64');
    const tamperedWire = [parts[0], parts[1], parts[2], tamperedCipher].join(':');
    try {
      decryptSecret(tamperedWire);
      expect.fail('Deberia haber throwed tampering_detected');
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError);
      expect((e as VaultError).code).toBe('tampering_detected');
    }
  });

  it('authTag modificado → throw tampering_detected', () => {
    const wire = encryptSecret('test-secret');
    const parts = wire.split(':');
    const authBuf = Buffer.from(parts[2]!, 'base64');
    authBuf[0] = authBuf[0]! ^ 0xff;
    const tamperedAuth = authBuf.toString('base64');
    const tamperedWire = [parts[0], parts[1], tamperedAuth, parts[3]].join(':');
    try {
      decryptSecret(tamperedWire);
      expect.fail('Deberia haber throwed tampering_detected');
    } catch (e) {
      expect((e as VaultError).code).toBe('tampering_detected');
    }
  });

  it('iv modificado → throw tampering_detected (cambia el plaintext esperado)', () => {
    const wire = encryptSecret('test');
    const parts = wire.split(':');
    const ivBuf = Buffer.from(parts[1]!, 'base64');
    ivBuf[0] = ivBuf[0]! ^ 0xff;
    const tamperedIv = ivBuf.toString('base64');
    const tamperedWire = [parts[0], tamperedIv, parts[2], parts[3]].join(':');
    try {
      decryptSecret(tamperedWire);
      expect.fail('Deberia haber throwed');
    } catch (e) {
      expect((e as VaultError).code).toBe('tampering_detected');
    }
  });

  it('intercambiar wires distintos → tampering (mismo key, distinto IV/authTag)', () => {
    const wire1 = encryptSecret('secret-a');
    const wire2 = encryptSecret('secret-b');
    const p1 = wire1.split(':');
    const p2 = wire2.split(':');
    // ciphertext de wire2 con iv+authTag de wire1 → authTag no matchea
    const frankenstein = [p1[0], p1[1], p1[2], p2[3]].join(':');
    try {
      decryptSecret(frankenstein);
      expect.fail('Deberia haber throwed');
    } catch (e) {
      expect((e as VaultError).code).toBe('tampering_detected');
    }
  });
});

describe('VaultError tipado', () => {
  it('preserva name + code + message', () => {
    const e = new VaultError('invalid_plaintext', 'test message');
    expect(e.name).toBe('VaultError');
    expect(e.code).toBe('invalid_plaintext');
    expect(e.message).toBe('test message');
  });

  it('instanceof check funciona (Object.setPrototypeOf en constructor)', () => {
    try {
      encryptSecret('');
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});

describe('Vault — no leaks de la key', () => {
  it('VaultError message NUNCA contiene el hex de la key', () => {
    try {
      encryptSecret('');
    } catch (e) {
      const msg = (e as Error).message;
      // env.SECRETS_ENCRYPTION_KEY_V1 = "aaaaaaaa..." en tests/setup.ts
      expect(msg).not.toMatch(/aaaaaaaa/);
    }
    try {
      decryptSecret('v1:invalid:base64:format');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toMatch(/aaaaaaaa/);
    }
  });

  it('wire format NUNCA contiene el plaintext en claro', () => {
    const plain = 'super-secret-cert-pass';
    const wire = encryptSecret(plain);
    expect(wire).not.toContain(plain);
    // Base64 del plaintext tampoco deberia coincidir
    expect(wire).not.toContain(Buffer.from(plain).toString('base64'));
  });
});
