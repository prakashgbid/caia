-- @caia/secrets-postgres — Phase-1 bootstrap storage.
--
-- One row per (tenantId, category, key). The value column holds
--   iv (12 bytes) || authTag (16 bytes) || ciphertext
-- AES-256-GCM, with a per-tenant derived key:
--   dataKey_t = HKDF-SHA256(masterKey, salt="caia-tenant-v1", info=tenantId, len=32)
--
-- The Postgres ciphertext column is useless by itself: it requires the
-- master key (env CAIA_SECRETS_MASTER_KEY in phase 1; AWS KMS in phase 2)
-- and the derivation above to be reversed.

CREATE SCHEMA IF NOT EXISTS caia_meta;

CREATE TABLE IF NOT EXISTS caia_meta.tenant_secrets_cold (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  category          TEXT NOT NULL,
  key               TEXT NOT NULL,
  ciphertext_b64    TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at  TIMESTAMPTZ,
  last_rotated_at   TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  UNIQUE (tenant_id, category, key)
);

CREATE INDEX IF NOT EXISTS tenant_secrets_cold_tenant_idx
  ON caia_meta.tenant_secrets_cold (tenant_id);

CREATE INDEX IF NOT EXISTS tenant_secrets_cold_tenant_category_idx
  ON caia_meta.tenant_secrets_cold (tenant_id, category);

CREATE TABLE IF NOT EXISTS caia_meta.tenant_crypto_shred (
  tenant_id         TEXT PRIMARY KEY,
  shredded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tombstone_ref     TEXT NOT NULL
);
