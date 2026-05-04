# Fix-It Test Agent — Operator Runbook

**Status:** FIX-001 skeleton (Phase 2D scope split — see `apps/worker-fix-it/README.md`).

The Fix-It Test Agent is the second worker in the Phase 2 worker pool. It
receives a `task.coding_complete` event from a `worker-coding` instance
and is responsible for proving the implementation against the ticket's
`testCases`. On any failure it does **not** log a bug for later — it
calls back into the still-warm Coding Agent worker through an in-session
IPC channel, asks it to apply a minimal fix, and re-runs only the failing
case. Up to **6 attempts** per case before escalating as `fix-stuck`.

## Why fix-in-session, not log-bug-and-leave

Logging a bug forces the Coding Agent's worktree to be released, the
Claude SDK session to be torn down, and a fresh worker to re-acquire all
of that context later. By the time the bug reaches the start of the
pipeline, the reasoning chain that produced the original implementation
is gone and recovery costs ~N tokens.

Fix-in-session keeps the worktree warm and the SDK session alive, so the
Coding Agent picks up the failure with full context loaded. This is the
single most important behavioral change of Phase 2D.

## Inputs and outputs

**Input:** `task.coding_complete` payload — emitted by `worker-coding`
once `gh pr create` succeeds. Carries `worktreePath` (warm worktree
location) and `codingSessionId` (the Claude SDK session the Coding
Agent is holding open).

**Output (terminal success):** `task.tested_and_done` — every test case
green. Task Manager auto-merges the PR and releases the worker.

**Output (terminal failure):** `task.fix_loop_escalated` — at least one
test case exhausted its 6-attempt loop. Blocker filed at
`blockers` table with `kind='fix-stuck'`; dashboard `/blockers` shows it.

## Lifecycle, per test case

1. Generate a Playwright/vitest spec from the test case's Gherkin shape
   (FIX-002).
2. Run the spec against the warm worktree (FIX-003).
3. If passed: emit `task.test_case.result` and move on.
4. If failed:
   - Diagnose root cause — capture stack trace, screenshot, console,
     network, DOM (FIX-004).
   - Synthesize a structured `FixRequest` and send it to the Coding
     Agent's IPC `apply_fix` method (FIX-005).
   - Wait for the Coding Agent to commit a fix on the same branch.
   - Re-run only this test case (FIX-006).
   - Loop ≤ 6 times.

## How to run locally (FIX-001)

The skeleton package is wired but not yet bound to a real event-bus
subscriber — that lands later in the FIX-### track. To exercise the
orchestrator state machine directly:

```bash
cd ~/Documents/projects/caia
pnpm --filter @caia-app/worker-fix-it install
pnpm --filter @caia-app/worker-fix-it test
pnpm --filter @caia-app/worker-fix-it bench
```

`pnpm test` covers env reading, payload Zod validation, and the four
orchestrator branches (happy / IPC-fix / IPC-failed / exhausted).
`pnpm bench` asserts the orchestrator's per-attempt overhead stays
under 5 ms with stub ports — well below the directive's
~10s-per-browser-case wall budget.

## Coordination with CODING-007

The Coding Agent's IPC server (Unix-domain socket at
`~/.caia/sockets/<workerId>.sock`) lands in CODING-007. Until that PR
merges, FIX-005 ships a mocked IPC client. Real wiring switches over
via a single `CodingIpcClient.fromEnv()` factory — no orchestrator
change needed.

## Per-DoD checklist (Phase 2D)

- [x] Unit tests for env reader, payload Zod, orchestrator state
      machine.
- [x] Microbenchmark asserting orchestrator overhead bound.
- [x] Event registry updated (`packages/events-taxonomy-internal/`).
- [x] Operator runbook (this file).
- [x] FIX-002: Real test code generator (`TemplateTestCodeGenerator`)
      with layer dispatch and idempotency, plumbed into `bootstrap()`.
- [x] FIX-003: Real test runner (`SubprocessTestRunner` over an injectable `CommandExecutor`).
- [x] FIX-004: Real failure diagnoser (`StructuredFailureDiagnoser` with heuristic cause inference).
- [x] FIX-005: Real Coding Agent IPC client (`UnixSocketCodingIpcClient` + `MemoryCodingIpcInvoker` fallback; coordinates with CODING-007).
- [x] FIX-006: Re-test loop persistence + fix-stuck blocker writer (`RetestLoopController` + same-sha guard).
- [ ] Real-browser test with seeded failure — FIX-007 .. FIX-013.

## See also

- `~/Documents/projects/reports/phase2-completion-architecture-2026-04-28.md`
  — full architecture spec
- `apps/worker-coding/` — peer worker (Coding Agent)
- `apps/orchestrator/src/agents/worker-pool-registry.ts` — Task Manager
  worker registry the Fix-It Agent will register against in FIX-007
