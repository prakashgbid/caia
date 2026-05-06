---
"caia": patch
---

ci(velocity-tier1-002): paths-ignore + dorny/paths-filter on `ci.yml` and `evidence-gate.yml`

Adds a `detect-changes` job at the top of both workflows using
`dorny/paths-filter@v3` with negation patterns. Every downstream job
gates on `needs.detect-changes.outputs.code == 'true'`, which evaluates
to false when a PR touches only `**/*.md`, `**/*.mdx`, `docs/**`,
`agent/memory/**`, `AGENTS.md`, `CHANGELOG.md`, or `.changeset/**`.

GitHub treats `if:`-skipped jobs as successful for required-status-check
purposes, so branch protection is preserved.

**Speedup:** ~5 minutes saved per doc-only PR (8 jobs × ubuntu-latest
ramp + pnpm install). Across the 25-PR campaign baseline (where ~30-40%
of PRs are documentation-cluster), this is a 30-40% reduction in
average CI wall-time.

**Reliability:** ★ low. The check name `detect-changes` is a NEW job,
not a renamed required check, so existing branch-protection rules are
unaffected. If `dorny/paths-filter@v3` is ever unavailable, the
`detect-changes` job fails and downstream jobs are skipped — fail-safe
to "no merge" rather than "merge without validation".

Reference: `velocity-acceleration-strategy-2026-05-06.md` §1.2 (Tier 1.3),
§A.4.
