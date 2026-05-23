import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  AES_ALGO,
  AUTH_TAG_BYTES,
  DATA_KEY_BYTES,
  HKDF_HASH,
  HKDF_SALT,
  IV_BYTES,
  decryptValue,
  deriveTenantKey,
  encryptValue,
  parseMasterKeyHex,
} from '../../src/crypto.js';
import {
  SecretProviderError,
  SecretsAdapterConfigError,
} from '@caia/secrets-adapter';

const validMasterHex = '0'.repeat(64);
const validMaster = Buffer.alloc(DATA_KEY_BYTES, 7); // arbitrary deterministic bytes

describe('crypto constants', () => {
  it('AES_ALGO is aes-256-gcm', () => expect(AES_ALGO).toBe('aes-256-gcm'));
  it('IV is 12 bytes', () => expect(IV_BYTES).toBe(12));
  it('authTag is 16 bytes', () => expect(AUTH_TAG_BYTES).toBe(16));
  it('data key is 32 bytes', () => expect(DATA_KEY_BYTES).toBe(32));
  it('HKDF hash sha256', () => expect(HKDF_HASH).toBe('sha256'));
  it('HKDF salt fixed', () => expect(HKDF_SALT).toBe('caia-tenant-v1'));
});

describe('parseMasterKeyHex', () => {
  it('accepts 64-hex-char string', () => {
    const buf = parseMasterKeyHex(validMasterHex);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
  });
  it('accepts uppercase + whitespace', () => {
    const buf = parseMasterKeyHex(' AABBCCDDEEFF' + '0'.repeat(52) + ' ');
    expect(buf.length).toBe(32);
  });
  it('rejects non-hex chars', () => {
    expect(() => parseMasterKeyHex('zz' + '0'.repeat(62))).toThrow(
      SecretsAdapterConfigError,
    );
  });
  it('rejects wrong length (too short)', () => {
    expect(() => parseMasterKeyHex('0'.repeat(63))).toThrow(
      SecretsAdapterConfigError,
    );
  });
  it('rejects wrong length (too long)', () => {
    expect(() => parseMasterKeyHex('0'.repeat(65))).toThrow(
      SecretsAdapterConfigError,
    );
  });
  it('rejects empty', () => {
    expect(() => parseMasterKeyHex('')).toThrow(SecretsAdapterConfigError);
  });
  it('rejects non-string input', () => {
    // @ts-expect-error — purposeful runtime mistake.
    expect(() => parseMasterKeyHex(undefined)).toThrow(SecretsAdapterConfigError);
  });
});

describe('deriveTenantKey', () => {
  it('returns 32-byte buffer', () => {
    const k = deriveTenantKey(validMaster, 'tenant-a');
    expect(k).toBeInstanceOf(Buffer);
    expect(k.length).toBe(32);
  });
  it('is deterministic', () => {
    const k1 = deriveTenantKey(validMaster, 'tenant-a');
    const k2 = deriveTenantKey(validMaster, 'tenant-a');
    expect(k1.equals(k2)).toBe(true);
  });
  it('differs across tenants', () => {
    const a = deriveTenantKey(validMaster, 'tenant-a');
    const b = deriveTenantKey(validMaster, 'tenant-b');
    expect(a.equals(b)).toBe(false);
  });
  it('differs across master keys', () => {
    const m2 = Buffer.alloc(32, 8);
    const k1 = deriveTenantKey(validMaster, 'tenant-a');
    const k2 = deriveTenantKey(m2, 'tenant-a');
    expect(k1.equals(k2)).toBe(false);
  });
  it('rejects wrong-length master', () => {
    expect(() => deriveTenantKey(Buffer.alloc(31), 't')).toThrow(
      SecretsAdapterConfigError,
    );
  });
  it('rejects empty tenantId', () => {
    expect(() => deriveTenantKey(validMaster, '')).toThrow(
      SecretsAdapterConfigError,
    );
  });
});

