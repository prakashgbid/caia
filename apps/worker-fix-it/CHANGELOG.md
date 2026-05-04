# Changelog — `@caia-app/worker-fix-it`

## Unreleased

### FIX-005 — Coding Agent IPC client (this PR)

- New `src/coding-ipc-client.ts`: `MemoryCodingIpcInvoker` (default
  used until CODING-007 ships) + `UnixSocketCodingIpcClient` (real
  newline-delimited JSON client over `~/.caia/sockets/<workerId>.sock`).
- `src/main.ts` plumbs `UnixSocketCodingIpcClient.fromEnv()` with
  `MemoryCodingIpcInvoker` fallback; swap is environmental, no code
  change needed when the server lands.
- 19 new vitest cases (memory invoker, socket round-trip, multiplex,
  timeouts, malformed-line tolerance, fromEnv).
- 1 new microbenchmark: in-memory invoker < 0.5 ms / call.

### FIX-005 — Coding Agent IPC client (this PR)

- New `src/coding-ipc-client.ts`:
  - `MemoryCodingIpcInvoker` — in-process mock conforming to
    `CodingIpcInvoker`. The default the orchestrator uses today (until
    CODING-007 ships its server). Tests can drive responses through
    a `respond(req)` hook, or set `alwaysFix: false` to simulate a
    failed fix. Records every call.
  - `UnixSocketCodingIpcClient` — real client speaking newline-delimited
    JSON over a Unix-domain socket at the conventional
    `~/.caia/sockets/<workerId>.sock`. Single persistent connection,
    multiplexed by per-request UUIDs, malformed-line tolerant, with
    connect + per-request timeouts.
  - Wire format: documented in the file header (apply_fix / health /
    flush_logs / close_session methods).
  - `socketPathForWorker(workerId, base?)` for path conventions.
  - `UnixSocketCodingIpcClient.fromEnv(env)` factory: prefers
    `CODING_IPC_SOCKET`, falls back to `CODING_WORKER_ID`, returns
    null when no live socket is available.
- `src/main.ts` plumbs the IPC client into the orchestrator: prefers
  the real Unix socket via `fromEnv()`, falls back to
  `MemoryCodingIpcInvoker`. Swap to the real server is purely
  environmental — no code change needed once CODING-007 lands.
- 19 new vitest cases in `tests/coding-ipc-client.test.ts`:
  - `socketPathForWorker` (2)
  - `MemoryCodingIpcInvoker` (4 — default ok / alwaysFix=false /
    custom respond hook / close-session counter)
  - `UnixSocketCodingIpcClient` end-to-end against a tiny test server
    (9 — round-trip / server-error / concurrent multiplex / request
    timeout / connect error / malformed-line tolerance / health /
    DEFAULT_REQUEST_TIMEOUT_MS pinned / close-session idempotence)
  - `UnixSocketCodingIpcClient.fromEnv` (3 — null when no env / null
    on missing path / non-null on live socket)
- 1 new microbenchmark: in-memory invoker < 0.5 ms / call.

### FIX-004 — failure diagnoser (this PR)

- New `src/failure-diagnoser.ts`:
  - `StructuredFailureDiagnoser` (real impl of `FailureDiagnoser`;
    replaces `StubFailureDiagnoser`).
  - Lifts every artifact the runner attached: `tracePath`,
    `screenshotUrl`, `consoleLog` (merged with stdout/stderr tail),
    `networkLog`, `domSnapshot`, `seedFixtures`.
  - Heuristic `inferCause` over 14 patterns —
    missing-import / missing-file / service-not-running / timeout /
    selector-not-found / assertion-mismatch / a11y-violation /
    visual-regression / auth-failure / server-error / not-found /
    syntax-error / type-error / unknown.
  - `liftFailingAssertion` extracts the first `expect(...).toX(...)`
    call from the message + stack so the Coding Agent's IPC fix
    request gets a one-line "what to make pass."
  - `tailLines` / `tailFile` helpers (default 80 lines) preserve only
    the relevant tail of long log streams; `logTailLines` is
    configurable per instance.
- `src/main.ts` plumbs the real `StructuredFailureDiagnoser` into the
  orchestrator's `diagnoser` port.
- 23 new vitest cases in `tests/failure-diagnoser.test.ts`:
  - 15 inferCause patterns
  - 3 liftFailingAssertion paths
  - 4 tailLines / tailFile paths
  - 5 diagnoser end-to-end tests asserting Zod-valid output, browser
    artifact passthrough, no-artifact fallback, configurable tail,
    status fallback for empty errorMessage.
- 1 new microbenchmark: < 1 ms / report.

### FIX-003 — subprocess test runner (this PR)

- New `src/test-runner.ts`:
  - `SubprocessTestRunner` (real impl of `TestRunner`; replaces
    `StubTestRunner`).
  - `CommandExecutor` port + `SpawnCommandExecutor` default; tests
    inject a mock so CI never spawns a real test process.
  - Spec-kind heuristic: scans imports → vitest vs Playwright.
  - `parseVitestJson` + `parsePlaywrightJson` parsers tolerate
    JSON-in-stdout chatter and walk nested Playwright suites for the
    first failing test.
  - Status mapping: passed / failed (with errorMessage + errorStack +
    tracePath when available) / skipped / timeout / runner-crash.
  - Per-spec timeout default 60 s.
- `src/main.ts` plumbs the real `SubprocessTestRunner` into the
  orchestrator's `runner` port.
- 18 new vitest cases in `tests/test-runner.test.ts` covering parser
  shapes (passed / failed / skipped / unparseable / embedded), spec
  kind detection, command building, and runner end-to-end flow with
  a `MockExecutor`.
- 1 new microbenchmark: per-spec runner+parser overhead < 2 ms.

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
