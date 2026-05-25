# @caia/qa-engineer

Production verifier. Drives Playwright e2e specs against the live production URL post-deploy, then hands off to `@caia/outcome-steward` for SLI confirmation. Sits between `deployed` and `verified` in the canonical state-machine pipeline.

## Canonical FSM slot

```
… → coding-in-progress → code-complete → per-story-tested → e2e-tested →
    deploying → deployed → verified → done
                       ▲
                       └── this package validates here
```

`deployed → verified` (pass) | `deployed → verify-failed` (fail, with rollback recommendation payload).

The pre-deploy `per-story-tested → e2e-tested` Playwright slot is owned by `@caia/per-story-tester` against ticket-local URLs and `@caia/principal-engineer` for the dispatching glue. This package is post-deploy only.

## API

```ts
import { validateInProduction, type ValidateInProductionConfig } from '@caia/qa-engineer';

const result = await validateInProduction(ticketId, productionUrl, config);
// → {
//     ticketId,
//     productionUrl,
//     status: 'passed' | 'failed',
//     playwright: { … },
//     outcomeSteward: { matrix, summary } | undefined,
//     rollbackRecommendation?: { reason, severity, steps },
//     transition?: { fromState, toState, applied, … },
//   }
```

`validateInProduction` runs Playwright against the production URL via a `PlaywrightAdapter` (real default; tests inject a stub), and on pass calls `crossCheck` from `@caia/outcome-steward` to confirm the deployed package's declared SLIs are green. On any required failure or red SLI it produces a rollback-recommendation payload (transport-agnostic; the orchestrator decides how to act on it).

## Reuse

- `@chiefaia/playwright-config` — `definePlaywrightConfig({ baseURL: productionUrl })` factory; `createBrowserlessPool` for shard scale-out.
- `@caia/state-machine` — `StateMachine`, `ProjectState`, `InvalidTransitionError`. Transitions are atomic and idempotent.
- `@caia/outcome-steward` — `crossCheck`, `classifyCell`, `loadPackageExpectation`, `joinManifestAndExpectations`. Public exports only; this package is a consumer.

## Non-goals

- No pre-deploy or per-story testing (those are `@caia/per-story-tester`).
- No deploy execution (`@caia/devops-runtime`).
- No SLI declarations or storage (`@caia/outcome-steward`).
- No git/PR mutations.

## True-Zero

Unit tests inject all adapters; no real network. The single live-network test under `tests/integration.test.ts` is opt-in via `CAIA_QA_ENGINEER_LIVE=1` and is excluded from the default suite. CI keeps the True-Zero invariant.
