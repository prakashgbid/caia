---
name: secrets-management-rule
description: Enforced rule for all secret handling across pokerzeno sites — broker is the single source, no env files, every access audited
type: feedback
---

## Rule: Secrets Management via Broker

No secret value may live in `.env.production`, `.env.local`, or any git-tracked file.
The `@plugins/secrets-broker` is the single source of truth for all non-public secrets.

**Why:** Ad-hoc env file scatter was discovered across multiple site repos. Any committed secret is a permanent leak (git history). Rotation is impossible without finding every copy.

**How to apply:**
- When writing a deploy script: use `eval $(secrets fetch-env <site>)` — never read `.env.production`
- When adding a new secret: add it to `manifests/<site>.json`, write value to vault via `secrets rotate`, never write to a file
- When a secret appears in `.env.production` for any non-`NEXT_PUBLIC_*` key: flag it and file a migration blocker
- Rotation is a one-command operation: `secrets rotate <key> --site <slug> --value <new>`
- Every access is audited — `secret_key_hash` + `caller_module` + `timestamp` logged via Pino, never the value
- GA4 Measurement IDs are `public: true` — they ship in page HTML, broker handles them for consistency but does NOT redact in logs
- Vault path convention: `kv/<category>/<site>` → `stolution:/home/s903/.vault/<category>-<site>.env`

## Package Location

`plugins/secrets-broker/` in the pokerzeno framework monorepo.

## Smoke Test Results (2026-04-21)

- SshFileVaultAdapter: PASS, 158ms first-fetch latency from stolution vault
- HTTP server: PASS, /health, /dashboard, /secrets/:key (auth + 401 verified)
- 77 unit tests, 100% coverage on all 4 logic modules

## Key Files

- `src/client.ts` — `fetchSecret`, `fetchBatch`, `fetchEnv`, `rotateSecret`
- `src/vault-adapter.ts` — `SshFileVaultAdapter` (active), `HashiCorpVaultAdapter` (future)
- `src/server.ts` — HTTP :7788 broker with auth, rate-limit, dashboard
- `src/cli.ts` — `secrets` CLI (fetch, fetch-env, list, rotate, audit)
- `src/cf-worker.ts` — Cloudflare Pages Function proxy
- `manifests/*.json` — per-site secret manifests
- `scripts/migrate-secrets-to-broker.ts` — scanner + blocker filer
- `framework/secrets-broker.md` — full usage guide
- `com.stolution.secrets-broker.plist` — launchd service definition
