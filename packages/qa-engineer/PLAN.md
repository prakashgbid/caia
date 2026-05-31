# Plan: @caia/qa-engineer — production verifier (`deployed -> verified`)

**Plan type:** implementation
**Caller agent:** `@caia/qa-engineer` (this package)
**Submitted by:** autonomous-build
**Affected components:** `@caia/qa-engineer`, `@caia/state-machine`, `@caia/outcome-steward`, `@chiefaia/playwright-config`

## Goal

Validate that a deployed ticket is **actually working in production** before the canonical pipeline can mark it `verified` (and ultimately `done`). Drives Playwright e2e specs against the live production URL post-deploy, then hands off to `@caia/outcome-steward` for SLI confirmation. On failure, emits a transport-agnostic rollback-recommendation payload that the orchestrator can act on.

This package fills the previously-unowned `deployed -> verified` slot, which is the operator's "actively producing intended results in production" gate (Real-DoD). Pre-deploy Playwright (`per-story-tested -> e2e-tested`) remains owned by `@caia/per-story-tester` + `@caia/principal-engineer` — that slot is separate; this package is post-deploy only.

## State-machine integration

The canonical FSM (`@caia/state-machine/src/transitions.ts`) defines:

```
deployed:      ['verified', 'verify-failed', 'paused', 'archived']
verified:      ['done', 'archived']
verify-failed: ['deployed', 'paused', 'archived']  // recover-or-abandon
```

This package drives exactly two edges:

- `deployed -> verified`     (Playwright green AND outcome-steward green/declined)
- `deployed -> verify-failed` (any required Playwright fail OR red SLI cell)

No new states are added; the FSM invariant (every edge enumerated in `transitions.ts`) is preserved.

## API

```ts
import { validateInProduction, type ValidateInProductionConfig } from '@caia/qa-engineer';

const result = await validateInProduction(
  {
    ticketId,
    projectId,
    productionUrl: 'https://app.example.com',
    packageName: '@caia/some-package',
    solutionId,
    packageRoot,
  },
  config,
);
// → ValidateInProductionResult: { status, playwright, outcomeSteward?,
//     rollbackRecommendation?, transition? }
```

Pure orchestration: resolve specs → spawn Playwright → on pass cross-check SLIs → decide verdict → build rollback payload (if failed) → drive FSM transition. Returns a structured verdict; never throws on test failure (failures are returned as `status: 'failed'` with a rollback recommendation).

## Files

- `src/types.ts` — full type surface (target, plan, result, config, FSM constants).
- `src/test-strategy.ts` — `createDefaultSpecStrategy` + `rewriteBaseUrl` + `buildPlaywrightEnv`. Two modes: env-passthrough (inject `PLAYWRIGHT_BASE_URL`) or out-of-tree rewrite (copy + literal-localhost → production swap). FS adapter injected; True-Zero preserved.
- `src/agent.ts` — `createSpawnPlaywrightAdapter` (production) + `createStubPlaywrightAdapter` (tests) + `parsePlaywrightJson` (normalises Playwright 1.59 reporter=json schema) + `buildRunPlan` + `countRequiredFailures`.
- `src/outcome-steward-adapter.ts` — `createDefaultOutcomeStewardAdapter` wired against `@caia/outcome-steward` public exports (`crossCheck`, `buildAttestationMatrix`, `classifyCell`, `loadPackageExpectation`, `joinManifestAndExpectations`). Backend (Prometheus/Grafana/Mock/Null) is injected by the caller.
- `src/api.ts` — `validateInProduction(target, config)` orchestrates the pipeline + drives the FSM. `decideVerdict`, `buildRollbackRecommendation`, `decideSeverity` are pure and unit-tested.
- `src/index.ts` — public surface re-exports.
- `tests/` — vitest suite ≥30 tests covering: type-surface guards, spec resolution (env-passthrough + rewrite), URL rewriting + idempotence, Playwright JSON parser (passed/failed/timedOut/skipped/flaky/required-vs-optional), required-failure counting, verdict decision matrix (all 5 outcome-steward verdicts × Playwright states), severity classification (urgent/recommended/wait), rollback step construction, state-machine driver (success/InvalidTransitionError/ProjectNotFoundError/getProject-throws/project-not-found), env builder, and a single integration test (`tests/integration.test.ts`) gated by `CAIA_QA_ENGINEER_LIVE=1` that hits a real production-style URL (default `https://example.com`).
- `scripts/submit-plan.mjs` — submits this PLAN.md to `@caia/ea-architect.submitPlan` (stub critic when `CAIA_EA_STUB=1`).

