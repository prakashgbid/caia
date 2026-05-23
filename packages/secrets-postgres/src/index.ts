/**
 * `@caia/secrets-postgres` — public surface.
 *
 * Reference: research/multi_tenant_secrets_architecture_2026.md §1, §3
 * (Pattern C), §8.
 */

export { PostgresSecretsAdapter, BACKEND_NAME } from './adapter.js';
export type { PostgresSecretsAdapterOptions } from './adapter.js';

export {
  encryptValue,
  decryptValue,
  deriveTenantKey,
  parseMasterKeyHex,
  HKDF_SALT,
  HKDF_HASH,
  DATA_KEY_BYTES,
  AES_ALGO,
  IV_BYTES,
  AUTH_TAG_BYTES,
} from './crypto.js';

export { TenantKeyCache } from './key-cache.js';
export type { KeyCacheOptions } from './key-cache.js';

export {
  PostgresAuditLogger,
  NoopAuditLogger,
  type AuditLogger,
  type AuditWriteParams,
} from './audit.js';

export type { PoolLike, PoolClientLike, QueryResultLike } from './pg-types.js';
