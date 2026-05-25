# Plan: @caia/principal-engineer — Stage 12 of the canonical pipeline

**Plan type:** implementation
**Caller agent:** `@caia/principal-engineer`
**Submitted by:** Stolution (autonomous build)
**Affected components:** `@caia/principal-engineer`, `@caia/state-machine`, `@chiefaia/claude-spawner`, `@chiefaia/ticket-template`, `@caia/claude-subagents`
**EA precedent:** PR #568 (ea-coordinator framework) + per-story-tester PLAN.md

## Goal

Stage 12 of CAIA's canonical pipeline: Principal Engineer. Takes EA-approved
+ Test-Author-prepared tickets (state `tests-reviewed`) and distributes them
across N parallel coding workers, deciding parallel-vs-sequential bucketing
from a typed dependency graph. Dispatches Full-Stack-Engineer subagents up to
the per-tenant concurrency cap, drives `tests-reviewed → scheduled` per ticket,
and surfaces the wave plan via `POST /api/principal-engineer/schedule`.

## State-machine integration

Canonical FSM (`@caia/state-machine`, `transitions.ts`) edges we use:

- `tests-reviewed → scheduled` (Principal Engineer; bucket assigned)
- `tests-reviewed → tests-review-failed` (Test Reviewer caught a defect)
- `scheduled → coding-in-progress` (FSE picks ticket up via tryAssignWork)
- `scheduled → scheduling-failed` (we couldn't bucket / dispatch)

No new states are added. FSM invariant preserved.

## Package surface

```ts
import { buildDependencyGraph, detectCycles, topoLevels } from '@caia/principal-engineer';
import { bucketTickets, WorkerPool, Dispatcher, schedule } from '@caia/principal-engineer';
```

## Files

- `src/dependency-graph.ts` — Pure graph layer. Builds `TicketGraph` from
  `{ ticketId, dependsOn }` records, detects SCCs via iterative Tarjan
  (stack-safe), reports cycles, computes Kahn-style topological levels.
- `src/bucketer.ts` — Consumes topo levels + optional resource-conflict rules
  from SPS bucket policies. Assigns each ticket to
  `{ waveIndex, bucketId, kind: 'parallel-bucket-N' | 'sequential-after-X' }`.
  Configurable per-wave parallelism cap (default 5; clamps to tier cap).
- `src/worker-pool.ts` — Wraps `@caia/state-machine`'s `tryAssignWork`,
  `recordWorkerHeartbeat`, `completeWork`, `expireInactiveWorkers` primitives.
  Spawn/claim/heartbeat/release. Capacity tracking. TTL-based dead-worker sweep.
- `src/dispatcher.ts` — Per-wave fan-out: fires one Full-Stack-Engineer
  subagent per ticket up to the concurrency cap (default 5; tier-configurable:
  free=2, pro=5, enterprise=10). Uses `@chiefaia/claude-spawner.spawnClaude`
  with the `caia-coding.md` system prompt. Subscription-only.
- `src/api.ts` — `POST /api/principal-engineer/schedule`. Adapter-shape so the
  orchestrator can wire it into any HTTP server (no Express dep).
- `src/types.ts` — All public types.
- `src/index.ts` — Re-exports + `schedule()` high-level orchestrator.

## Tests (≥40)

- `tests/dependency-graph.test.ts` — ≥20: empty, single, chain, long chain
  (1000 nodes), self-loop, 2-cycle, 3-cycle, nested cycle in DAG, diamond,
  two diamonds, disconnected, duplicate edges, missing-dep error, large
  random DAG (500 nodes / 2000 edges), 5-node SCC, multiple SCCs, topo
  levels, deterministic ordering.
- `tests/bucketer.test.ts` — ≥10: parallel assignment, resource-conflict to
  sequential, per-wave cap clamp, tier cap, empty input, all-conflict.
- `tests/worker-pool.test.ts` — claim/heartbeat/release happy path,
  duplicate-claim rejected, expired claim swept, concurrent claim winner.
- `tests/dispatcher.test.ts` — stub spawner records dispatch, concurrency cap
  enforced, FSE failure → `scheduling-failed`, transition idempotency.
- `tests/api.test.ts` — POST validates body, returns wave plan, surfaces
  cycle as 422 with structured payload.
- `tests/integration.test.ts` — 50 fake tickets with mixed deps (5 chains
  of 10, 3 diamonds, 2 conflicts) → realistic wave plan with ≥3 waves.
- `tests/smoke.test.ts` — 5-ticket wave through to the real
  `caia-coding.md` FSE subagent template; verifies spawner invocation shape.

Coverage gate: ≥80% lines.

## Reuse

- `@caia/state-machine` — StateMachine, InMemoryStateStore, canTransition,
  worker primitives, error types. No fork.
- `@chiefaia/claude-spawner` — spawnClaude, parseClaudeJsonEnvelope.
- `@chiefaia/ticket-template` — TicketTemplateV1Schema.
- `@caia/claude-subagents/agents/caia-coding.md` — FSE system prompt.
- SPS `04_bucket_policies.yaml` + `03_decomposition_rules.yaml` —
  parsed at boot for concurrency caps + resource-conflict policies.

## Non-goals

- No new FSM states.
- No FSE implementation (we dispatch the existing caia-coding subagent).
- No PR open/merge orchestration.
- No replacement for SPS bucket-policy YAML.
- No vendor-specific HTTP framework.

## Risk register

- **No API-key billing**: claude-spawner is subscription-only by construction.
- **Deterministic clock + IDs**: scheduler accepts optional clock; bucket IDs
  are content-addressed.
- **Idempotent transitions**: StateMachine.transition is idempotent.
- **No real-network in tests**: every spawner call stubbable via spawnFn.
- **Bounded recursion**: Tarjan SCC is iterative — stack-safe for ≥10k nodes.

## Quality gates

- `pnpm -F @caia/principal-engineer build` clean
- `pnpm -F @caia/principal-engineer typecheck` clean (strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess)
- `pnpm -F @caia/principal-engineer test` green — ≥40 tests, ≥80% line coverage
- True-Zero invariant preserved
- Subscription-only invariant preserved

## Approval request

Approve to proceed with implementation as specified. Mirrors `@caia/per-story-tester`
(Stage 14) conventions; extends the same StateMachine surface used by every other
pipeline stage.
