# Changelog — `@caia-app/worker-fix-it`

## Unreleased

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
