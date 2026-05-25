# Plan: @caia/per-story-tester — Stage 14 of the canonical pipeline

**Plan type:** implementation
**Caller agent:** `@caia/per-story-tester` (this package)
**Submitted by:** Stolution
**Affected components:** `@caia/per-story-tester`, `@caia/state-machine`, `@chiefaia/playwright-config`, `@chiefaia/test-kit`, `@chiefaia/ticket-template`

## Goal

Build the per-story tester package: runs the test cases (vitest + Playwright + axe + Lighthouse) defined by the Test Author Agent against the code emitted by the Full-Stack Engineer for each story. Stage 14 in the canonical state-machine pipeline.

## State-machine integration

The canonical pipeline (`@caia/state-machine`) defines the following transitions around code-complete:

- `coding-in-progress` → `code-complete` (FSE emits PR; current Stage 13)
- `code-complete` → `per-story-tested` (this package; tests pass)
- `code-complete` → `per-story-test-failed` (this package; tests fail; PR gets review comment)
- `per-story-test-failed` → `coding-in-progress` (FSE patch loop) | `archived`

The brief's `pr-opened → per-story-tested | tests-failed` is the conceptual trigger (FSE opens PR after Stage 13 emits `code-complete`), with `tests-failed` mapping to the canonical `per-story-test-failed`. No new states are added; this preserves the FSM invariant (every edge enumerated in `transitions.ts`).

## API

```ts
import { runStoryTests, RunStoryTestsConfig, TestResults } from '@caia/per-story-tester';

const results = await runStoryTests(ticketId, config);
// → { ticketId, status: 'passed' | 'failed', layers, perCase, summary, durationsMs, transition }
```

The function:
1. Loads the ticket (typed via `@chiefaia/ticket-template`'s `TicketTemplateV1`) — `testCases[]`, repo location, test paths.
2. Routes each test case by `layer` to the appropriate runner:
   - `unit` / `integration` → vitest (per-case file paths from `agentSections.testing.unitTestPaths` + `integrationTestPaths`)
   - `e2e` → Playwright via `@chiefaia/playwright-config`'s factory
   - `accessibility` → axe (via `@axe-core/playwright` inside the Playwright run)
   - `visual` / `performance` (with `category` ∈ `{performance, visual}`) → Lighthouse CI when the runner is wired, otherwise tracked as `skipped` with reason.
3. Parses each runner's JSON output via `result-parser.ts` into `TestCaseResult[]` with `{caseId, file, line?, testName, status, durationMs, errorMessage?, errorStack?, runner}`.
4. Drives the state-machine transition via `@caia/state-machine` (`StateMachine#transition`): on all-pass → `per-story-tested`; on any-failure → `per-story-test-failed` plus a PR review comment payload returned for the orchestrator.

## Files

- `src/runner.ts` — pure execution layer. Takes a `RunPlan` (list of per-layer plans) and a `RunAdapter` (defaults to spawning real runners; tests inject stubs). Spawns child processes via `node:child_process.spawn` with deterministic env (`CI=1`, `NODE_ENV=test`). Each runner writes JSON to a temp file the parser reads.
- `src/result-parser.ts` — pure parsers: `parseVitestJson`, `parsePlaywrightJson`, `parseAxeViolations`, `parseLighthouseReport`. Each returns normalised `TestCaseResult[]` with `file + line + testName`. Vitest JSON is the canonical `vitest --reporter=json` schema; Playwright is `reporter=json`; axe via `AxeBuilder().analyze()`; Lighthouse `lhr.audits` mapped to perf thresholds from `testing.perfRegressionBudgets`.
- `src/api.ts` — `runStoryTests(ticketId, config)` orchestrates: load ticket → split testCases by layer → call runner → call parser → aggregate to `TestResults` → drive state-machine transition. Returns the typed result.
- `src/types.ts` — `TestResults`, `TestCaseResult`, `LayerSummary`, `RunStoryTestsConfig`, `RunAdapter`, `StateTransitionResult`.
- `src/index.ts` — public surface re-exports.
- `tests/` — vitest tests covering parser invariants, runner-adapter contract, api end-to-end with a stub runner + in-memory state store.

## Reuse

- `@chiefaia/playwright-config` — `definePlaywrightConfig()` for Playwright runs; `createBrowserlessPool()` if remote browsers are configured.
- `@chiefaia/test-kit` — `createTestLogger`, `createTestEventBus` for tests.
- `@caia/state-machine` — `StateMachine`, `InMemoryStateStore`, `canTransition`, error types.
- `@chiefaia/ticket-template` — `TicketTemplateV1Schema`, `TestCase`, `TestCaseLayer`, `TestCaseCategory`.

## Non-goals

- No new pipeline states.
- No code generation (Test Author owns that).
- No PR commenting transport (returns the comment payload; orchestrator posts it).
- No Lighthouse on every layer — only when the case category is `performance`.

## Risk register check

- **No PR-platform coupling**: package is platform-agnostic; the orchestrator translates `TestResults.prComment` into a GitHub/Gitea/etc. call. Aligns with P-no-vendor-lockin.
- **No real-network in tests**: every runner spawn is stubbable via `RunAdapter`. CI keeps to the True-Zero invariant.
- **Deterministic clock + IDs**: `runStoryTests` accepts an optional `clock` for time-based fields; defaults to `() => new Date()`.
- **Idempotent transitions**: state-machine `transition()` is idempotent within the configurable window; safe to retry on flake.

## Quality gates

- `pnpm -F @caia/per-story-tester build` clean
- `pnpm -F @caia/per-story-tester typecheck` clean (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess)
- `pnpm -F @caia/per-story-tester test` green — coverage ≥80% lines per `testing.coverageThresholds` global floor.
- True-Zero on caia preserved.

## Approval request

Approve to proceed with implementation as specified.
