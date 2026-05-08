---
"caia": patch
---

ci(velocity-tier1-004): add `setup-pnpm-mono` composite action; refactor `ci.yml` and `evidence-gate.yml`

Adds `.github/actions/setup-pnpm-mono/action.yml`, a composite action that
consolidates the standard pnpm + node + cache + install pattern repeated
across every CI workflow. Refactors `ci.yml` and `evidence-gate.yml` to
use it (5 redundant install blocks deduplicated).

Adds an extra `actions/cache@v4` layer keyed on `pnpm-lock.yaml` hash so
the pnpm-store + node_modules survive across jobs in the same workflow
run when the lockfile is unchanged. On a cache hit, `pnpm install --offline`
runs in seconds instead of the usual 45-90s.

**Speedup:** 2-4 minutes per Evidence Gate run (5 redundant installs ×
~30s each); ≈1 hour saved across a 25-PR campaign.

**Reliability:** ★ low. Cache miss falls back to fresh install. Composite
action lives in-repo (`./.github/actions/setup-pnpm-mono`) so there is no
external dependency.

Reference: `velocity-acceleration-strategy-2026-05-06.md` §1.2 (Tier 1.2),
§A.3.
