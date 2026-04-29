# Test Isolation Runbook (FIX-013)

> Phase B testing infrastructure operator guide. Companion to
> `reports/testing-framework-architecture-2026-04-28.md` (the design
> doc) and `infra/browserless/README.md` (the Browserless deployment
> runbook).

## What this document covers

How to operate the parallel-safe testing infrastructure that ships with
FIX-007 through FIX-012:

| Layer | What | Where to look |
|---|---|---|
| Browser farm | Self-hosted Browserless on stolution | `infra/browserless/` (FIX-007) |
| Per-test SQLite | Throwaway DB per test | `packages/test-isolation/sqlite` (FIX-008) |
| Per-test ports | Hash-based port allocator | `packages/test-isolation/ports` (FIX-009) |
| Local Playwright | 3-5 worker headless Chromium | `packages/playwright-config` (FIX-010) |
| Browserless pool | Connection reuse + retry | `packages/playwright-config/pool` (FIX-011) |
| Sharded CI | Self-hosted GH Actions matrix | `.github/workflows/fix-it-sharded-tests.yml` (FIX-012) |
| Observability | Live dashboard panel | `/test-isolation` page (FIX-013, this PR) |

## The full picture

```
┌────────────────────────────────────────────────────────────┐
│ Developer M1 Pro (16 GB)                                   │
│ ├─ pnpm test                                               │
│ │   ├─ vitest workers                                      │
│ │   │   ├─ each test: createTestDb() → /tmp/caia-test-*    │
│ │   │   └─ each test: allocateTestPort() → 30000-34999     │
│ │   └─ playwright workers (3 default; 5 on 32 GB)          │
│ │       └─ headless Chromium pinned 1.58.2                 │
│ └─ orchestrator + dashboard (per-test isolated)            │
└────────────────────────────────────────────────────────────┘
                       ↓ git push
┌────────────────────────────────────────────────────────────┐
│ GitHub Actions                                              │
│ ├─ Job: prepare      (github-hosted; emits shard matrix)   │
│ ├─ Job: shard 1..N   (self-hosted on stolution)            │
│ │   ├─ pnpm install --frozen-lockfile                      │
│ │   ├─ pnpm exec playwright test --shard=i/N --reporter=blob │
│ │   └─ env: BROWSERLESS_WS_ENDPOINT=ws://127.0.0.1:13000/...│
│ │          BROWSERLESS_TOKEN=${{ secrets.BROWSERLESS_TOKEN }} │
│ └─ Job: merge        (downloads blobs, emits HTML + JSON)   │
└────────────────────────────────────────────────────────────┘
                       ↓ shard worker
┌────────────────────────────────────────────────────────────┐
│ Stolution remote (32 cores, 256 GB, Docker)                │
│ ├─ stolution-browserless (30 concurrent sessions)          │
│ │   image ghcr.io/browserless/chromium:v2.40.0             │
│ │   bound 127.0.0.1:13000 → container :3000                │
│ ├─ self-hosted GH Actions runner (singleton today)         │
│ │   matrix-spawned shards talk to Browserless over docker0 │
│ └─ Vault (BROWSERLESS_TOKEN at secret/stolution/prod/browserless) │
└────────────────────────────────────────────────────────────┘
```

## The four guarantees

The infrastructure provides four invariants that, taken together,
eliminate the entire class of "passes locally, fails in CI" bugs:

1. **Each test gets its own DB.** No cross-test data leakage; no
   shared schema drift; failed migrations fail the test, not
   subsequent tests.
2. **Each test gets its own port range.** Hash-derived starting
   offset + forward probe + EADDRINUSE recovery — no parallel
   collisions.
3. **Each test gets its own browser context.** `KEEP_ALIVE=false` on
   Browserless, fresh `browser.newContext()` per spec; no
   cookie/storage carryover.
4. **Each test gets the same Chromium build everywhere.** Local pin
   1.58.2; Browserless image ships 1.58.2; mismatch fails CI rather
   than silently producing different results.

## Operational surface

### Health checks (in order of utility)

| What | Command | When to use |
|---|---|---|
| Dashboard panel | Open `https://<dashboard>/test-isolation` | First stop for any "tests are slow / flaky" report |
| Browserless pressure | `ssh stolution 'curl -s http://127.0.0.1:13000/pressure?token=$(grep BROWSERLESS_TOKEN ~/stolution/.env.browserless \| cut -d= -f2)'` | Confirms farm is up, not saturated |
| Browserless logs | `ssh stolution 'docker logs --tail 100 stolution-browserless'` | Crashes, OOMs, version mismatches |
| Self-hosted runner | `ssh stolution 'systemctl --user status actions.runner.*'` | Job stuck in "queued" |
| Stale SQLite files | `ssh stolution 'find /tmp -name "caia-test-*.sqlite" -mmin +60 \| wc -l'` | A killed runner left junk |
| GH Actions logs | `gh run list --workflow fix-it-sharded-tests.yml -L 5` | "Why did this PR fail?" |

### Common scenarios

**Tests are flaky on CI but pass locally.**

