# Plan: @caia/full-stack-engineer — Stage 13 of the canonical pipeline

**Plan type:** implementation
**Caller agent:** `@caia/full-stack-engineer` (this package)
**Submitted by:** Stolution
**Affected components:** `@caia/full-stack-engineer`, `@caia/state-machine`, `@caia/architect-kit`, `@chiefaia/claude-spawner`, `@chiefaia/claude-subagents`, `@chiefaia/ticket-template`

## Goal

Build the per-ticket coding worker subagent that consumes an EA-approved + Test-authored ticket, implements the EXACT specs of the 17 architects' outputs (frontend + backend + database + tests), opens a clean PR, and surrenders the ticket to Stage 14 (per-story-tester) for verification. N workers run in parallel under Principal Engineer scheduling.

## Pipeline placement

Stage 13 sits between scheduling (Stage 12) and per-story testing (Stage 14):

```
scheduled
   │
   │  Principal Engineer picks a worker and assigns this ticket
   ▼
coding-in-progress    ◀── this package owns the transition INTO this state
   │
   │  Worker implements per architects' specs, runs tests locally, opens PR
   ▼
code-complete         ◀── this package owns the transition OUT to here on success
   │                       (or coding-failed on a hard-stop failure)
   ▼
per-story-tested      (Stage 14; @caia/per-story-tester)
```

The canonical FSM (`@caia/state-machine`/`transitions.ts` §1.1) is the source of truth — we add NO new states. The brief's `claimed → implementing → tests-passing-locally → pr-opened` are worker-local sub-states tracked in the package's own `WorkerSubState` enum + emitted as payload on the FSM transitions; they are NOT first-class project states. This mirrors the precedent established by `@caia/per-story-tester`'s PLAN.md ("No new pipeline states.")

## State-machine transitions owned here

| When | From | To | Reason |
|------|------|----|--------|
| Worker claims a scheduled ticket | `scheduled` | `coding-in-progress` | `full-stack-engineer.claimed` |
| Worker reports clean local tests + PR opened | `coding-in-progress` | `code-complete` | `full-stack-engineer.pr-opened` |
| Worker exhausts retry budget / hits a structural failure | `coding-in-progress` | `coding-failed` | `full-stack-engineer.implementation-failed` |

The worker also exposes idempotent re-entry: if it is re-spawned for a ticket already in `coding-in-progress` and the PR already exists, it short-circuits to the success-shape result without re-opening the PR.

## API

```ts
import { runFullStackEngineer, FullStackEngineerConfig, EngineerResult } from '@caia/full-stack-engineer';

const result = await runFullStackEngineer(ticketId, config);
// → {
//     ticketId, projectId,
//     workerId, worktreePath, branchName,
//     subState: 'pr-opened' | 'implementation-failed' | 'idempotent-noop',
//     prUrl, prNumber, commitSha,
//     emittedFiles: { frontend: [...], backend: [...], database: [...], tests: [...] },
//     localTests: { passed, failed, durationMs },
//     transition,
//     startedAtIso, finishedAtIso
//   }
```

The function:

1. **work-claimer.ts** — atomically claims the ticket from the scheduling pool via `@caia/state-machine`'s `tryAssignWork()` + transitions `scheduled → coding-in-progress`. Lost-race losers see `claimed=false` and short-circuit.
2. **spec-reader.ts** — loads the ticket, reads `ticket.architecture` (the disjoint JSONB blob composed by the 17 architects via `@caia/architect-kit`), reads `ticket.testCases` (authored by Test Author), consolidates them into an `ImplementationBrief` focused on this worker's job (file paths to touch, acceptance criteria, test cases to satisfy, shadcn-aligned UI primitives to use).
3. **code-emitter.ts** — produces frontend code (shadcn/ui + Tailwind, locked per `project-caia-shadcn-react-first-locked`), backend code, database migrations, and per-case test scaffolds. Emission is delegated to a spawned Claude subagent (subscription-only via `@chiefaia/claude-spawner`) using the system prompt declared in `agent.ts`. The emitter never writes outside the ticket-scoped allowlist; every write is staged in-memory then committed to disk inside the assigned worktree.
4. **pr-opener.ts** — commits the staged files on the worker's branch with a conventional commit per acceptance-criterion grouping, runs the local test gate (typecheck + lint + vitest), opens the PR with a structured body referencing the ticket and listing the architects whose specs were satisfied, and drives the `coding-in-progress → code-complete` transition.

## Files

