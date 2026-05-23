/**
 * Crypto primitives for the Postgres adapter.
 *
 * - HKDF-SHA256(masterKey, salt="caia-tenant-v1", info=tenantId, len=32) →
 *   per-tenant 256-bit data key.
 * - AES-256-GCM (12-byte IV, 16-byte authTag) → AEAD per secret value.
 * - Output blob = iv || authTag || ciphertext, base64-encoded.
 *
 * The choice to encode as base64 (not hex, not raw bytea) keeps the
 * Postgres column portable through pg_dump / logical replication / typed
 * downstream consumers; the storage overhead (~33%) is negligible at the
 * tens-of-bytes-per-secret scale.
 *
 * Per the architecture spec §8: master key in env (phase 1) or KMS
 * (phase 2). Derived keys are computed on demand, cached, and never
 * persisted.
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import {
  SecretProviderError,
  SecretsAdapterConfigError,
} from '@caia/secrets-adapter';

export const HKDF_SALT = 'caia-tenant-v1';
export const HKDF_HASH = 'sha256';
export const DATA_KEY_BYTES = 32;
export const AES_ALGO = 'aes-256-gcm' as const;
export const IV_BYTES = 12;
export const AUTH_TAG_BYTES = 16;

/**
 * Parses + validates a hex master key. Throws `SecretsAdapterConfigError`
 * on malformed input — this is an operator misconfiguration, not a
 * runtime failure.
 */
export function parseMasterKeyHex(hex: string): Buffer {
  if (typeof hex !== 'string') {
    throw new SecretsAdapterConfigError(
      'CAIA_SECRETS_MASTER_KEY must be a string',
    );
  }
  const cleaned = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new SecretsAdapterConfigError(
      'CAIA_SECRETS_MASTER_KEY must be hex',
    );
  }
  if (cleaned.length !== 64) {
    throw new SecretsAdapterConfigError(
      `CAIA_SECRETS_MASTER_KEY must be 32 bytes (64 hex chars); got ${cleaned.length} chars`,
    );
  }
  return Buffer.from(cleaned, 'hex');
}

/**
 * Derives a per-tenant data key via HKDF-SHA256.
 *
 * Deterministic: same (masterKey, tenantId) always yields the same key.
 * That's the property the LRU cache exploits.
 */
export function deriveTenantKey(masterKey: Buffer, tenantId: string): Buffer {
  if (masterKey.length !== DATA_KEY_BYTES) {
    throw new SecretsAdapterConfigError(
      `masterKey must be ${DATA_KEY_BYTES} bytes; got ${masterKey.length}`,
    );
  }
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new SecretsAdapterConfigError(
      'tenantId must be a non-empty string',
    );
  }
  const out = hkdfSync(
    HKDF_HASH,
    masterKey,
    Buffer.from(HKDF_SALT, 'utf8'),
    Buffer.from(tenantId, 'utf8'),
    DATA_KEY_BYTES,
  );
  // hkdfSync returns ArrayBuffer in some Node versions; normalise.
  return Buffer.from(out);
}

/**
 * Encrypts a UTF-8 plaintext under `tenantKey`. Returns the base64-encoded
 * blob `iv || authTag || ciphertext`.
 */
export function encryptValue(tenantKey: Buffer, plaintext: string): string {
  if (tenantKey.length !== DATA_KEY_BYTES) {
    throw new SecretProviderError(
      `tenantKey must be ${DATA_KEY_BYTES} bytes; got ${tenantKey.length}`,
    );
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGO, tenantKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new SecretProviderError(
      `unexpected authTag length ${authTag.length}`,
    );
  }
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Inverse of `encryptValue`. Throws `SecretProviderError` if the blob is
 * malformed or the authTag fails verification (tampering, wrong key,
 * truncated row).
 */
export function decryptValue(tenantKey: Buffer, blobB64: string): string {
  if (tenantKey.length !== DATA_KEY_BYTES) {
    throw new SecretProviderError(
      `tenantKey must be ${DATA_KEY_BYTES} bytes; got ${tenantKey.length}`,
    );
  }
  let blob: Buffer;
  try {
    blob = Buffer.from(blobB64, 'base64');
  } catch (err) {
    throw new SecretProviderError('ciphertext is not valid base64', {
      cause: err,
    });
  }
  if (blob.length < IV_BYTES + AUTH_TAG_BYTES + 1) {
    throw new SecretProviderError(
      `ciphertext too short: ${blob.length} bytes`,
    );
  }
  const iv = blob.subarray(0, IV_BYTES);
  const authTag = blob.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(AES_ALGO, tenantKey, iv);
  decipher.setAuthTag(authTag);
  try {
    const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return out.toString('utf8');
  } catch (err) {
    // AES-GCM authentication failure — wrong key, tampered ciphertext,
    // or truncated blob.
    throw new SecretProviderError(
      'AES-GCM authentication failed: ciphertext tampered, truncated, or wrong key',
      { cause: err },
    );
  }
}