1. Check the dashboard `/test-isolation` panel. Is Browserless `running` near `maxConcurrent`? You're queueing.
   - Short-term: rerun the failed shard.
   - Long-term: raise `CONCURRENT` in the Browserless compose file (FIX-007 runbook has the procedure).
2. Check `playwright-html-report` for the failed test's trace. Look for `Target page, context or browser has been closed` — that's a transient remote crash. The pool retries once; if it's still failing you may have an actual bug.
3. Check the version pin: local Playwright + remote Browserless must match minor version.

**A shard's job is stuck.**

1. `gh run view <run-id>` to see which shard.
2. `ssh stolution 'docker ps'` — confirm the runner container is alive (or systemd if not containerised).
3. If the runner is dead, restart it:
   ```bash
   ssh stolution
   cd ~/actions-runner
   ./svc.sh stop
   ./svc.sh start
   ```
4. Re-trigger the failed run via the GH UI; the matrix will re-fan out.

**Disk pressure on stolution.**

```bash
ssh stolution
# Stale test DBs left by killed runners.
find /tmp -name 'caia-test-*.sqlite*' -mmin +60 -delete
# Browserless leaks /tmp profiles on container crashes.
docker exec stolution-browserless rm -rf /tmp/playwright-* /tmp/.org.chromium.*
# Docker logs (50m × 5 ⇒ 250m max per container, but be safe):
docker system prune -f
```

The dashboard `/test-isolation` panel calls these out in real time —
look for the `Stale (>1h)` stat under "Per-test SQLite files".

**Browserless reports `isAvailable: false`.**

The pressure endpoint sets this when the farm is at saturation
(`running >= maxConcurrent` and `queued >= maxQueued`). The Fix-It
runner backs off and retries via the FIX-011 pool's transient-error
classifier.

If `isAvailable=false` persists for >10 minutes:
- Check `docker logs --tail 500 stolution-browserless` for OOMs.
- Bump `shm_size` in `infra/browserless/docker-compose.yml` to 4 GB.
- Restart: `cd ~/stolution && docker compose -f docker-compose.browserless.yml up -d`.

**Token rotation.**

```bash
ssh stolution
ROLE_ID=$(grep ^ROLE_ID= ~/.stolution-vault/claude-orchestrator-approle.env | cut -d= -f2 | tr -d '[:space:]')
SECRET_ID=$(grep ^SECRET_ID= ~/.stolution-vault/claude-orchestrator-approle.env | cut -d= -f2 | tr -d '[:space:]')
ADMIN=$(cat ~/.stolution-vault/vault-admin-token.txt)
NEW=$(openssl rand -hex 32)
docker exec -e VAULT_TOKEN="$ADMIN" stolution-vault \
  vault kv put secret/stolution/prod/browserless token="$NEW"
exit
# From workstation:
cd ~/Documents/projects/caia
./infra/browserless/scripts/deploy-browserless.sh
gh secret set BROWSERLESS_TOKEN --body "$NEW"
```

In-flight CI runs retry through the FIX-012 shard aggregator.

## The dashboard panel

`/test-isolation` (this PR) shows:

- **Browserless** (FIX-007): active sessions / max, queue depth, CPU,
  memory. Warns red at 90% utilisation.
- **Per-test SQLite files** (FIX-008): total count, stale count,
  total bytes, recent file table.
- **Last shard run** (FIX-012): pass/fail/skip/flaky counts from
  `shard-summary.json`. Populates when the dashboard is run with
  `SHARD_SUMMARY_PATH=…/shard-summary.json`.

Refreshes every 5 s while the tab is visible (Page Visibility API
pauses on hidden tabs to save backend load).

## Configuration env

| Var | Read by | Purpose |
|---|---|---|
| `BROWSERLESS_WS_ENDPOINT` | `@chiefaia/playwright-config` | Flips the config factory + pool to remote mode |
| `BROWSERLESS_TOKEN` | playwright-config, dashboard, healthchecks | Auth |
| `BROWSERLESS_HTTP_ENDPOINT` | dashboard `/api/test-isolation` | HTTP base for the pressure call (defaults to loopback) |
| `PLAYWRIGHT_LOCAL_WORKERS` | playwright-config | Override the default 3 workers locally |
| `PLAYWRIGHT_SKIP_BROWSER_INSTALL` | playwright-config postinstall | Skip the postinstall download |
| `CHIEFAIA_SKIP_PLAYWRIGHT_INSTALL` | playwright-config postinstall | Same; CI-friendly name |
| `SHARD_SUMMARY_PATH` | dashboard `/api/test-isolation` | Where to read FIX-012's per-run aggregate |
| `SHARD_INDEX`, `SHARD_TOTAL` | FIX-012 shard env | Wiring for `--shard X/Y` |

## Related work

- **TEST-101..104** (Phase B Test Runner Agent specs) — to be picked up
  when worker pool capacity arrives. Will consume FIX-007..013 as the
  execution substrate.
- **FIX-001..006** (Fix-It Test Agent itself, parallel track) — the
  consumer for all of this. Once both tracks land, the agent uses the
  infrastructure automatically.
