# Plan: `@caia/principal-po` — thin facade re-export package

**Plan type:** implementation (facade)
**Caller agent:** `@caia/principal-po`
**Submitted by:** Stolution (operator) via Cowork mode
**Date:** 2026-05-25
**Affected components:** `@caia/principal-po` (new), `@caia/principal-engineer` (PR #577 — re-exported), `@chiefaia/decomposer-recursive` (re-exported), `@caia/architect-kit` (re-exported)

## Goal

Ship a thin facade re-export package named `@caia/principal-po` so that consumers can write `import { decomposeStoryHierarchy, scheduleStoryGraph } from '@caia/principal-po'` and stay aligned with the canonical-pipeline doc (`agent-memory/project_caia_canonical_pipeline_2026-05-22.md`), which names a single "Principal PO" role at Step 6 — a role that on disk is split across three packages.

Operator decision (2026-05-25): keep memory's name; ship a thin facade.

## Scope

**In scope (this PR):**

- `packages/principal-po/package.json` — `@caia/principal-po`, workspace deps on `@caia/principal-engineer`, `@chiefaia/decomposer-recursive`, `@caia/architect-kit`. `main`/`types`/`module` point at `src/index.ts` directly (same shape as `@caia/architect-kit` and `@chiefaia/decomposer-recursive`).
- `packages/principal-po/src/index.ts` — ≤30 LOC of re-exports + a thin functional wrapper:
  - `decomposeStoryHierarchy(opts)` — wrapper over `new PORecursiveDecomposer().decomposeRoot(opts)`
  - `PORecursiveDecomposer` — direct re-export
  - `scheduleStoryGraph` — `export { schedule as scheduleStoryGraph } from '@caia/principal-engineer'`
  - `ArchitectRegistry`, `BaseArchitect`, `computeWaves`, `computeWavesFromMeta` — direct re-exports
  - Common types — direct re-exports
- `packages/principal-po/README.md` — facade rationale + underlying-package map + naming-drift note for the `@chiefaia/decomposer-recursive` scope.
- `packages/principal-po/tsconfig.json` — strict + `noEmit` (same shape as `@caia/architect-kit`).
- `packages/principal-po/vitest.config.ts` — resolves the three workspace deps directly to their `src/` entries via `resolve.alias` so tests don't depend on a built `dist/` from principal-engineer.
- `packages/principal-po/tests/index.test.ts` — ≥10 smoke tests asserting the re-exports resolve and underlying value/class identity matches.
- `packages/principal-po/scripts/submit-plan.mjs` — `ea:submit-plan` entry point (mirrors per-story-tester + principal-engineer pattern).

**Out of scope (explicitly deferred):**

- Any new logic. The facade is a thin proxy — no new state, no orchestration, no validation. Functional behaviour lives in the three subordinate packages.
- Renaming `@chiefaia/decomposer-recursive` to `@caia/decomposer-recursive` — the same naming-drift caveat applies as the `@chiefaia/adoption-enforcement` case (ADR-064). Defer to a successor ADR / migration.
- Absorbing the three subordinate packages. They remain independently owned, independently tested, independently versioned.
- A separate `dist/` build for the facade. Source-direct resolution (`main: src/index.ts`) matches `@caia/architect-kit` precedent and avoids a redundant tsc pass.

## Mirror

- `@caia/architect-kit` — same shape facade: `main: src/index.ts`, `noEmit` typecheck, no `dist`.
- `@chiefaia/decomposer-recursive` — same source-direct resolution.
- `@caia/per-story-tester/scripts/submit-plan.mjs` — `ea:submit-plan` script pattern.

## Tests (≥10)

`tests/index.test.ts` — 11 smoke tests covering:

1. `scheduleStoryGraph` is callable and identity-equals `principal-engineer.schedule`.
2. `decomposeStoryHierarchy` is a 1-arg function (the wrapper signature).
3. `PORecursiveDecomposer` class identity matches `@chiefaia/decomposer-recursive`'s export.
4. `ArchitectRegistry` class identity matches `@caia/architect-kit`.
5. `BaseArchitect` class identity matches `@caia/architect-kit`.
6. `computeWaves` function identity matches `@caia/architect-kit`.
7. `computeWavesFromMeta` function identity matches `@caia/architect-kit`.
8. `decomposeStoryHierarchy` is NOT the same reference as the underlying `decomposeRoot` method (it is a wrapper).
9. Snapshot of every advertised named export.
10. Allowlist invariant — facade does NOT leak anything outside the documented surface.
11. Facade module is importable without side effects.
12. Underlying-package identity is preserved (facade does not mutate source).

(11 / 12 covered — meets the ≥10 floor.)

No functional duplication of subordinate packages' tests.

## EA submit-plan flow

`pnpm --filter @caia/principal-po ea:submit-plan` runs `scripts/submit-plan.mjs` which:

1. Reads `PLAN.md` (this file).
2. Imports `@caia/ea-architect`.
3. Calls `submitPlan({ planMarkdown, planType: 'implementation', callerAgentId: '@caia/principal-po', submittedBy: 'autonomous-build', affectedComponents: [...] })`.
4. Falls back to a deterministic stub critic when `CAIA_EA_STUB=1` (mirrors per-story-tester + principal-engineer pattern) so an autonomous run can record the submission outcome without live spawner credentials.
5. Writes the outcome to `EA-REVIEW-OUTCOME.json`.

## Reuse

- `@caia/principal-engineer` — `schedule`, plus types.
- `@chiefaia/decomposer-recursive` — `PORecursiveDecomposer`, plus types.
- `@caia/architect-kit` — `ArchitectRegistry`, `BaseArchitect`, `computeWaves`, `computeWavesFromMeta`, plus types.

No fork; no copy-paste; no shim that reimplements behaviour.

## Non-goals

- No new architectural layer.
- No new state.
- No `dist/` build pass for the facade.
- No new ADR — this PR is the implementation of the operator's 2026-05-25 decision; the broader naming-drift conversation is captured in ADR-064 (filed in `caia-ea` the same day).

## Risk register

- **`@chiefaia/decomposer-recursive` naming-drift.** Same drift as `@chiefaia/adoption-enforcement` recorded in ADR-064. The facade cites the drift in README.md; resolution deferred to a successor ADR.
- **Tests fail if a subordinate package's named export goes missing.** That's the intent — the smoke tests act as a tripwire on the re-export surface.
- **No real `dist/` so other packages depending on this facade need source-direct resolution.** Same posture as `@caia/architect-kit`; the 17-architect packages already cope.

## Quality gates

- `pnpm install` clean (workspace deps resolve).
- `pnpm --filter @caia/principal-po typecheck` clean (strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`).
- `pnpm --filter @caia/principal-po test` green — ≥10 smoke tests passing.
- True-Zero invariant preserved (facade has no source-of-truth duplication).
- Subscription-only invariant preserved.

## Reversibility

Fully reversible. The facade is a thin proxy with no state and no consumers yet. Deletion of `packages/principal-po/` returns the workspace to its current state.

## Approval request

Approve to land the facade as specified. Mirrors `@caia/architect-kit` shape; reuses the `@caia/per-story-tester` and `@caia/principal-engineer` `ea:submit-plan` script pattern. Admin-merge per the True-Zero carve-out tag `[True-Zero admin-merge]`.
