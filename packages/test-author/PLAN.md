# PLAN — `@caia/test-author` (Stage 10)

**Branch:** `feature/test-author-2026-05-25`
**Authored:** 2026-05-25
**Plan type:** implementation
**Pipeline stage:** 10 (canonical pipeline; reads EA-approved ticket, emits per-story test cases, hands off to Stage 11 Test Reviewer)
**Subscription posture:** True-Zero / Claude Max — all LLM calls via `@chiefaia/claude-spawner` (no API-key billing).

## Scope

Implement the **Test Author** subagent: a stateless service that takes one EA-approved ticket (`status = 'ea-complete'`, composed `tickets.architecture` JSONB populated by the 17 specialist architects) and emits a typed `ticket.testCases` array plus `ticket.testDesign` metadata.

The emitted test cases are Gherkin-flavoured (`given` / `when` / `then`) and carry the right `category` (happy | edge | error | accessibility | security | performance | visual) and `layer` (unit | integration | e2e | visual | accessibility) so that the downstream Test Runner (`@caia/per-story-tester`, Stage 14) can deterministically translate them to vitest (unit/integration), Playwright (e2e/visual), axe (accessibility), and Lighthouse (performance) source — *without* the Test Author needing to write runner source itself. Performance cases embed the Lighthouse thresholds extracted from `architecture.testing.perfRegressionBudgets` (set by Testing Architect, PR #565) so the runner has a single source of truth.

The `TestCase` shape is the canonical `.strict()` Zod definition exported by `@chiefaia/ticket-template` (already shipped). The Test Author does **not** modify that schema; it produces values that satisfy it. This keeps the contract small and Stage 11 (Test Reviewer) compatible.

## Out of scope

* No changes to `@chiefaia/ticket-template` (the existing schema is already sufficient).
* No changes to the state machine (canonical transitions are already in place: `ea-complete → tests-authored` happy; `tests-authored → tests-authoring-failed` failure chain).
* No new database tables (writes to existing `tickets.testCases` and `tickets.testDesign` JSONB columns via a `TicketStore` adapter).
* No live LLM calls in CI (a deterministic fake spawner is wired for `vitest`; the live spawner runs only when an operator invokes the package outside the test suite).

## Distinctness

This is **NOT** an architect. It does not register with `@caia/architect-kit`'s `ArchitectRegistry` and does not own any `architecture.*` JSONB slice. It writes to `tickets.testCases` + `tickets.testDesign`, both *outside* `tickets.architecture`.

Sibling-clear:
* `@caia/testing-architect` (PR #565, architect #16) — sets the `testing.*` STRATEGY (pyramid mix, fixtures, mutation thresholds, perf budgets). Does NOT write test cases.
* `@caia/test-author` (this PR, Stage 10) — writes the `ticket.testCases` CASES. Consumes the Testing Architect's strategy verbatim plus the Frontend / Backend / Database architects' outputs.
* `@caia/test-reviewer` (PR #573, Stage 11) — audits `ticket.testCases` against `architecture.testing.*`. Cannot write to `testCases`.

## Package layout

```
packages/test-author/
├── package.json             # @caia/test-author@0.1.0 (private workspace)
├── tsconfig.json            # extends ../../configs/tsconfig/base.json (strict + exactOptionalPropertyTypes)
├── tsconfig.build.json      # build config (dist/)
├── vitest.config.ts         # node env, globals, v8 coverage
├── eslint.config.cjs        # standard caia preset (no-explicit-any: error)
├── PLAN.md                  # this file
├── README.md                # usage + how it fits in the pipeline
├── scripts/
│   └── submit-plan.mjs      # submits PLAN.md to @caia/ea-architect.submitPlan() (stub-capable via CAIA_EA_STUB=1)
├── src/
│   ├── index.ts             # public surface
│   ├── types.ts             # AuthorInput, AuthorOutput, TicketStore, AuthorOptions
│   ├── contract.ts          # AUTHOR_AGENT_ID, AUTHOR_PRE_STATE, AUTHOR_PASS_STATE, AUTHOR_FAIL_STATE + SectionContract for testCases
│   ├── system-prompt.ts     # buildTestAuthorSystemPrompt()
│   ├── spawner.ts           # ArchitectSpawnerFn shape, createDefaultSpawner (mirrors testing-architect)
│   ├── validation.ts        # JSON-envelope + TestCase[] schema validation
│   ├── agent.ts             # TestAuthorAgent class + design(input): Promise<AuthorOutput>
│   ├── persistence.ts       # writeTestCases() + state-machine transition emission
│   └── api.ts               # authorTests(ticketId) orchestrator entrypoint
└── tests/
    ├── helpers/fakes.ts     # buildFakeInput(), fakeGoldenSpawner(), in-memory stores
    ├── golden/
    │   ├── input-ticket.json
    │   ├── input-architecture.json
    │   └── golden.test.ts   # asserts deterministic output against prakash-tiwari ticket-pt-test-001
    ├── agent.test.ts
    ├── contract.test.ts
    ├── validation.test.ts
    ├── system-prompt.test.ts
    ├── spawner.test.ts
    ├── persistence.test.ts
    └── api.test.ts          # state-machine chain emission on pass + fail
```

### State-machine integration

* **AUTHOR\_AGENT\_ID** = `'test-author'`
* **AUTHOR\_PRE\_STATE** = `'ea-complete'`
* **AUTHOR\_PASS\_STATE** = `'tests-authored'`
* **AUTHOR\_FAIL\_INTERMEDIATE\_STATE** = `'tests-authored'` (the canonical FSM requires routing through tests-authored to reach tests-authoring-failed)
* **AUTHOR\_FAIL\_STATE** = `'tests-authoring-failed'`

Pass path: one transition (`ea-complete → tests-authored`).
Fail path: two transitions (`ea-complete → tests-authored` with `intermediate: true`, then `tests-authored → tests-authoring-failed`). Mirrors `@caia/test-reviewer`'s chain pattern verbatim.

### DI seams (testability)

* `ArchitectSpawnerFn` — same shape as testing-architect; tests inject `fakeSpawnerReturning(...)` to get deterministic responses without live Claude.
* `TicketStore` — `loadTicket(id)` + `writeTestCases(id, payload)`. Tests pass an in-memory map.
* `StateMachineAdapter` — `transition({...})`. Tests pass an in-memory recorder.

## Heuristics encoded in the system prompt

* **Pyramid balance**: split case counts by `architecture.testing.testTypeMixPercentages` keyed by ticket type. Reject 100% unit / 0% e2e.
* **AC coverage floor**: every `ticket.acceptance_criteria[i]` must be referenced by at least one TestCase via `linkedAcceptanceCriterionIndex`.
* **Edge floor**: at least `max(1, ceil(totalCases / 10))` cases with `category: 'edge'`.
* **Error floor**: at least one `category: 'error'` per error envelope in `architecture.backend.errorEnvelope.mapping` (covers each documented failure mode).
* **A11y gate**: if `architecture.a11y.wcagLevel` is `AA` or stricter, ≥1 case with `category: 'accessibility'` and `layer: 'accessibility'`.
* **Perf gate**: if `architecture.testing.perfRegressionBudgets` is set, ≥1 case with `category: 'performance'` whose `then` embeds the Lighthouse delta + LCP/CLS/TBT thresholds.
* **Determinism**: every selectorHint is a stable test-id / role selector (no nth-child, no auto-generated class names).
* **Bounds**: total cases capped at `MAX_TEST_CASES = 50` (the ticket-template hard cap); soft floor of 3.

## Tests (≥30 vitest + 1 golden)

Targeted breakdown:
* `agent.test.ts` — ≥10: spawn-ok happy path; spawn-failed; validation-failed; AC coverage; pyramid invariant; idempotency on re-run; reviewer-feedback re-run; budget exhausted; tenant subscription pass-through; tool-call counting.
* `contract.test.ts` — ≥5: ID constants stable; pre/pass/fail states match canonical FSM; SectionContract paths disjoint with all 17 architects.
* `validation.test.ts` — ≥6: JSON-fence stripping; missing top-level keys; bad confidence; oversize testCases; bad category; missing required field.
* `system-prompt.test.ts` — ≥4: contains each consumed `architecture.testing.*` key; mentions every `TestCaseCategory`; lists the Lighthouse threshold names; refuses to author outside the canonical FSM pre-state.
* `spawner.test.ts` — ≥2: `modelTagFor` mapping; default-spawner wraps `@chiefaia/claude-spawner`.
* `persistence.test.ts` — ≥3: writeTestCases writes correct columns; idempotent on re-run; rejects writes for tickets not in pre-state.
* `api.test.ts` — ≥3: pass emits one transition; fail emits the canonical two-transition chain; ticket-not-found raises typed error.
* `golden/golden.test.ts` — exactly 1 (counts toward ≥30): deterministic output for prakash-tiwari `ticket-pt-test-001` Contact form Story.

Total budget: ≥34 tests, comfortably above the ≥30 floor. Golden test reuses the same ticket fixture as testing-architect (`tests/golden/input-ticket.json` is copied verbatim) so it exercises the same EA-approved canonical input across packages.

## Build + CI

* `pnpm --filter @caia/test-author build` → `dist/` with declarations + maps.
* `pnpm --filter @caia/test-author typecheck` → tsc --noEmit (no errors).
* `pnpm --filter @caia/test-author test` → vitest run, all green.
* `pnpm --filter @caia/test-author lint` → eslint clean.
* Turbo picks the package up automatically (no `turbo.json` changes needed; the package is workspace-scoped).

## Definition of Done

1. Branch `feature/test-author-2026-05-25` pushed to `origin`.
2. PR opened against `develop`.
3. CI passes (typecheck + build + test + lint).
4. Admin-merged to `develop` (True-Zero ratified per operator).
5. Post-merge: package importable as `@caia/test-author` from sibling packages.

## Risks

* `exactOptionalPropertyTypes` makes optional-field-passthrough finicky; mitigated by typing fakes carefully and using conditional spread for optionals.
* TestCase Zod schema is `.strict()` — any extra key from the LLM fails validation; the validation layer drops unknown keys before construction.
* If `architecture.testing.*` is missing (Testing Architect ran in `partial` mode), the agent falls back to the contract's `DEFAULT_STORY_MIX` constants instead of refusing — keeps the pipeline moving with an advisory note.

## EA review

Submitted via `pnpm --filter @caia/test-author ea:submit-plan` with `affectedComponents` listing `@caia/test-author`, `@caia/state-machine`, `@chiefaia/ticket-template`, `@chiefaia/claude-spawner`, `@chiefaia/playwright-config`, `@chiefaia/test-kit`, `@caia/architect-kit`, `@caia/testing-architect`, `@caia/test-reviewer`. Outcome persisted to `packages/test-author/EA-REVIEW-OUTCOME.json`.
