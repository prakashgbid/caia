# Changelog — `@caia-app/worker-fix-it`

## Unreleased

### FIX-002 — test code generator (this PR)

- New `src/test-code-generator.ts`:
  - `TemplateTestCodeGenerator` (real implementation of the
    `TestCodeGenerator` port; replaces `StubTestCodeGenerator`).
  - Layer dispatch: `unit` → vitest, `integration` → vitest with
    setup hooks, `e2e` → Playwright, `visual` → Playwright
    `toHaveScreenshot()`, `accessibility` → Playwright +
    `@axe-core/playwright`.
  - Idempotent: deterministic SHA-256/16-char hash over canonicalised
    `(storyId, testCase)` is embedded in the spec header; identical
    inputs early-return without rewriting the file.
  - Selector hints from the BA UI section are emitted as comments at
    the top of the test body so the fix loop can lift them when
    refining selectors.
- `src/main.ts` now plumbs `TemplateTestCodeGenerator` into the
  `FixItOrchestrator`'s `generator` port.
- 14 new vitest cases in `tests/test-code-generator.test.ts` covering:
  - one-spec-per-case path + canonical layout
  - byte-identical output across two consecutive `generate()` calls
    with same inputs (mtime unchanged)
  - rewrite when an existing file has a stale `@hash`
  - `idempotent: false` always rewrites
  - hash sensitivity to `(storyId, testCase)` deltas
  - all five layer templates produce expected imports + scaffolding
  - selector-hint comment emission
  - `*/` and newline escaping in Gherkin → comment headers
- 2 new microbenchmarks in `tests/test-code-generator.bench.ts`:
  first-pass < 5 ms/case, idempotent-pass < 1 ms/case.

### FIX-001 — skeleton + event ingest (this PR)

- Initial package scaffold (`package.json`, `tsconfig.json`,
  `jest.config.ts`).
- `src/types.ts` — Zod schemas for `CodingCompletePayload`,
  `TestedAndDonePayload`, `FixLoopEscalatedPayload`,
  `TestCaseResult`, `TestFailureReport`, `FixRequest`.
- `src/main.ts` — env reader + `bootstrap()` returning the
  `FixItOrchestrator` and a graceful shutdown handle.
- `src/orchestrator.ts` — `FixItOrchestrator` class with stub
  injectables for the test-code generator, runner, diagnoser, IPC
  invoker, and retest loop. Subsequent FIX-### PRs swap the stubs out
  for real implementations.
- `src/stubs.ts` — minimal pass-through stubs that always claim every
  test case passes; this lets FIX-001 emit `task.tested_and_done`
  end-to-end and gives FIX-002 .. FIX-006 a clean swap-target.
- Tests: env-reader (5), payload Zod (8), orchestrator stub flow (4),
  bootstrap smoke (3), benchmark (1).
- Registry: new event types `task.coding_complete`,
  `task.testing_started`, `task.test_case.result`,
  `task.fix_requested`, `task.fix_applied`, `task.tested_and_done`,
  `task.fix_loop_escalated`.
- Docs: `caia/docs/fix-it-test-agent.md`.