## Reuse

- `@chiefaia/playwright-config` — `definePlaywrightConfig({ baseURL })` factory; `createBrowserlessPool` for shard scale-out. Mode auto-detected from `BROWSERLESS_WS_ENDPOINT`.
- `@caia/state-machine` — `StateMachine`, `ProjectState`, `InvalidTransitionError`, `ProjectNotFoundError`. Same shape as `@caia/per-story-tester`.
- `@caia/outcome-steward` — `crossCheck`, `buildAttestationMatrix`, `classifyCell`, `joinManifestAndExpectations`, `loadPackageExpectation`. Public exports only; this package never reaches into internals.

## Non-goals

- No pre-deploy Playwright (owned by `@caia/per-story-tester`).
- No deploy execution (`@caia/devops-runtime`).
- No SLI declaration storage (`@caia/outcome-steward` owns `expectedSli`).
- No git/PR mutations; rollback steps are transport-agnostic strings.
- No new FSM states.

## Risk register check

- **No PR-platform coupling**: rollback recommendation is structured; orchestrator translates it into GitHub/Gitea/Slack/etc.
- **No real-network in unit tests**: every adapter (Playwright, outcome-steward, FS) is injected; the default suite is True-Zero. The single live test is opt-in via `CAIA_QA_ENGINEER_LIVE=1` and uses `https://example.com` (or `$CAIA_QA_ENGINEER_LIVE_URL`).
- **Idempotent transitions**: state-machine `transition()` is idempotent within the configurable window; safe to retry on flake.
- **Deterministic clock + IDs**: `validateInProduction` accepts an optional `clock`; defaults to `() => new Date()`.
- **Graceful degradation under missing metrics**: per outcome-steward §4.3, `no-metric-declared` and `no-metric-store` map to `passed` (we never block on infra we don't own); `red` ⇒ failed; `yellow`/`mixed` policy: red>0 fails, else passes with a yellow note.

## Outcome-steward integration (PR #571)

`@caia/outcome-steward` is on `feat/outcome-steward-2026-05-25` (PR #571, unmerged at plan-submission time). We code against its public exports from the source tree:

- `crossCheck(backend, packageName, solutionId, sli, opts)` — per-(package, solution, sli) metric verification.
- `buildAttestationMatrix(results, opts)` — group cross-check rows into a matrix of typed cells.
- `classifyCell(crossCheckResult, opts)` — green/yellow/red/no-metric-* classification.
- `joinManifestAndExpectations(manifest, expectations[])` — pair manifest entries with declared SLIs.
- `loadPackageExpectation(packageRoot)` — load `caia.outcome.expectedSli` from `package.json` or sibling `outcome.yaml`.
- Types: `AttestationCell`, `AttestationMatrix`, `BackendState`, `MetricBackendRef`, `CrossCheckResult`.

We do NOT call `run()` (the hourly orchestrator) — that scans every package; we narrow to the one we just deployed.

## Quality gates

- `pnpm -F @caia/qa-engineer build` clean.
- `pnpm -F @caia/qa-engineer typecheck` clean (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess).
- `pnpm -F @caia/qa-engineer test` green — vitest suite ≥30 tests, coverage ≥80% lines per testing.coverageThresholds.
- True-Zero on caia preserved (default suite hits no real network).
- Optional integration test (`CAIA_QA_ENGINEER_LIVE=1`) green against `https://example.com`.

## Approval request

Approve to proceed with implementation as specified. Subscription-only; True-Zero admin-merge per the carve-out at `AGENTS.md#L109-L134` on the `feature/true-zero-carve-out-2026-05-25` branch (the `.caia/build-phase-active` marker must be present at merge time per the carve-out's gate).