describe('encryptValue / decryptValue (round-trip)', () => {
  it('round-trips a short ASCII string', () => {
    const k = deriveTenantKey(validMaster, 't');
    const blob = encryptValue(k, 'hunter2');
    expect(decryptValue(k, blob)).toBe('hunter2');
  });
  it('round-trips UTF-8 with multibyte chars', () => {
    const k = deriveTenantKey(validMaster, 't');
    const plaintext = '🔑 пароль — מפתח';
    expect(decryptValue(k, encryptValue(k, plaintext))).toBe(plaintext);
  });
  it('round-trips a 100KB payload', () => {
    const k = deriveTenantKey(validMaster, 't');
    const plaintext = 'A'.repeat(100_000);
    expect(decryptValue(k, encryptValue(k, plaintext))).toBe(plaintext);
  });
  it('produces unique ciphertexts for the same plaintext (random IV)', () => {
    const k = deriveTenantKey(validMaster, 't');
    const a = encryptValue(k, 'x');
    const b = encryptValue(k, 'x');
    expect(a).not.toBe(b);
  });
  it('ciphertext is base64', () => {
    const k = deriveTenantKey(validMaster, 't');
    const blob = encryptValue(k, 'x');
    expect(blob).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
  it('ciphertext blob is iv (12) + tag (16) + ct (>=1)', () => {
    const k = deriveTenantKey(validMaster, 't');
    const blob = Buffer.from(encryptValue(k, 'x'), 'base64');
    expect(blob.length).toBeGreaterThanOrEqual(12 + 16 + 1);
  });
});

describe('encryptValue — failure modes', () => {
  it('rejects wrong-length tenantKey', () => {
    expect(() => encryptValue(Buffer.alloc(31), 'x')).toThrow(
      SecretProviderError,
    );
  });
});

describe('decryptValue — failure modes', () => {
  const k = deriveTenantKey(validMaster, 't');
  it('rejects wrong-length tenantKey', () => {
    expect(() => decryptValue(Buffer.alloc(31), 'AAAA')).toThrow(
      SecretProviderError,
    );
  });
  it('rejects too-short ciphertext', () => {
    expect(() => decryptValue(k, Buffer.alloc(5).toString('base64'))).toThrow(
      SecretProviderError,
    );
  });
  it('rejects tampered ciphertext (bit flip in body)', () => {
    const blob = Buffer.from(encryptValue(k, 'hunter2'), 'base64');
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 0xff;
    expect(() => decryptValue(k, blob.toString('base64'))).toThrow(
      SecretProviderError,
    );
  });
  it('rejects tampered authTag', () => {
    const blob = Buffer.from(encryptValue(k, 'x'), 'base64');
    blob[IV_BYTES] = blob[IV_BYTES]! ^ 0xff;
    expect(() => decryptValue(k, blob.toString('base64'))).toThrow(
      SecretProviderError,
    );
  });
  it('rejects when decrypted with wrong tenant key', () => {
    const blob = encryptValue(k, 'hunter2');
    const k2 = deriveTenantKey(validMaster, 'other-tenant');
    expect(() => decryptValue(k2, blob)).toThrow(SecretProviderError);
  });
  it('rejects truncated ciphertext', () => {
    const blob = Buffer.from(encryptValue(k, 'hunter2'), 'base64');
    const truncated = blob.subarray(0, blob.length - 5);
    expect(() => decryptValue(k, truncated.toString('base64'))).toThrow(
      SecretProviderError,
    );
  });
});

describe('cross-tenant isolation', () => {
  it('tenant A cannot decrypt tenant B ciphertext', () => {
    const kA = deriveTenantKey(validMaster, 'tenant-a');
    const kB = deriveTenantKey(validMaster, 'tenant-b');
    const blob = encryptValue(kA, 'secret-a');
    expect(() => decryptValue(kB, blob)).toThrow(SecretProviderError);
  });
  it('different masters give different keys per tenant', () => {
    const otherMaster = randomBytes(32);
    const kA1 = deriveTenantKey(validMaster, 'tenant-a');
    const kA2 = deriveTenantKey(otherMaster, 'tenant-a');
    expect(kA1.equals(kA2)).toBe(false);
  });
});