- `src/agent.ts` — exports `FULL_STACK_ENGINEER_SYSTEM_PROMPT` and `buildEngineerPrompt(brief)`. The system prompt frames the subagent as a senior full-stack engineer whose mandate is to implement the EXACT specs from the 17 architects + Test Author with zero deviation from acceptance criteria. Stops only at `[result] DONE` or `[result] FAILED`.
- `src/work-claimer.ts` — `claimTicket(ticketId, sm, workerId, opts?) → ClaimOutcome`. Wraps `sm.tryAssignWork(projectId, workerId)` plus the `scheduled → coding-in-progress` transition into one atomic call. Idempotent on re-entry (already-in-progress claims are accepted).
- `src/spec-reader.ts` — `readSpec(loaded) → ImplementationBrief`. Pure function. Walks `ticket.architecture` keyed by architect (`frontend.*`, `backend.*`, `database.*`, `accessibility.*`, ...), folds in `ticket.testCases` and `ticket.acceptance_criteria`, returns the focused brief.
- `src/code-emitter.ts` — `emitCode(brief, config) → EmittedFiles`. Pluggable emitter: production uses `createSpawnedEmitter()` which calls `spawnClaude()` with the system prompt + brief, parses the assistant's structured "file plan" reply, and stages files to disk. Tests inject a `StubEmitter` that returns deterministic file contents from the brief.
- `src/pr-opener.ts` — `openPr(emitted, brief, config) → PrOutcome`. Runs local gate (`pnpm typecheck`, `pnpm lint`, `pnpm vitest run`), commits in logical chunks, pushes, creates the PR via `gh pr create --fill --base develop`, returns `{ prNumber, prUrl, commitSha }`. Pluggable `GitAdapter` so tests inject a stub.
- `src/api.ts` — `runFullStackEngineer(ticketId, config)` orchestrates work-claim → spec-read → code-emit → pr-open → state-transition. Returns `EngineerResult`.
- `src/types.ts` — `EngineerResult`, `ImplementationBrief`, `EmittedFiles`, `ClaimOutcome`, `PrOutcome`, `WorkerSubState`, `FullStackEngineerConfig`, `Emitter`, `GitAdapter`, `LocalGateRunner`, `TicketStore`, `LoadedTicket`.
- `src/index.ts` — public surface re-exports.
- `tests/` — vitest suite ≥40 unit tests across all modules + a deterministic end-to-end integration test driving a small ticket through the whole pipeline with stub adapters.

## Stack lock (shadcn/ui + Tailwind)

Per `[[project-caia-shadcn-react-first-locked]]` the emitter MUST scaffold any frontend output using:

- shadcn/ui components imported from `@/components/ui/*` (consumer-side path; the engineer emits import statements only — it does not vendor the registry).
- Tailwind utility classes exclusively. No CSS-in-JS, no styled-components, no MUI.
- React Server Components (`'use client'` only where mandated by the brief).

`agent.ts`'s system prompt encodes this as a non-negotiable. `spec-reader.ts` surfaces the lock in the brief's `frontend.stackLock` block so the spawned subagent receives it inline.

## Reuse

- `@caia/state-machine` — `StateMachine`, `tryAssignWork`, `transition`, `InvalidTransitionError`, `ProjectNotFoundError`.
- `@caia/architect-kit` — `Ticket`, `ArchitectOutput`, `ArchitectSectionContract` for spec parsing.
- `@chiefaia/claude-spawner` — `spawnClaude`, `parseClaudeJsonEnvelope` for subagent emission (subscription-only by construction).
- `@chiefaia/claude-subagents` — manifest reference for naming + tier conventions; the `caia-coding.md` subagent's contract (Git Flow + Evidence Gate + auto-merge) informs `agent.ts`.
- `@chiefaia/ticket-template` — `TicketTemplateV1`, `TestCase`, `TestCaseLayer`, `TestCaseCategory` for typed loads.

## Non-goals

- No re-architecture of the ticket. The architects' outputs are immutable; this worker only implements them.
- No new pipeline states; no FSM mutations.
- No test execution OF the implementation itself — Stage 14 (per-story-tester) owns that. We only run the LOCAL gate (typecheck + lint + unit-vitest) as a pre-PR sanity check.
- No PR review / merge — that's the operator's domain (admin-merge per `feedback-auto-merge-prs`).
- No retry-on-failure loop — a failed worker transitions the ticket to `coding-failed` and surrenders; the Principal Engineer schedules a fresh worker per the FSM's recovery edges.

## Risk register check

- **Subscription-only LLM** preserved — every spawn goes through `@chiefaia/claude-spawner` which scrubs API-key env vars unconditionally.
- **No-network in tests** preserved — `Emitter`, `GitAdapter`, and `LocalGateRunner` are all injectable. Production wires real spawns; the test suite uses stubs.
- **Deterministic clock + IDs** — `runFullStackEngineer` accepts an optional `clock` for time-based fields; defaults to `() => new Date()`. Worker IDs default to `full-stack-engineer-${ticketId}-${nonce}`.
- **Idempotent transitions** — `state-machine.transition()` is idempotent within the configurable window; safe to retry on flake. Re-entry on an already-claimed ticket short-circuits to the success-shape.
- **Stack-lock enforcement** — the system prompt + brief both encode the shadcn/Tailwind lock; the emitter inspects file paths and asserts no `.css` / `mui` / `styled-components` import is emitted, raising a structural failure if violated.

## Quality gates

- `pnpm -F @caia/full-stack-engineer build` clean
- `pnpm -F @caia/full-stack-engineer typecheck` clean (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess)
- `pnpm -F @caia/full-stack-engineer test` green — ≥40 unit tests + 1 integration test
- True-Zero on caia preserved (admin-merge per operator preference)

## Approval request

Approve to proceed with implementation as specified.
