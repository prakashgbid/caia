# Browserless on stolution — operator runbook (FIX-007)

Companion to `reports/testing-framework-architecture-2026-04-28.md`.

## Stack

```
Fix-It Test Agent (CI runner)
   |  ws://browserless.stolution.local:13080/playwright/chromium?token=...
   v
nginx 127.0.0.1:13080 (loopback only, WS upgrade, 180s read timeout)
   |  proxy_pass
   v
Docker `stolution-browserless`
   image  ghcr.io/browserless/chromium:v2.40.0
   bind   127.0.0.1:13000 -> container :3000
   env    CONCURRENT=30, QUEUED=20, TIMEOUT=120000
```

> **Connection URL:** Browserless v2 exposes Playwright at
> `/playwright/chromium` (NOT the bare host root). v1 docs that show
> `ws://host:port?token=...` will time out on v2.

## Quick reference

| Action | Command |
|---|---|
| Deploy | `./infra/browserless/scripts/deploy-browserless.sh` |
| Health check | `ssh stolution 'bash -s' < ./infra/browserless/healthcheck.sh` |
| End-to-end smoke | `ssh stolution 'bash -s' < ./infra/browserless/scripts/smoke-test.sh` |
| Tail logs | `ssh stolution 'docker logs -f stolution-browserless'` |
| Stop | `ssh stolution 'cd ~/stolution && docker compose -f docker-compose.browserless.yml down'` |

## Connecting from Playwright

```ts
import { chromium } from 'playwright';

const ws =
  (process.env.BROWSERLESS_WS_ENDPOINT
    ?? 'ws://browserless.stolution.local:13080/playwright/chromium')
  + '?token=' + process.env.BROWSERLESS_TOKEN;

const browser = await chromium.connect(ws, { timeout: 15_000 });
```

The trailing `/playwright/chromium` segment is required for v2; without
it the WS upgrade succeeds but the protocol handshake times out at 15s.

## Sizing

- `CONCURRENT=30` — Phase B doc, ~3 GB/session × 30 = 90 GB
- `QUEUED=20` — absorbs CI bursts beyond the concurrency cap
- `TIMEOUT=120000` ms — hard cap per session
- `shm_size=2g` — prevents Chromium OOM on heavy pages
- mem limit 96 GB / cpu limit 24 vCPU on a 256 GB / 32-core box

Grow when `browserless_sessions_active >= 28` sustained 5m. Bump
`CONCURRENT` in steps of 10 and re-measure.

## Initial deployment

1. Verify Vault healthy:
   `ssh stolution 'docker exec stolution-vault vault status'`

2. From a workstation with SSH access:
   `./infra/browserless/scripts/deploy-browserless.sh` (syncs compose,
   mints token if missing in Vault, renders `~/stolution/.env.browserless`,
   `docker compose pull && up -d`, runs healthcheck)

3. Install nginx site (one-time, root):
   - Copy `infra/browserless/nginx.conf` to
     `/etc/nginx/sites-available/browserless.conf`
   - Symlink into `sites-enabled/`
   - `nginx -t && systemctl reload nginx`

4. Append `infra/browserless/prometheus-scrape.yaml` into
   `~/stolution/config/prometheus/prometheus.yml`, then HUP prometheus.

## Token rotation

Stored at `secret/stolution/prod/browserless`. Rotate by writing a new
value with `vault kv put` then re-running the deploy script.
In-flight CI shards retry through the FIX-012 aggregator.

## Browserless v1 → v2 env-name diff

| v1 (deprecated) | v2 |
|---|---|
| `MAX_CONCURRENT_SESSIONS` | `CONCURRENT` |
| `CONNECTION_TIMEOUT` | (folded into `TIMEOUT`) |
| `ENABLE_API_GET` | `ALLOW_GET` |
| `KEEP_ALIVE` | (removed; sessions always fresh) |
| `DEFAULT_LAUNCH_ARGS` | (removed; launch args on client) |

CI's `infra/browserless/tests/compose-smoke.test.sh` fails the build if
a v1 name slips back in.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `browserType.connect: Timeout` after 15s | URL missing `/playwright/chromium` | Use the full v2 path |
| `Bad or missing authentication` on `/pressure` | Token not passed | Append `?token=$BROWSERLESS_TOKEN` |
| `chrome process crashed` repeatedly | shm too small | Bump `shm_size` to 4g, `up -d` |
| 429 Too Many Requests | Queue full | Reduce shards or raise `QUEUED` |
| `unhealthy` looping | Image SHA drift | Re-pin, redeploy |
| nginx 504 | timeout < session length | Raise compose `TIMEOUT` + nginx `proxy_read_timeout` together |
| `/var/lib/docker` bloat | Leaked `/tmp` profiles on crash | `docker exec stolution-browserless rm -rf /tmp/playwright-* /tmp/.org.chromium.*` |
| Prometheus scrape failures | Allowlist | `docker network inspect stolution-network`, update nginx `allow` |

## Why 13000 not 3001?

3001 is held by `stolution-grafana`. 13000 matches the Phase B doc and
is unallocated. Documented so future operators don't try to "fix" it.

## Why pin to v2.40.0?

`:latest` floats. Browserless ships breaking changes between minor
versions (the v1→v2 env-name changes are the most recent example).
Pin to a verified release tag and rotate via the deploy script after
smoke-testing on the local Playwright workers (FIX-010).

## Capacity plan

- v1 today: 30 concurrent
- v2: 50 (sustained >=28 active sessions for >5m repeatedly)
- v3: 100 (second host on a CCM container)

## Verified at deploy time (2026-04-29)

| Check | Value observed |
|---|---|
| Image | `ghcr.io/browserless/chromium:v2.40.0` |
| Image digest | sha256:6891566b8f3e6e512e493ecdf95d44e5a4efbfb1b5eb7da04135e5a48170bc72 |
| Pressure endpoint | `200 OK`, `maxConcurrent=30`, `maxQueued=20` |
| Single Playwright connect | OK in <1s, screenshot 8 KB |
| 5 concurrent sessions | OK in 511 ms |
| 10 concurrent sessions | OK in 614 ms |

## Related

FIX-008 SQLite isolation; FIX-009 ports; FIX-010 local Playwright;
FIX-011 Fix-It mode selection; FIX-012 sharded CI; FIX-013 dashboard.
