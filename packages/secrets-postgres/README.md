# `@caia/secrets-postgres`

> Phase-1 bootstrap `SecretsAdapter` for CAIA.

Encrypted Postgres column. One table — `caia_meta.tenant_secrets_cold` — with
one row per `(tenantId, category, key)`. Value column holds `iv ||
authTag || ciphertext`, AES-256-GCM. Per-tenant derived key:

```
dataKey_t = HKDF-SHA256(masterKey, salt="caia-tenant-v1", info=tenantId, len=32)
```

The master key lives in `CAIA_SECRETS_MASTER_KEY` (32-byte hex). Phase-2
graduates this to AWS KMS without interface changes.

## What you get

- `PostgresSecretsAdapter` — implements `SecretsAdapter` from `@caia/secrets-adapter`.
- Crypto-shred GDPR-delete: forgetting the tenant's derived key is the
  security barrier; the row delete + tombstone are hygiene.
- AES-256-GCM via Node built-in `crypto` — no external lib.
- Per-tenant LRU cache (1024 entries, 5-minute TTL).
- Audit log: every `get` / `put` writes a row to `caia_meta.audit_log`.

## Quickstart

```ts
import { PostgresSecretsAdapter } from '@caia/secrets-postgres';
import { Pool } from 'pg';

const adapter = new PostgresSecretsAdapter({
  pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  masterKeyHex: process.env.CAIA_SECRETS_MASTER_KEY!, // openssl rand -hex 32
});
```

## Env

| name | required | description |
|---|---|---|
| `CAIA_SECRETS_MASTER_KEY` | yes (phase 1) | 32-byte hex master, rotated annually. Phase-2 from KMS. |
| `DATABASE_URL` | yes | Postgres connection string. |

## Migrations

```
psql $DATABASE_URL < migrations/0001_secrets.sql
psql $DATABASE_URL < migrations/0002_audit_log.sql
```

## Reference

`research/multi_tenant_secrets_architecture_2026.md` §1, §3 (Pattern C), §8.
