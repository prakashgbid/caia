# Secrets Broker

`@plugins/secrets-broker` is the single authoritative source for all non-public secrets across the pokerzeno framework. It replaces ad-hoc `.env.production` scatter with a centralized, audited, TTL-cached broker backed by the stolution vault.

## Rule (Non-Negotiable)

> No secret value may live in `.env.production`, `.env.local`, or any git-tracked file.
> Every access is audited. Rotation is a one-command operation.

## Architecture

```
Deploy script / edge worker
        │
        │  Bearer token
        ▼
┌──────────────────────────────┐
│  Broker HTTP :7788           │  ← localhost only; Cloudflare Access tunnel in prod
│  - Auth: BROKER_TOKEN        │
│  - Rate limit: 60 req/min    │
│  - Audit log (last 100)      │
│  - TTL cache (in-process)    │
└──────────────┬───────────────┘
               │
               │ SSH / HTTP
               ▼
        stolution vault
        ~/.vault/*.env   ← SshFileVaultAdapter (current)
        HCP Vault        ← HashiCorpVaultAdapter (future)
```

## Quick Start

### Fetch a secret in a deploy script

```bash
# Fetch all secrets for a site, export to environment
eval $(secrets fetch-env poker-zeno)
# Now $CLOUDFLARE_API_TOKEN, $SUPABASE_SERVICE_ROLE_KEY, etc. are available

# Then deploy
pnpm build && wrangler pages deploy
```

### Fetch a single secret

```bash
secrets fetch CLOUDFLARE_API_TOKEN --site poker-zeno
```

### TypeScript client

```typescript
import { fetchSecret, fetchBatch, loadManifest } from '@plugins/secrets-broker';
import manifest from '../manifests/poker-zeno.json';

loadManifest(manifest);

const token = await fetchSecret('CLOUDFLARE_API_TOKEN', {
  siteSlug: 'poker-zeno',
  callerModule: 'deploy-script',
});
// token.value = 'cf-...'
// token.cached, token.fetch_latency_ms, token.expires_at available
```

## Manifest Format

Each site has a manifest at `plugins/secrets-broker/manifests/<site>.json`:

```json
{
  "site_slug": "poker-zeno",
  "secrets": {
    "NEXT_PUBLIC_GA4_MEASUREMENT_ID": {
      "path": "kv/ga4/pokerzeno",
      "public": true,
      "ttl_sec": 3600
    },
    "CLOUDFLARE_API_TOKEN": {
      "path": "kv/cloudflare/pokerzeno",
      "public": false,
      "ttl_sec": 300
    }
  }
}
```

- `path` maps to the vault file: `kv/ga4/pokerzeno` → `~/.vault/ga4-pokerzeno.env`
- `public: true` means safe to log/expose in browser bundle (e.g. `NEXT_PUBLIC_*`)
- `ttl_sec` is the per-secret cache TTL; default is 300s

## Vault Layout (SSH file adapter)

```
stolution:/home/s903/.vault/
├── ga4-pokerzeno.env         GA4_MEASUREMENT_ID=G-XXXXXXXXXX
├── cloudflare-pokerzeno.env  CLOUDFLARE_API_TOKEN=...
├── supabase-pokerzeno.env    SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_KEY=...
├── github-deploy.env         GITHUB_DEPLOY_PAT=...
└── ...
```

Each file: `KEY=value` lines, `chmod 600`.

## CLI Reference

```bash
# Fetch single secret
secrets fetch <key> [--site <slug>] [--caller <module>]

# Fetch all secrets for a site (KEY=value lines, eval-safe)
secrets fetch-env <site>

# List key names for a site (never prints values)
secrets list [--site <slug>]

# Rotate a secret (writes to vault, invalidates cache, flags re-deploy)
secrets rotate <key> --site <slug> --value <new-value>
# Or pipe: echo "new-value" | secrets rotate <key> --site <slug>

# Show audit log
secrets audit [--limit 100]
```

## HTTP API (:7788)

All endpoints except `/health` and `/` require `Authorization: Bearer <BROKER_TOKEN>`.

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | HTML dashboard (auth-free) |
| `/health` | GET | `{"status":"ok"}` |
| `/secrets/:key?site=<slug>&caller=<module>` | GET | Fetch one secret |
| `/env/:site` | GET | Fetch all secrets as `KEY=value` text |
| `/audit` | GET | Last 100 audit entries (no values) |

## Cloudflare Pages Integration

Copy `src/cf-worker.ts` to `<site>/functions/api/_internal/secrets/[key].ts`.

Set in Pages environment (encrypted):
- `BROKER_TOKEN` — same token as the broker server
- `BROKER_URL` — `https://broker.internal` (via Cloudflare Access tunnel)

Usage in server-side Pages code:
```typescript
const res = await fetch(`/api/_internal/secrets/SUPABASE_SERVICE_ROLE_KEY?site=poker-zeno`);
const { value } = await res.json();
```

## Rotation

```bash
# Rotate a secret (broker writes new value to vault)
secrets rotate CLOUDFLARE_API_TOKEN --site poker-zeno --value "new-cf-token"
# ✅ Rotated CLOUDFLARE_API_TOKEN for site poker-zeno. Re-deploy required.
```

Rotation:
1. Writes new value to vault via vault adapter
2. Evicts that key from the in-process cache
3. Emits `secret.rotation_triggered` + `secret.rotated` events
4. Does NOT automatically trigger a re-deploy (manual step)

## Audit Log

Every fetch emits a structured Pino log line (no secret values):
```json
{"level":"info","time":"...","module":"secrets-broker","secret_key_hash":"a1b2c3d4e5f60001","caller_module":"deploy-script","site_slug":"poker-zeno","ttl_sec":300,"fetch_latency_ms":42}
```

The in-process audit log (last 100 entries) is queryable via `secrets audit` or `GET /audit`.

## Threat Model

| Threat | Mitigation |
|---|---|
| Secret value in logs | Pino redaction on `value` field; key is hashed in audit |
| Unauthorized API access | Bearer token + rate limiting |
| Secret in git | Pre-commit `.gitignore` enforcement; migration scanner flags history |
| Vault compromise | Secrets are rotatable in one command; audit trail shows blast radius |
| Network interception | Server binds to `127.0.0.1` only; Cloudflare Access for tunnel |

## Migration

Run the scanner to find any `.env.production` files still on disk:

```bash
cd plugins/secrets-broker
npx ts-node scripts/migrate-secrets-to-broker.ts --repos-dir ../..
```

It will:
- List all non-public secrets still in env files
- Flag any committed secrets in git history as `BL-SECRETS-COMMITTED-<sha>.md`
- File `BL-GA4-MIGRATE-TO-BROKER.md` if GA4 vars are found

## Completeness Gate

The completeness sentinel checks: **every site's deploy script must fetch from the broker, not from `.env.production`.**

Gate passes when:
1. No `.env.production` files contain non-`NEXT_PUBLIC_*` values
2. Deploy scripts call `eval $(secrets fetch-env <site>)` before build
3. `.env.production` and `.env.local` are in `.gitignore`
