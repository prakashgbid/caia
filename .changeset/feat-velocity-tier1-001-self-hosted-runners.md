---
"caia": patch
---

ops(velocity-tier1-001): self-hosted Actions runner-pool infra + health workflow + runbooks

Adds the infrastructure and operator documentation for the Tier 1.1
self-hosted GitHub Actions runner pool on stolution. **No workflow
migration in this PR** — existing workflows continue on `ubuntu-latest`.
The actual migration (changing `runs-on:` from `ubuntu-latest` to
`[self-hosted, stolution, caia, linux]`) lands in a follow-up PR after
the pool has soaked for 48 hours.

What lands here:

- `infra/stolution/systemd/actions.runner.caia.service.template` —
  systemd unit template (rendered per-runner with `__N__` substitution).
  Ephemeral semantics (`run.sh --once` + systemd respawn), resource caps
  (CPUQuota=400%, MemoryLimit=16G), hardening (`ProtectSystem=full`,
  `NoNewPrivileges=true`, `PrivateTmp=true`).
- `scripts/stolution/install-runner-pool.sh` — install + register N
  runners against the `prakashgbid` GitHub org with labels
  `self-hosted, stolution, caia, linux`. Idempotent. Disk pre-flight
  refuses if usage > 85%. Dry-run by default.
- `.github/workflows/runner-pool-health.yml` — every 15 min, pings the
  pool and asserts disk ≤90% + memory + docker reachability. Failure at
  >90% disk; warning at >85%.
- `docs/self-hosted-runners.md` — install runbook, capacity plan,
  migration order, failure modes.
- `docs/runner-runbook.md` — operator dashboard, common ops (restart,
  drain, deregister), alarm response.

**Speedup (when pool is migrated):** 5-10× CI throughput. 8 runners ×
3-5 min average = ~96 jobs/hour vs the ubuntu-latest queue's ~10-15
jobs/hour today.

**Cost:** $0 incremental (operator hardware) + ~$38/mo GitHub platform
fee per the March-2026 pricing change.

**Reliability:** ★ low. Each runner is ephemeral (clean working tree per
job), respawned by systemd. `ubuntu-latest` remains the fallback; if the
pool fails, individual workflows can be re-pointed back via a one-line
edit. The `runner-pool-health.yml` workflow flags 3+ consecutive failures
to Steward Gatekeeper for automatic fallback-PR proposal.

**Prerequisites for execution:**

1. Tier 0 disk cleanup complete (PR `velocity-tier0-001`)
2. stolution sshd reachable (currently down as of 2026-05-06)
3. Runner registration token in Vault at
   `secret/stolution/prod/infrastructure/github_runner_registration_token`

Reference: `velocity-acceleration-strategy-2026-05-06.md` §4.4, §A.2.
