# `@caia-app/worker-fix-it`

Phase 2 **Fix-It Test Agent** worker.

After the Coding Agent (`@caia-app/worker-coding`) emits
`task.coding_complete`, this worker:

1. Reads the ticket bundle (same `GET /stories/:id/bundle` endpoint).
2. Generates concrete Playwright/vitest spec files from the
   `testCases` array on the ticket.
3. Runs the specs against the fresh implementation.
4. For every failure, diagnoses the root cause (stack + screenshot +
   console + network + DOM + log slice) and synthesizes a structured
   `FixRequest`.
5. **Invokes the Coding Agent in the same session** (via the IPC the
   Coding Agent's `worker-coding` process exposes) with the fix
   request. Critical: same session = warm worktree, no re-acquisition
   cost.
6. Re-runs only the failed test case. Loops up to **6 attempts** per
   case; on success marks the ticket green; on exhaustion escalates
   as `fix-stuck`.

## Outputs

- `task.tested_and_done` — every test case green, ticket ready for PR
  merge.
- `task.fix_loop_escalated` — at least one test case exhausted the fix
  loop and a `fix-stuck` blocker has been filed.

## Scope split (FIX-001 .. FIX-006)

| ID       | Module                               | What it lands                                   |
|----------|--------------------------------------|-------------------------------------------------|
| FIX-001  | `src/main.ts`, `src/orchestrator.ts` | Skeleton + event ingest + stub orchestration    |
| FIX-002  | `src/test-code-generator.ts`         | Spec generation per layer/category (idempotent) |
| FIX-003  | `src/test-runner.ts`                 | Spec runner with structured results             |
| FIX-004  | `src/failure-diagnoser.ts`           | TestFailureReport synthesis                     |
| FIX-005  | `src/coding-ipc-client.ts`           | In-session Coding Agent invoker (mocked IPC)    |
| FIX-006  | `src/retest-loop-controller.ts`      | The 6-attempt retry loop + escalation           |

Real-browser tests, Browserless on stolution, and the dashboard surface
land in FIX-007 .. FIX-013 (parallel track).

## Key design points

- **Fix-in-session, not log-bug-and-leave.** The directive replaces the
  prior "Test Runner Agent + bug ticket" model with a tight in-session
  loop. Worktree stays warm, the Coding Agent's Claude SDK session is
  resumed for each fix request, the fix lands in the same branch.
- **Same worker process, two roles.** The Coding Agent worker stays
  alive after `task.coding_complete`; Fix-It calls back into it via a
  Unix-domain socket. Worker only emits `worker.released` on
  `task.tested_and_done` or `task.fix_loop_escalated`.
- **Per-case fix loop, not per-suite.** A single failing case's loop
  doesn't re-run the whole suite. Cases that already passed stay
  passed; failed cases iterate independently.

## Coordination with CODING-007

The Coding Agent's IPC server lands in CODING-007. Until that PR
merges, FIX-005 mocks the IPC interface (see `src/coding-ipc-client.ts`
in that PR). Real wiring switches over via a single
`CodingIpcClient.fromEnv()` factory.
