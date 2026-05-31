# ADR-067 — Snapshotter keeps row-level tenant_id (V1); schema-level convergence deferred

> Canonical source: `caia-ea/decisions/ADR-067-snapshotter-row-level-tenant-id-canonical-for-v1.md`.
> This file is a mirror inside the `caia` monorepo so the decision is
> greppable next to the code it constrains.

- **Status:** Accepted
- **Date:** 2026-05-31
- **Decision-makers:** Operator (directive: "decide for me, optimize for what reduces drift") | EA Architect Agent (stub critic recorded on the C4 PR; live submitPlan deferred per #635 precedent)
- **Supersedes:** none
- **Superseded-by:** none
- **Affected-components:** `@chiefaia/design-ingest` (snapshotter), `@caia/wizard-tenant-bootstrap`, `apps/wizard`, `apps/dashboard`, `tenant_usage_meter` (lands in C3)
- **Reversibility:** Reversible (a future ADR can ratify a migration to schema-level when tenant count justifies the destructive move)
- **Operator-sign-off-required:** yes — already given as part of the C4 brief

## Context

CAIA's per-tenant data layer ships two persistence patterns in parallel:

1. **Schema-level** — every tenant gets its own Postgres schema. The wizard
   (`apps/wizard`), dashboard, and the per-tenant migration orchestrator
   (`@caia/wizard-tenant-bootstrap`, PR #615) all use this shape. Tenant
   isolation is enforced by `SET search_path` at connection-time; no row
   carries a `tenant_id` column because the schema *is* the partition.

2. **Row-level** — the design-ingest snapshotter (`@chiefaia/design-ingest`)
   writes every captured frame to a shared schema and tags every row with a
   `tenant_id` column. Queries filter by `tenant_id` at runtime.

This drift is an artifact of Phase A: the snapshotter was built before
`@caia/wizard-tenant-bootstrap` made per-tenant schemas the default. The
question is whether to converge the snapshotter onto the schema-level
pattern (consistency win, destructive data migration cost) or keep
row-level for V1 (small consistency tax, no migration risk).

Operator directive is "decide for me, optimize for what reduces drift."
The cleanest read of "reduces drift" for V1 is: **the smallest change
that keeps the system runnable and lets V1 ship**, then revisit when the
multi-tenant load makes the choice obvious.

## Decision

**We will keep the snapshotter on row-level tenant_id through V1.** No
migration is shipped in C4. The per-tenant schema pattern remains the
default for every NEW persistence surface; the snapshotter is the
explicit, dated exception, documented here.

A migration to schema-level will be reconsidered when **either** of the
following triggers fire:

- snapshotter table row count exceeds 10M (operational pain on indexes /
  vacuums); **or**
- tenant count exceeds 25 (cross-tenant blast-radius risk on the shared
  table outweighs the migration cost).

When triggered, the migration is owned by a future ADR-XXX that ships
the `pg_dump --schema-only`-driven per-tenant schema move + the
application-side `search_path` switch.

## Consequences

- **Positive:**
  - No destructive data migration in V1. The snapshotter keeps working
    unchanged.
  - Drift is now *intentional* and *dated* — every future dev who reads
    this ADR knows the snapshotter is the one row-level surface, why,
    and what triggers a revisit.
  - C3 (billing/usage meter, lands separately) can adopt either pattern
    independently — the operator-meter table is logically per-tenant
    aggregation, schema-level is the cleaner default.

- **Negative / cost:**
  - Every snapshotter query carries a `WHERE tenant_id = $1` predicate
    the rest of the data layer does not — a small but persistent
    cognitive tax on snapshotter-adjacent code review.
  - The drift is a known-known: if a future dev forgets the
    `tenant_id` predicate, a cross-tenant data leak is one missing
    `WHERE` away. The mitigation lives in the snapshotter's repository
    layer — every read enforces tenant_id at the function-signature
    level (no raw SQL escape hatch).

- **Neutral / follow-on work:**
  - Add a semgrep rule that requires every snapshotter SQL to include
    a `tenant_id` predicate. (Tracked separately; not in C4.)
  - Add a periodic operator-dashboard widget that surfaces snapshotter
    row count + tenant count vs. the migration triggers above.

## Alternatives considered

- **Ship the schema-level migration in C4** — rejected. Migrating a
  multi-tenant table to per-tenant schemas is a destructive,
  high-risk-of-rollback operation. No production tenants exist today
  at scale, but several internal smoke tenants do; an unbounded
  migration window is the wrong shape for "ship in Batch 1."
- **Hybrid — schema-level for NEW snapshotter writes, row-level for
  reads of historical data** — rejected. Doubles the snapshotter's
  query surface for the duration of any incomplete migration; the
  consistency cost is worse than either pure pattern.

## References

- Operator brief: Phase C / C4 (2026-05-31)
- ADR-016 (eight-layer isolation contract) — establishes tenant-isolation
  as a first-class principle; this ADR is a V1 carve-out scoped to
  one surface.
- PR #615 (`@caia/wizard-tenant-bootstrap`) — the per-tenant migration
  orchestrator that made schema-level the dominant pattern.
- PR #607 (`@caia/billing`) — separate question; C3 will pick a pattern
  for `tenant_usage_meter` independently of this ADR.
- Stub EA critic verdict: `caia/EA-REVIEW-OUTCOME.json` on the C4 PR.
