# Self-hosted GitHub Actions runner pool

**Audience:** operator + on-call.
**Reference:** `velocity-acceleration-strategy-2026-05-06.md` §4.4, §A.2.

## What this is

A pool of N (ramping 2 → 4 → 8) ephemeral GitHub Actions runners deployed
on stolution as systemd services. Each runner:

- Lives in its own directory (`/home/s903/actions-runner-{N}/`)
- Runs as user `s903` under a dedicated systemd unit
- Uses `--once` mode (single job per `run.sh` invocation)
- Is respawned by systemd on exit, so each job runs in a freshly-cleaned
  working tree
- Carries the labels `self-hosted, stolution, caia, linux`

## Why

Stolution has 72 cores and 251 GB RAM, vastly more than github-hosted
ubuntu-latest. Migrating the long-running CI workflows (`Build · Test ·
Lint · Typecheck`, Evidence Gate's typecheck/bundle-size jobs) to the
self-hosted pool unlocks 5-10× CI throughput.

Existing state at the time this runbook was written: one runner already
registered for the `fix-it-sharded-tests` workflow on stolution. This
runbook expands that into a managed pool.

## Prerequisites

1. **Disk at ≤80%.** Run `scripts/stolution/disk-cleanup.sh --execute --yes`
   first. The pool needs ~10-50 GB transient space per concurrent job.
2. **Runner registration token.** Two ways to obtain it:
   - Via Vault (preferred):
     `vault read -field=token secret/stolution/prod/infrastructure/github_runner_registration_token`
   - Via GitHub UI (one-off): Settings → Actions → Runners → New self-hosted
     runner → copy the token from the displayed `./config.sh` command.
3. **Network egress** from stolution to `api.github.com:443`,
   `pipelines.actions.githubusercontent.com:443`, and
   `objects.githubusercontent.com:443`.
4. **`sudo` for `systemctl`** install (one-off; the runner itself does not
   require sudo at runtime).

## Install

From the developer Mac:

```bash
# Dry-run first to see what will happen
ssh stolution 'bash -s' < scripts/stolution/install-runner-pool.sh

# Once satisfied, ramp 2 runners
ssh stolution "GITHUB_RUNNER_TOKEN=… bash -s -- --execute --count 2" \
  < scripts/stolution/install-runner-pool.sh

# After 24h soak, expand to 4
ssh stolution "GITHUB_RUNNER_TOKEN=… bash -s -- --execute --count 4" \
  < scripts/stolution/install-runner-pool.sh

# After 48h soak, expand to 8
ssh stolution "GITHUB_RUNNER_TOKEN=… bash -s -- --execute --count 8" \
  < scripts/stolution/install-runner-pool.sh
```

The install is idempotent. Re-running with a higher `--count` adds more
runners; existing runners are not touched.

## Verify

After install:

```bash
ssh stolution 'systemctl list-units "actions.runner.caia-*.service" --no-pager'
```

Expected: each unit shows `active (running)`. In GitHub UI, navigate to
Settings → Actions → Runners. Each runner appears as `caia-stolution-{N}`
with labels `self-hosted, stolution, caia, linux` and status "Idle".

The `runner-pool-health.yml` workflow (added in this PR) pings the pool
every 15 minutes and asserts disk + memory health.

## Migrate workflows

**Not done in this PR.** Workflow migration is a separate follow-up that
lands once the pool has soaked for 48 hours and `runner-pool-health.yml`
shows zero failures.

When ready, change individual workflow's `runs-on:` from `ubuntu-latest`
to `[self-hosted, stolution, caia, linux]`.

Recommended migration order (largest CI savings first):

1. `ci.yml` — Build · Test · Lint · Typecheck (5-7 min critical path)
2. `evidence-gate.yml`'s `typecheck`, `bundle-size` jobs
3. `pipeline-regression.yml`'s `pipeline-e2e`, `agents-regression` jobs
4. `promptfoo-eval.yml`

Keep on `ubuntu-latest`:

- `gitflow-conformance.yml` — sub-second; no benefit
- `secrets-scan.yml` — security; isolation preferred
- `mcp-vendored-verify.yml` — SHA-pinned drift checker; ubuntu-latest is fine
- `release.yml` or any publish workflow — keep clean GitHub-hosted box

## Runtime characteristics

- **Throughput:** 8 runners × 3-5 min average job = ~96 jobs/hour
- **vs ubuntu-latest queue:** 10-15 jobs/hour today
- **Speedup:** 7-10× CI throughput
- **Cost:** $0 incremental (operator's hardware) + ~$38/mo GitHub platform fee
  per the March-2026 pricing change

## Failure modes

| Scenario | Behaviour | Mitigation |
| --- | --- | --- |
| One runner crashes mid-job | systemd respawns; GitHub re-queues | none needed (designed) |
| All runners stalled | New jobs queue indefinitely | manual: re-point critical workflows to `ubuntu-latest` |
| Stolution disk fills | Runner jobs fail at checkout | `runner-pool-health.yml` detects at 85%; alarm at 90% |
| Stolution down | All self-hosted-tagged jobs queue | re-point to `ubuntu-latest` (manual or via Steward Gatekeeper proposed PR) |
| Token rotation | Runners de-register | re-run `install-runner-pool.sh` with fresh token |

## Token rotation

Runner registration tokens have a short TTL (1 hour). The `.runner` file
written during `config.sh` contains a long-lived runner credential, so the
registration token is only needed at install time.

For ongoing rotation (pool expansion, recovery from de-registration),
fetch a fresh token from Vault each time. The Steward Gatekeeper has a
weekly rotation policy (`stolution-rotate`) that refreshes the Vault entry.

## See also

- `docs/runner-runbook.md` — operator dashboard / health checks / common ops
- `scripts/stolution/disk-cleanup.sh` — Tier 0 prerequisite
- `velocity-acceleration-strategy-2026-05-06.md` — full strategy
